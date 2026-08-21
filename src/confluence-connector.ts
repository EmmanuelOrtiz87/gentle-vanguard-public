#!/usr/bin/env node
/**
 * Confluence Connector — Fetches and syncs documentation from Confluence.
 *
 * Migrated from: skills/document-analysis-skill/connectors/confluence-connector.ps1
 *
 * Usage:
 *   npx tsx src/confluence-connector.ts --page <id> [--output <file>] [--quiet]
 *     --page <id>     Confluence page ID to fetch
 *     --space <key>   Confluence space key
 *     --output <file> Output file path (default: stdout)
 *     --base-url <url> Confluence base URL (env: CONFLUENCE_BASE_URL)
 *     --token <tok>   API token (env: CONFLUENCE_API_TOKEN)
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
  pages: number;
  output: string;
  timestamp: string;
}

function fetchFromConfluence(pageId: string, baseUrl: string, token: string): any {
  // Attempt REST API call; fall back to curl
  try {
    const url = `${baseUrl}/rest/api/content/${pageId}?expand=body.storage,version`;
    const curlCmd = `curl -s -H "Authorization: Basic ${Buffer.from(`:${token}`).toString('base64')}" -H "Accept: application/json" "${url}"`;
    const output = runSyncShell(curlCmd, { stdio: 'pipe' }).stdout;
    return JSON.parse(output);
  } catch {
    return { error: 'Failed to fetch from Confluence API' };
  }
}

// ─── CLI Entry Point ───────────────────────────────────────────────

const quiet = args.includes('--quiet');
const pageId = args.indexOf('--page') >= 0 ? args[args.indexOf('--page') + 1] : undefined;
const spaceKey = args.indexOf('--space') >= 0 ? args[args.indexOf('--space') + 1] : '';
const outputPath = args.indexOf('--output') >= 0 ? args[args.indexOf('--output') + 1] : undefined;
const baseUrl =
  args.indexOf('--base-url') >= 0
    ? args[args.indexOf('--base-url') + 1]
    : process.env.CONFLUENCE_BASE_URL || 'https://your-domain.atlassian.net/wiki';
const token =
  args.indexOf('--token') >= 0
    ? args[args.indexOf('--token') + 1]
    : process.env.CONFLUENCE_API_TOKEN || '';

const result: ConnectorResult = {
  source: `confluence:${spaceKey || pageId || 'unknown'}`,
  pages: pageId ? 1 : 0,
  output: outputPath || 'stdout',
  timestamp: new Date().toISOString(),
};

if (pageId && token) {
  const data = fetchFromConfluence(pageId, baseUrl, token);
  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(data, null, 2));
  }
  if (!quiet) {
    console.log(JSON.stringify(data, null, 2));
  }
} else if (!quiet) {
  console.log(JSON.stringify(result, null, 2));
  if (!pageId) console.log('[WARN] No --page specified. Use --page <id> to fetch content.');
  if (!token) console.log('[WARN] No Confluence API token. Set CONFLUENCE_API_TOKEN env var.');
}
