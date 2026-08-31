/**
 * Logger — structured logging for Gentle-Vanguard
 *
 * Replaces ad-hoc console.log/console.warn/console.error across the stack.
 * Features:
 *   - Prefix-based tagging per module
 *   - Multiple log levels (info, warn, error, debug)
 *   - Consistent output format
 *   - Backward-compatible (console.log still works for scripts)
 *
 * Usage:
 *   import { log } from '../utils/logger.js';
 *   const logger = log('VALIDATOR');
 *   logger.info('Scanning files...');
 *   logger.warn('Deprecated API', { file: 'foo.ts' });
 *   logger.error('Failed', new Error('x'));
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const COLORS: Record<LogLevel, string> = {
  INFO: '\x1b[36m', // cyan
  WARN: '\x1b[33m', // yellow
  ERROR: '\x1b[31m', // red
  DEBUG: '\x1b[90m', // gray
};
const RESET = '\x1b[0m';

export interface Logger {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  debug: (msg: string, data?: unknown) => void;
}

// Correlation bridge (F3.6): when a correlation context is active
// (see src/telemetry/correlation.ts), every log line is enriched with
// sessionId/traceId and mirrored into the unified correlation JSONL timeline.
// Imported lazily-free but defensively: a missing module must never break logging.
import { getCorrelation, logEvent } from '../telemetry/correlation';

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function createLogger(prefix: string): Logger {
  const logLine = (level: LogLevel, msg: string, data?: unknown) => {
    const ts = formatTimestamp();
    const color = COLORS[level];
    const label = `[${prefix}]`.padEnd(18);
    // Backwards compatible enrichment: the correlation suffix (and the JSONL
    // mirror event) is added ONLY when a correlation context exists.
    const ctx = getCorrelation();
    const chain = ctx
      ? ` \x1b[90m[session=${ctx.sessionId ?? '-'} trace=${ctx.traceId.slice(0, 8)}]\x1b[0m`
      : '';
    const out = `${color}${ts} ${label}${RESET}${msg}${chain}`;
    if (ctx) {
      // Mirror into the unified timeline (traces + metrics + logs in one place).
      logEvent(level, msg, { ...dataAsRecord(data), logger: prefix });
    }
    switch (level) {
      case 'ERROR':
        console.error(out, data !== undefined ? data : '');
        break;
      case 'WARN':
        console.warn(out, data !== undefined ? data : '');
        break;
      default:
        console.log(out, data !== undefined ? data : '');
    }
  };

  return {
    info: (msg: string, data?: unknown) => logLine('INFO', msg, data),
    warn: (msg: string, data?: unknown) => logLine('WARN', msg, data),
    error: (msg: string, data?: unknown) => logLine('ERROR', msg, data),
    debug: (msg: string, data?: unknown) => logLine('DEBUG', msg, data),
  };
}

/** Factory: creates a tagged logger instance */
export function log(prefix: string): Logger {
  return createLogger(prefix);
}

function dataAsRecord(data: unknown): Record<string, unknown> {
  return data !== undefined && data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : data !== undefined
      ? { data }
      : {};
}

/** Quick one-shot log (no prefix needed) */
export function info(msg: string): void {
  console.log(`\x1b[36m${formatTimestamp()}\x1b[0m ${msg}`);
}
