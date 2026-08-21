#!/usr/bin/env node
/**
 * JIRA Connector — Fetches and syncs issues from JIRA.
 *
 * Migrated from: skills/document-analysis-skill/connectors/jira-connector.ps1
 *
 * Usage:
 *   npx tsx src/jira-connector.ts --issue <key> [--output <file>] [--quiet]
 *     --issue <key>   JIRA issue key (e.g., PROJ-123)
 *     --jql <query>   JQL query string
 *     --output <file> Output file path (default: stdout)
 *     --base-url <url> JIRA base URL (env: JIRA_BASE_URL)
 *     --token <tok>   API token (env: JIRA_API_TOKEN)
 *     --quiet         Minimal output
 */

import { runSyncShell } from './core/run-command.js';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);
void ROOT;

interface ConnectorResult {
  source: string;
  issues: number;
  output: string;
  timestamp: string;
}

function fetchFromJira(issueKey: string, baseUrl: string, token: string): any {
  try {
    const url = `${baseUrl}/rest/api/3/issue/${issueKey}`;
    const curlCmd = `curl -s -H "Authorization: Basic ${Buffer.from(`:${token}`).toString('base64')}" -H "Accept: application/json" "${url}"`;
    const output = runSyncShell(curlCmd, { stdio: 'pipe' }).stdout;
    return JSON.parse(output);
  } catch {
    return { error: 'Failed to fetch from JIRA API' };
  }
}

// ─── CLI Entry Point ───────────────────────────────────────────────

const quiet = args.includes('--quiet');
const issueKey = args.indexOf('--issue') >= 0 ? args[args.indexOf('--issue') + 1] : undefined;
const outputPath = args.indexOf('--output') >= 0 ? args[args.indexOf('--output') + 1] : undefined;
const baseUrl =
  args.indexOf('--base-url') >= 0
    ? args[args.indexOf('--base-url') + 1]
    : process.env.JIRA_BASE_URL || 'https://your-domain.atlassian.net';
const token =
  args.indexOf('--token') >= 0
    ? args[args.indexOf('--token') + 1]
    : process.env.JIRA_API_TOKEN || '';

const result: ConnectorResult = {
  source: `jira:${issueKey || 'query'}`,
  issues: issueKey ? 1 : 0,
  output: outputPath || 'stdout',
  timestamp: new Date().toISOString(),
};

if (issueKey && token) {
  const data = fetchFromJira(issueKey, baseUrl, token);
  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(data, null, 2));
  }
  if (!quiet) {
    console.log(JSON.stringify(data, null, 2));
  }
} else if (!quiet) {
  console.log(JSON.stringify(result, null, 2));
  if (!issueKey) console.log('[WARN] No --issue specified. Use --issue <key> to fetch.');
  if (!token) console.log('[WARN] No JIRA API token. Set JIRA_API_TOKEN env var.');
}
