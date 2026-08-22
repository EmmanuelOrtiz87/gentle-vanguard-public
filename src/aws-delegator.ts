#!/usr/bin/env node
/**
 * AWS Delegator — invoca skills en AWS Lambda vía Function URL (HTTPS real).
 *
 * Migrado desde: scripts/utilities/ops/CLOUD-CONNECTORS/aws-delegator.ps1
 * Reconstruido desde dist/src/aws-delegator.js (2026-08-12) con invocación
 * REAL por HTTPS (patrón nativo, sin SDK ni CLI externos).
 *
 * Uso:
 *   npx tsx src/aws-delegator.ts --skill-id <id> --skill-input '{"k":"v"}' \
 *     --function-url <https://...lambda-url...> [--aws-region us-east-1] \
 *     [--max-retries 3] [--record-metrics true] [--dry-run] [--quiet]
 *
 * Auth: AWS_LAMBDA_FUNCTION_KEY (x-api-key) o AWS_ACCESS_TOKEN (Bearer).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import * as https from 'https';

const ROOT = resolve(process.cwd());
const LOG_FILE = join(ROOT, '.session', 'aws-delegator.log');
const METRICS_FILE = join(ROOT, '.session', 'cloud-metrics.json');
const S3_BACKUP_DIR = join(ROOT, '.session', 's3-backups');

let quiet = false;
let _traceId: string | null = null;

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  if (!quiet) console.log(`${colors[level] ?? ''}[${ts}] [AWS] [${level}] ${msg}\x1b[0m`);
  const logDir = join(ROOT, '.session');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  appendFileSync(LOG_FILE, `[${ts}] [${level}] ${msg}\n`);
}

function newTraceId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i++) id += hex[Math.floor(Math.random() * 16)];
  return id;
}

export class CircuitBreaker {
  failureThreshold = 5;
  successThreshold = 2;
  timeoutSeconds = 60;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  failureCount = 0;
  successCount = 0;
  lastFailureTime = new Date(Date.now() - 3600000);

  canExecute(): boolean {
    if (this.state === 'OPEN') {
      const elapsed = (Date.now() - this.lastFailureTime.getTime()) / 1000;
      if (elapsed > this.timeoutSeconds) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

const circuitBreaker = new CircuitBreaker();

function startTracingSpan(name: string): { traceId: string } | null {
  const tracerPath = join(ROOT, 'src', 'tracing-instrument.ts');
  if (!existsSync(tracerPath)) return null;
  const traceId = newTraceId();
  _traceId = traceId;
  spawnSync('npx', ['tsx', tracerPath, '-Action', 'start', '-SpanName', name, '-TraceId', traceId, '-Quiet'], { cwd: ROOT, windowsHide: true });
  return { traceId };
}

function stopTracingSpan(name: string, success: boolean, error?: string): void {
  const tracerPath = join(ROOT, 'src', 'tracing-instrument.ts');
  if (!existsSync(tracerPath)) return;
  const traceId = _traceId ?? newTraceId();
  const spanId = newTraceId().slice(0, 16);
  if (success) {
    spawnSync('npx', ['tsx', tracerPath, '-Action', 'end', '-SpanName', name, '-TraceId', traceId, '-SpanId', spanId, '-Quiet'], { cwd: ROOT, stdio: 'pipe', windowsHide: true });
  } else {
    spawnSync('npx', ['tsx', tracerPath, '-Action', 'error', '-SpanName', name, '-TraceId', traceId, '-SpanId', spanId, '-ErrorMessage', error ?? 'Unknown error', '-Quiet'], { cwd: ROOT, stdio: 'pipe', windowsHide: true });
  }
}

function logAudit(status: string, detail: string, skillId: string): void {
  const auditPath = join(ROOT, 'src', 'infrastructure', 'audit-pipeline.ts');
  const auditPathLegacy = join(ROOT, 'src', 'audit-pipeline.ts');
  const audit = existsSync(auditPath) ? auditPath : auditPathLegacy;
  if (!existsSync(audit)) return;
  spawnSync('npx', ['tsx', audit, '-Action', 'log', '-EventType', 'skill.exec', '-Component', 'cloud', '-Operation', 'aws-invoke', '-Actor', 'system', '-Target', skillId, '-Status', status, '-Message', detail, '-Quiet'], { cwd: ROOT, stdio: 'pipe', windowsHide: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveFn) => setTimeout(resolveFn, ms));
}

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolveFn, reject) => {
    const u = new URL(url);
    const opts: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(opts, (res) => {
      const chunks: string[] = [];
      res.on('data', (chunk) => chunks.push(chunk.toString()));
      res.on('end', () => resolveFn({ statusCode: res.statusCode ?? 500, data: chunks.join('') }));
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function getAuthorizationHeaders(): Record<string, string> {
  if (process.env.AWS_LAMBDA_FUNCTION_KEY) {
    return { 'x-api-key': process.env.AWS_LAMBDA_FUNCTION_KEY };
  }
  if (process.env.AWS_ACCESS_TOKEN) {
    return { Authorization: `Bearer ${process.env.AWS_ACCESS_TOKEN}` };
  }
  return {};
}

async function invokeSkillOnLambda(
  skillId: string,
  input: unknown,
  functionUrl: string,
  invocationType: string,
  dryRun: boolean,
  recordMetrics: boolean,
): Promise<{ StatusCode: number; Payload: string }> {
  log(`Invoking skill on AWS Lambda: ${skillId} (url: ${functionUrl}, type: ${invocationType})`, 'INFO');

  const payload = JSON.stringify({
    skillId,
    input,
    timestamp: new Date().toISOString(),
    sessionId: process.env.SESSION_ID ?? '',
  });

  if (dryRun || invocationType === 'DryRun') {
    log('Dry run detected, skipping actual Lambda invocation', 'INFO');
    return { StatusCode: 202, Payload: JSON.stringify({ success: true, skillId, output: 'Dry run completed' }) };
  }

  const headers = getAuthorizationHeaders();
  try {
    const start = Date.now();
    const res = await httpsPost(functionUrl, payload, headers);
    const duration = Math.round(Date.now() - start);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      log(`Lambda invocation successful (Status: ${res.statusCode})`, 'SUCCESS');
      if (recordMetrics) recordCloudMetrics('AWS', duration, true, 0.0000167);
      return { StatusCode: res.statusCode, Payload: res.data };
    }
    throw new Error(`HTTP ${res.statusCode}: ${res.data}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Lambda invocation failed: ${msg}`, 'ERROR');
    if (recordMetrics) recordCloudMetrics('AWS', 0, false, 0);
    throw err;
  }
}

async function invokeWithRetry<T>(fn: () => Promise<T>, maxRetries: number, initialDelayMs = 1000): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (!circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker is OPEN');
    }
    try {
      const result = await fn();
      circuitBreaker.recordSuccess();
      return result;
    } catch (err) {
      circuitBreaker.recordFailure();
      if (attempt >= maxRetries) {
        log(`Failed after ${maxRetries} attempts: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
        throw err;
      }
      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      log(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`, 'WARN');
      await sleep(delayMs);
    }
  }
  throw new Error('Unreachable');
}

export function recordCloudMetrics(provider: string, duration: number, success: boolean, cost: number): void {
  const metricsDir = join(ROOT, '.session');
  if (!existsSync(metricsDir)) mkdirSync(metricsDir, { recursive: true });
  let metrics: { executions: Array<{ provider: string; timestamp: string; duration: number; success: boolean; cost: number }> } = { executions: [] };
  if (existsSync(METRICS_FILE)) {
    try {
      metrics = JSON.parse(readFileSync(METRICS_FILE, 'utf-8'));
      if (!Array.isArray(metrics.executions)) metrics.executions = [];
    } catch {
      metrics = { executions: [] };
    }
  }
  metrics.executions.push({ provider, timestamp: new Date().toISOString(), duration, success, cost });
  writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
}

export function saveSessionStateToS3(sessionState: unknown): void {
  log('Saving session state to S3 backup...', 'INFO');
  try {
    if (!existsSync(S3_BACKUP_DIR)) mkdirSync(S3_BACKUP_DIR, { recursive: true });
    const now = new Date();
    const y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const fileName = `session-${y}${M}${d}_${h}${m}${s}.json`;
    writeFileSync(join(S3_BACKUP_DIR, fileName), JSON.stringify(sessionState, null, 2));
    log(`Session state saved: ${fileName}`, 'SUCCESS');
  } catch (err) {
    log(`Failed to save session state: ${err instanceof Error ? err.message : String(err)}`, 'ERROR');
  }
}

export interface AwsDelegatorOptions {
  skillId: string;
  skillInput: unknown;
  functionUrl: string;
  invocationType?: string;
  awsRegion?: string;
  maxRetries?: number;
  recordMetrics?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
}

export async function runAwsDelegator(opts: AwsDelegatorOptions): Promise<{ StatusCode: number; Payload: string }> {
  quiet = opts.quiet ?? false;
  log(`AWS Delegator started for skill: ${opts.skillId}`, 'INFO');
  if (!opts.skillId || !opts.skillInput) {
    throw new Error('SkillId and SkillInput are required');
  }
  let input: unknown = opts.skillInput;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      /* keep as string */
    }
  }
  const spanName = `aws-invoke-${opts.skillId}`;
  startTracingSpan(spanName);
  try {
    const result = await invokeWithRetry(
      () =>
        invokeSkillOnLambda(
          opts.skillId,
          input,
          opts.functionUrl,
          opts.invocationType ?? 'RequestResponse',
          opts.dryRun ?? false,
          opts.recordMetrics ?? false,
        ),
      opts.maxRetries ?? 3,
    );
    if (opts.recordMetrics) {
      saveSessionStateToS3({ skillId: opts.skillId, result, timestamp: new Date().toISOString(), provider: 'AWS' });
    }
    stopTracingSpan(spanName, true);
    logAudit('success', `AWS delegator completed for ${opts.skillId}`, opts.skillId);
    log('AWS delegator completed successfully', 'SUCCESS');
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    stopTracingSpan(spanName, false, errMsg);
    logAudit('failure', `AWS delegator failed: ${errMsg}`, opts.skillId);
    log(`AWS delegator fatal error: ${errMsg}`, 'ERROR');
    throw err;
  }
}

// ─── CLI entrypoint ──────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  const skillId = args['skill-id'] ?? '';
  const rawInput = args['skill-input'] ?? '{}';
  let skillInput: unknown = rawInput;
  try {
    skillInput = JSON.parse(rawInput);
  } catch {
    skillInput = rawInput;
  }
  const functionUrl = args['function-url'] ?? process.env.AWS_LAMBDA_FUNCTION_URL ?? '';
  if (!functionUrl && args['dry-run'] !== 'true') {
    log('AWS_LAMBDA_FUNCTION_URL is required (env var or --function-url) unless --dry-run', 'ERROR');
    process.exit(1);
  }
  runAwsDelegator({
    skillId,
    skillInput,
    functionUrl,
    invocationType: args['invocation-type'] ?? 'RequestResponse',
    awsRegion: args['aws-region'] ?? 'us-east-1',
    maxRetries: parseInt(args['max-retries'] ?? '3', 10),
    recordMetrics: args['record-metrics'] === 'true',
    dryRun: args['dry-run'] === 'true',
    quiet: args['quiet'] === 'true',
  }).catch(() => {
    process.exit(1);
  });
}