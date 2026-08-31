// Shared state and paths for the maintenance watchtower (F2.5 split).
//
// The orchestrator (src/core/maintenance-watchtower.ts) imports these; the
// per-component checks live in checks-*.ts and share this context so that
// results, quiet mode and the exit code stay consistent across modules.
//
// NOTE: `results` is a live array — the orchestrator clears it between
// continuous-mode cycles (results.length = 0) and reads it for autoheal,
// reporting and tracing.

import { join, resolve } from 'path';
const logger = log('CORE-WATCHTOWER-CONTEXT');
import { log } from '../../utils/logger.js';

export const ROOT = resolve(process.cwd());
export const RUNTIME_DIR = join(ROOT, '.runtime');
export const SESSION_DIR = join(ROOT, '.session');

// Default port for the CodeGraph MCP server (overridable via CODEGRAPH_PORT env).
// Note: `codegraph serve --mcp` runs as a stdio MCP server, so the process table
// and PID file are the primary liveness signals; the port probe is a fallback.
export const CODEGRAPH_PORT = parseInt(process.env.CODEGRAPH_PORT ?? '3000', 10) || 3000;

export interface CheckResult {
  component: string;
  check: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  detail: string;
  action: string;
  timestamp: string;
}

export const results: CheckResult[] = [];
export let quiet = false;
export let exitCode = 0;

export function setQuiet(v: boolean): void {
  quiet = v;
}

export function getExitCode(): number {
  return exitCode;
}

export function addResult(
  component: string,
  check: string,
  status: CheckResult['status'],
  detail: string,
  action = 'ok',
  critical = false,
) {
  results.push({
    component,
    check,
    status,
    detail,
    action,
    timestamp: new Date().toISOString(),
  });
  if (!quiet || status !== 'PASS') {
    const icons: Record<string, string> = { PASS: '  ', WARN: '  ', FAIL: '  ', SKIP: '  ' };
    logger.info(
      `${icons[status]}[${component}] ${check}: ${status}${detail ? ' - ' + detail : ''}`,
    );
  }
  if (status === 'FAIL' && critical) exitCode++;
}
