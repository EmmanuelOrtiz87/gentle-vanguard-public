#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { pathToFileURL } from 'node:url';

const REQUIRED_TOOLS = ['mem_search', 'mem_save', 'mem_session_summary', 'mem_list_projects'];

export interface EngramMcpSmokeResult {
  status: 'PASS' | 'FAIL';
  project: string;
  toolCount: number;
  requiredTools: string[];
  missingTools: string[];
  listProjectsOk: boolean;
  error?: string;
}

export async function runEngramMcpSmoke(
  project = 'gentle-vanguard',
): Promise<EngramMcpSmokeResult> {
  const transport = new StdioClientTransport({
    command: process.env.GV_ENGRAM_BIN || 'engram',
    args: ['mcp', '--tools=agent', `--project=${project}`],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'gentle-vanguard-engram-smoke', version: '1.0.0' });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    const missingTools = REQUIRED_TOOLS.filter((name) => !names.includes(name));
    const projects = await client.callTool({ name: 'mem_list_projects', arguments: {} });
    const listProjectsOk =
      projects.isError !== true && Array.isArray(projects.content) && projects.content.length > 0;
    return {
      status: missingTools.length === 0 && listProjectsOk ? 'PASS' : 'FAIL',
      project,
      toolCount: names.length,
      requiredTools: REQUIRED_TOOLS,
      missingTools,
      listProjectsOk,
    };
  } catch (error) {
    return {
      status: 'FAIL',
      project,
      toolCount: 0,
      requiredTools: REQUIRED_TOOLS,
      missingTools: [...REQUIRED_TOOLS],
      listProjectsOk: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const projectArg = process.argv.find((arg) => arg.startsWith('--project='));
  const result = await runEngramMcpSmoke(projectArg?.slice('--project='.length));
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
