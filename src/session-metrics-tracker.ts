#!/usr/bin/env node
/**
 * Session Metrics Tracker — tracks and persists session metrics during lifecycle.
 * TS migration of scripts/utilities/session/session-metrics-tracker.ps1
 *
 * Actions: start, update, end, status
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

interface SessionMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  contextChars: number;
  toolCalls: number;
  filesRead: number;
  filesEdited: number;
  filesCreated: number;
}

interface SessionData {
  sessionId: string;
  startTime: string;
  lastUpdate: string;
  endTime?: string;
  durationSeconds?: number;
  status: 'active' | 'completed';
  metrics: SessionMetrics;
}

function getProjectRoot(): string {
  if (process.env.GV_BASE_DIR && fs.existsSync(process.env.GV_BASE_DIR)) {
    return process.env.GV_BASE_DIR;
  }
  let root = path.resolve(process.cwd());
  while (root && !fs.existsSync(path.join(root, 'config', 'orchestrator.json'))) {
    const parent = path.dirname(root);
    if (parent === root) break;
    root = parent;
  }
  return root || process.cwd();
}

const PROJECT_ROOT = getProjectRoot();
const METRICS_DIR = path.join(PROJECT_ROOT, '.session', 'metrics');
const STATE_FILE = path.join(METRICS_DIR, 'current-session.json');

function nowISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function getCostEstimate(tokens: number): number {
  const costPer1M = 10.0;
  return Math.round((tokens / 1_000_000) * costPer1M * 10000) / 10000;
}

function log(message: string, level = 'INFO', silent = false): void {
  if (silent) return;
  const prefix =
    level === 'OK'
      ? '\x1b[32m'
      : level === 'WARN'
        ? '\x1b[33m'
        : level === 'ERROR'
          ? '\x1b[31m'
          : '\x1b[90m';
  const suffix = '\x1b[0m';
  console.log(`${prefix}[${level}]${suffix} ${message}`);
}

function ensureMetricsDir(): void {
  if (!fs.existsSync(METRICS_DIR)) {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    log(`Created metrics directory: ${METRICS_DIR}`, 'INFO');
  }
}

function readState(): SessionData | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as SessionData;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeState(data: SessionData): void {
  ensureMetricsDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function actionStart(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  contextChars: number,
  toolCalls: number,
  filesRead: number,
  filesEdited: number,
  filesCreated: number,
  silent: boolean,
): void {
  const sid = sessionId || `session-${new Date().toISOString().slice(0, 13).replace('T', '-')}`;
  const totalTokens = inputTokens + outputTokens;

  const data: SessionData = {
    sessionId: sid,
    startTime: nowISO(),
    lastUpdate: nowISO(),
    status: 'active',
    metrics: {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: getCostEstimate(totalTokens),
      contextChars,
      toolCalls,
      filesRead,
      filesEdited,
      filesCreated,
    },
  };

  writeState(data);
  log(`Started tracking session: ${sid}`, 'OK', silent);
}

function actionUpdate(
  inputTokens: number,
  outputTokens: number,
  contextChars: number,
  toolCalls: number,
  filesRead: number,
  filesEdited: number,
  filesCreated: number,
  silent: boolean,
): void {
  const data = readState();
  if (!data) {
    log('No active session to update. Run with --action start first.', 'WARN', silent);
    return;
  }

  data.lastUpdate = nowISO();
  data.status = 'active';

  if (inputTokens > 0) data.metrics.inputTokens += inputTokens;
  if (outputTokens > 0) data.metrics.outputTokens += outputTokens;
  if (contextChars > 0) data.metrics.contextChars += contextChars;
  if (toolCalls > 0) data.metrics.toolCalls += toolCalls;
  if (filesRead > 0) data.metrics.filesRead += filesRead;
  if (filesEdited > 0) data.metrics.filesEdited += filesEdited;
  if (filesCreated > 0) data.metrics.filesCreated += filesCreated;

  data.metrics.totalTokens = data.metrics.inputTokens + data.metrics.outputTokens;
  data.metrics.estimatedCostUsd = getCostEstimate(data.metrics.totalTokens);

  writeState(data);
  log('Updated session metrics', 'OK', silent);
}

function actionEnd(silent: boolean): void {
  const data = readState();
  if (!data) {
    log('No active session to end.', 'WARN', silent);
    return;
  }

  const endTime = new Date();
  data.endTime = nowISO();
  data.lastUpdate = nowISO();
  data.status = 'completed';

  // Calculate duration
  const startTime = new Date(data.startTime);
  data.durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

  // Try to merge with session file
  const sessionFile = path.join(PROJECT_ROOT, '.session', `${data.sessionId}.json`);
  const sessionFileAlt = path.join(PROJECT_ROOT, 'session', `${data.sessionId}.json`);

  let targetFile = sessionFile;
  if (!fs.existsSync(sessionFile) && fs.existsSync(sessionFileAlt)) {
    targetFile = sessionFileAlt;
  }

  if (fs.existsSync(targetFile)) {
    try {
      const sessionData = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      sessionData.endTime = data.endTime;
      sessionData.durationSeconds = data.durationSeconds;
      sessionData.metrics = data.metrics;
      fs.writeFileSync(targetFile, JSON.stringify(sessionData, null, 2), 'utf-8');
      log('Saved metrics to session file', 'OK', silent);
    } catch {
      /* ignore */
    }
  }

  // Clean up state file
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    /* ignore */
  }
  log(`Ended session: ${data.sessionId}`, 'OK', silent);
}

function actionStatus(silent: boolean): void {
  const data = readState();
  if (!data) {
    log('No active session.', 'WARN', silent);
    return;
  }

  if (silent) return;
  const m = data.metrics;
  console.log('');
  console.log('=== Session Metrics Status ===');
  console.log(`Session: ${data.sessionId}`);
  console.log(`Started: ${data.startTime}`);
  console.log(`Last Update: ${data.lastUpdate}`);
  console.log(`Status: ${data.status}`);
  console.log('');
  console.log('Metrics:');
  console.log(`  Input Tokens: ${m.inputTokens}`);
  console.log(`  Output Tokens: ${m.outputTokens}`);
  console.log(`  Total Tokens: ${m.totalTokens}`);
  console.log(`  Est. Cost: $${m.estimatedCostUsd}`);
  console.log(`  Context Chars: ${m.contextChars}`);
  console.log(`  Tool Calls: ${m.toolCalls}`);
  console.log(`  Files Read: ${m.filesRead}`);
  console.log(`  Files Edited: ${m.filesEdited}`);
  console.log(`  Files Created: ${m.filesCreated}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const action = extractArg(args, '--action') || args[0] || 'status';
  const sessionId = extractArg(args, '--session-id') || '';
  const silent = args.includes('--silent') || args.includes('-Silent');

  const parseNum = (name: string, def = 0): number => {
    const v = extractArg(args, name);
    return v ? parseInt(v, 10) : def;
  };

  ensureMetricsDir();

  switch (action) {
    case 'start':
      actionStart(
        sessionId,
        parseNum('--input-tokens'),
        parseNum('--output-tokens'),
        parseNum('--context-chars'),
        parseNum('--tool-calls'),
        parseNum('--files-read'),
        parseNum('--files-edited'),
        parseNum('--files-created'),
        silent,
      );
      break;

    case 'update':
      actionUpdate(
        parseNum('--input-tokens'),
        parseNum('--output-tokens'),
        parseNum('--context-chars'),
        parseNum('--tool-calls'),
        parseNum('--files-read'),
        parseNum('--files-edited'),
        parseNum('--files-created'),
        silent,
      );
      break;

    case 'end':
      actionEnd(silent);
      break;

    case 'status':
      actionStatus(silent);
      break;

    default:
      console.error(`Unknown action: ${action}`);
      process.exit(1);
  }
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
