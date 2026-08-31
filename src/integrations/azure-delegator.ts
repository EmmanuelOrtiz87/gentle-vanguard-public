#!/usr/bin/env node
/**
 * Azure Delegator — invoca skills en Azure Functions (HTTP POST real).
 *
 * Migrado desde: scripts/utilities/ops/CLOUD-CONNECTORS/azure-delegator.ps1
 * Reconstruido desde dist/src/azure-delegator.js (2026-08-12).
 *
 * Uso:
 *   npx tsx src/integrations/azure-delegator.ts --skill-id <id> --skill-input '{"k":"v"}' \
 *     --function-url <https://...azurewebsites.net/api/...> \
 *     [--invocation-type RequestResponse|DryRun] [--max-retries 3] \
 *     [--record-metrics] [--quiet]
 *
 * Auth: AZURE_FUNCTION_KEY (x-functions-key) o AZURE_ACCESS_TOKEN (Bearer),
 * o auto-obtención vía `az account get-access-token` si la CLI está disponible.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { executeWithCircuit } from '../resilience/circuit-breaker-v2';
import { spawnSync } from 'child_process';
import * as https from 'https';

const ROOT = resolve(process.cwd());
const LOG_FILE = join(ROOT, '.session', 'azure-delegator.log');
const METRICS_PATH = join(ROOT, '.session', 'cloud-metrics.json');
const BACKUP_DIR = join(ROOT, '.session', 'azure-backups');

let skillId = '';
let skillInput: unknown = {};
let invocationType = 'RequestResponse';
let functionUrl = process.env.AZURE_FUNCTION_URL ?? '';
let maxRetries = 3;
let recordMetrics = false;
let quiet = false;

function writeLog(message: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO'): void {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (!quiet) {
    const colors: Record<string, string> = {
      INFO: '\x1b[36m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      SUCCESS: '\x1b[32m',
    };
    console.log(`${colors[level] ?? ''}[${ts}] [${level}] ${message}\x1b[0m`);
  }
  try {
    appendFileSync(LOG_FILE, `[${ts}] [${level}] ${message}\n`);
  } catch {
    /* ignore */
  }
}

export function startTracingSpan(name: string): void {
  const tracer = join(ROOT, 'src', 'tracing-instrument.ts');
  if (existsSync(tracer)) {
    spawnSync('npx', ['tsx', tracer, '-Action', 'start', '-SpanName', name, '-Quiet'], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 10000,
      windowsHide: true,
    });
  }
}

export function stopTracingSpan(name: string, success: boolean, error?: string): void {
  const tracer = join(ROOT, 'src', 'tracing-instrument.ts');
  if (!existsSync(tracer)) return;
  if (success) {
    spawnSync('npx', ['tsx', tracer, '-Action', 'end', '-SpanName', name, '-Quiet'], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 10000,
      windowsHide: true,
    });
  } else {
    spawnSync(
      'npx',
      [
        'tsx',
        tracer,
        '-Action',
        'error',
        '-SpanName',
        name,
        '-ErrorMessage',
        error ?? '',
        '-Quiet',
      ],
      { cwd: ROOT, stdio: 'pipe', timeout: 10000, windowsHide: true },
    );
  }
}

export function logAudit(status: string, detail: string): void {
  const audit = join(ROOT, 'src', 'infrastructure', 'audit-pipeline.ts');
  const auditLegacy = join(ROOT, 'src', 'audit-pipeline.ts');
  const auditPath = existsSync(audit) ? audit : auditLegacy;
  if (existsSync(auditPath)) {
    spawnSync(
      'npx',
      [
        'tsx',
        auditPath,
        '-Action',
        'log',
        '-EventType',
        'skill.exec',
        '-Component',
        'cloud',
        '-Operation',
        'azure-invoke',
        '-Actor',
        'system',
        '-Target',
        skillId,
        '-Status',
        status,
        '-Message',
        detail,
        '-Quiet',
      ],
      { cwd: ROOT, stdio: 'pipe', timeout: 15000, windowsHide: true },
    );
  }
}

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ statusCode: number; data: string }> {
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
  if (process.env.AZURE_FUNCTION_KEY) {
    return { 'x-functions-key': process.env.AZURE_FUNCTION_KEY };
  }
  if (process.env.AZURE_ACCESS_TOKEN) {
    return { Authorization: `Bearer ${process.env.AZURE_ACCESS_TOKEN}` };
  }
  try {
    const result = spawnSync(
      'az',
      [
        'account',
        'get-access-token',
        '--resource',
        'https://management.azure.com',
        '--output',
        'json',
      ],
      { cwd: ROOT, stdio: 'pipe', timeout: 10000, windowsHide: true },
    );
    if (result.status === 0 && result.stdout) {
      const parsed = JSON.parse(result.stdout.toString());
      if (parsed.accessToken) {
        return { Authorization: `Bearer ${parsed.accessToken}` };
      }
    }
  } catch {
    writeLog('Azure CLI token retrieval failed', 'WARN');
  }
  return {};
}

async function invokeSkillOnAzureFunction(
  skill: string,
  input: unknown,
): Promise<{ StatusCode: number; Payload: string }> {
  writeLog(`Invoking skill on Azure Function: ${functionUrl}`, 'INFO');
  const payload = JSON.stringify({
    skillId: skill,
    input,
    timestamp: new Date().toISOString(),
    sessionId: process.env.SESSION_ID ?? '',
  });
  if (invocationType === 'DryRun') {
    writeLog('Dry run detected, skipping actual Azure invocation', 'INFO');
    return {
      StatusCode: 202,
      Payload: JSON.stringify({ success: true, skillId: skill, output: 'Dry run completed' }),
    };
  }
  const headers = getAuthorizationHeaders();
  try {
    const start = Date.now();
    const res = await httpsPost(functionUrl, payload, headers);
    const duration = Math.round(Date.now() - start);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      writeLog('Azure Function invocation successful', 'SUCCESS');
      if (recordMetrics) {
        recordCloudMetrics('Azure', duration, true, 0.00002);
      }
      return { StatusCode: res.statusCode, Payload: res.data };
    }
    throw new Error(`HTTP ${res.statusCode}: ${res.data}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLog(`Azure Function invocation failed: ${msg}`, 'ERROR');
    if (recordMetrics) {
      recordCloudMetrics('Azure', 0, false, 0);
    }
    throw err;
  }
}

async function invokeWithRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  // Circuit breaker v2 (shared, file-state): guards the WHOLE retry loop.
  // Success/failure is recorded on the final outcome — a transient failure
  // recovered by retry no longer counts as a circuit failure.
  const initialDelay = 1000;
  return executeWithCircuit('azure_function', async () => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === retries) {
          const msg = err instanceof Error ? err.message : String(err);
          writeLog(`Failed after ${retries} attempts: ${msg}`, 'ERROR');
          throw err;
        }
        const delay = initialDelay * Math.pow(2, attempt - 1);
        writeLog(`Attempt ${attempt} failed. Retrying in ${delay}ms...`, 'WARN');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error('Unreachable');
  });
}

function recordCloudMetrics(
  provider: string,
  duration: number,
  success: boolean,
  cost: number,
): void {
  let metrics: {
    executions: Array<{
      provider: string;
      timestamp: string;
      duration: number;
      success: boolean;
      cost: number;
    }>;
  } = { executions: [] };
  if (existsSync(METRICS_PATH)) {
    try {
      metrics = JSON.parse(readFileSync(METRICS_PATH, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  metrics.executions.push({
    provider,
    timestamp: new Date().toISOString(),
    duration,
    success,
    cost,
  });
  writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
}

function saveSessionStateToCosmos(sessionState: unknown): void {
  writeLog('Saving session state to Cosmos backup', 'INFO');
  try {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
    const now = new Date();
    const fileName = `azure-session-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.json`;
    writeFileSync(join(BACKUP_DIR, fileName), JSON.stringify(sessionState, null, 2));
    writeLog(`Session state saved to backup: ${fileName}`, 'SUCCESS');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLog(`Failed to save Azure session state: ${msg}`, 'ERROR');
  }
}

function parseArgs(argv: string[]): void {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const key = arg.replace(/^--?/, '');
    const next = argv[i + 1];
    const hasValue = next && !next.startsWith('-');
    switch (key.toLowerCase().replace(/-/g, '')) {
      case 'skillid':
      case 'skill_id':
        if (hasValue) skillId = argv[++i];
        break;
      case 'skillinput':
      case 'skill_input':
        if (hasValue) {
          const raw = argv[++i];
          try {
            skillInput = JSON.parse(raw);
          } catch {
            skillInput = raw;
          }
        }
        break;
      case 'invocationtype':
      case 'invocation_type':
        if (hasValue) invocationType = argv[++i];
        break;
      case 'functionurl':
      case 'function_url':
        if (hasValue) functionUrl = argv[++i];
        break;
      case 'maxretries':
      case 'max_retries':
        if (hasValue) maxRetries = parseInt(argv[++i], 10) || 3;
        break;
      case 'recordmetrics':
      case 'record_metrics':
        recordMetrics = true;
        break;
      case 'quiet':
        quiet = true;
        break;
    }
  }
}

async function main(): Promise<void> {
  parseArgs(process.argv);
  writeLog(`Azure Delegator started for skill: ${skillId}`, 'INFO');
  if (!skillId) {
    throw new Error('SkillId is required');
  }
  if (!functionUrl && invocationType !== 'DryRun') {
    throw new Error(
      'Azure FunctionUrl is required either via parameter or AZURE_FUNCTION_URL environment variable',
    );
  }
  startTracingSpan('azure-invoke');
  try {
    const result = await invokeWithRetry(
      () => invokeSkillOnAzureFunction(skillId, skillInput),
      maxRetries,
    );
    if (recordMetrics) {
      saveSessionStateToCosmos({
        skillId,
        result,
        timestamp: new Date().toISOString(),
        provider: 'Azure',
      });
    }
    stopTracingSpan('azure-invoke', true);
    logAudit('success', 'Azure function invocation completed');
    writeLog('Azure delegator completed successfully', 'SUCCESS');
    console.log(JSON.stringify(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stopTracingSpan('azure-invoke', false, msg);
    logAudit('error', msg);
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    writeLog(`Azure delegator fatal error: ${msg}`, 'ERROR');
    process.exit(1);
  });
}
