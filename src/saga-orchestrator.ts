#!/usr/bin/env node
/**
 * Saga Orchestrator — Coordinates distributed transactions with compensating actions.
 *
 * Implements the Saga pattern for multi-step operations across cloud providers,
 * state persistence, and skill execution. On failure, runs compensating actions
 * to maintain consistency.
 *
 * Migrated from: scripts/utilities/ops/ADVANCED-PATTERNS/saga-orchestrator.ps1
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  appendFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runSync, runNpxTsxSync } from './core/run-command.js';
import { randomBytes } from 'crypto';

const ROOT = resolve(process.cwd());
const SAGA_DIR = join(ROOT, '.session', 'sagas');
const SAGA_LOG = join(ROOT, '.session', 'saga.log');

let quiet = false;

// ─── Security: Path traversal validation ─────────────────────────────────────
function safePath(userPath: string, allowedBase: string): string | null {
  const resolved = resolve(allowedBase, userPath);
  if (!resolved.startsWith(allowedBase)) return null;
  return resolved;
}

function getTsEquivalent(psPath: string): string | null {
  const base =
    psPath
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.ps1$/i, '') ?? '';
  const tsPath = join(ROOT, 'src', `${base}.ts`);
  return existsSync(tsPath) ? tsPath : null;
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO') {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  if (!quiet) console.log(`${colors[level] ?? ''}[${ts}] [SAGA] [${level}] ${msg}\x1b[0m`);
  try {
    appendFileSync(SAGA_LOG, `[${ts}] [${level}] ${msg}\n`);
  } catch {
    /* ignore */
  }
}

function ensureDirs() {
  if (!existsSync(SAGA_DIR)) mkdirSync(SAGA_DIR, { recursive: true });
}

function newSagaId(): string {
  const date = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const rand = randomBytes(3).toString('hex');
  return `saga-${date}-${rand}`;
}

function getSagaPath(id: string): string | null {
  return safePath(`${id}.json`, SAGA_DIR);
}

interface SagaStep {
  name: string;
  type: string;
  script?: string;
  args?: string[];
  url?: string;
  method?: string;
  body?: unknown;
  command?: string;
  label?: string;
  checkpoint?: boolean;
  compensate?: {
    type: string;
    script?: string;
    args?: string[];
    command?: string;
  };
}

interface SagaStepResult {
  name: string;
  type: string;
  status: 'completed' | 'failed';
  durationMs: number;
  error?: string;
  compensated?: boolean;
}

interface SagaState {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  steps: SagaStepResult[];
  currentStep: number;
  context: Record<string, unknown>;
  completedAt?: string;
  compensatedAt?: string;
}

function saveSagaState(state: SagaState): void {
  ensureDirs();
  const path = getSagaPath(state.id);
  if (path) writeFileSync(path, JSON.stringify(state, null, 2));
}

function loadSagaState(id: string): SagaState {
  const path = getSagaPath(id);
  if (!path || !existsSync(path)) throw new Error(`Saga ${id} not found`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

interface StepContext {
  lastCheckpointId?: string;
}

function invokeStep(
  step: SagaStep,
  _context: StepContext,
): { success: boolean; output: unknown; error: string | null; durationMs: number } {
  log(`  Step: ${step.name} [${step.type}]`, 'INFO');
  const start = Date.now();
  const result: { success: boolean; output: unknown; error: string | null } = {
    success: true,
    output: null,
    error: null,
  };

  try {
    switch (step.type) {
      case 'script': {
        if (step.script) {
          const fullPath = join(ROOT, step.script);
          if (existsSync(fullPath)) {
            const tsAlt = getTsEquivalent(fullPath);
            const r = tsAlt
              ? runNpxTsxSync(tsAlt, step.args ?? [], { cwd: ROOT, stdio: 'pipe', timeout: 30000 })
              : runSync('pwsh', ['-NoProfile', '-File', fullPath, ...(step.args ?? [])], {
                  cwd: ROOT,
                  stdio: 'pipe',
                  timeout: 30000,
                });
            result.output = r.stdout;
            result.success = r.status === 0;
          } else {
            result.success = false;
            result.error = `Script not found: ${step.script}`;
          }
        }
        break;
      }
      case 'http': {
        if (step.url) {
          const body = step.body ? JSON.stringify(step.body) : undefined;
          const response = runSync(
            'curl',
            [
              '-s',
              '-X',
              step.method ?? 'POST',
              step.url,
              '-H',
              'Content-Type: application/json',
              ...(body ? ['-d', body] : []),
            ],
            {
              cwd: ROOT,
              stdio: 'pipe',
              timeout: 30000,
            },
          );
          result.output = response.stdout;
          result.success = response.status === 0;
        }
        break;
      }
      case 'pscommand': {
        if (step.command) {
          const r = runSync('pwsh', ['-NoProfile', '-Command', step.command], {
            cwd: ROOT,
            stdio: 'pipe',
            timeout: 30000,
          });
          result.output = r.stdout;
          result.success = r.status === 0;
        }
        break;
      }
      case 'checkpoint': {
        const ckptScript = join(ROOT, 'src/checkpoint-manager.ts');
        if (existsSync(ckptScript)) {
          const r = runNpxTsxSync(
            ckptScript,
            ['create', '--label', step.label ?? 'saga-checkpoint'],
            {
              cwd: ROOT,
              stdio: 'pipe',
              timeout: 15000,
            },
          );
          result.output = r.stdout;
          result.success = r.status === 0;
        } else {
          result.success = false;
          result.error = 'checkpoint-manager.ts not found';
        }
        break;
      }
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  } catch (e: unknown) {
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
  }

  return { ...result, durationMs: Date.now() - start };
}

function invokeCompensation(step: SagaStep, context: StepContext): boolean {
  if (!step.compensate) {
    log(`  No compensation defined for ${step.name}`, 'WARN');
    return true;
  }

  log(`  Compensating: ${step.name}`, 'WARN');

  try {
    const comp = step.compensate;
    switch (comp.type) {
      case 'script': {
        if (comp.script) {
          const fullPath = join(ROOT, comp.script);
          if (existsSync(fullPath)) {
            const tsAlt = getTsEquivalent(fullPath);
            tsAlt
              ? runNpxTsxSync(tsAlt, comp.args ?? [], { cwd: ROOT, stdio: 'pipe', timeout: 30000 })
              : runSync('pwsh', ['-NoProfile', '-File', fullPath, ...(comp.args ?? [])], {
                  cwd: ROOT,
                  stdio: 'pipe',
                  timeout: 30000,
                });
          }
        }
        break;
      }
      case 'rollback': {
        const ckptId = context.lastCheckpointId;
        if (ckptId) {
          const rollbackScript = join(ROOT, 'src/rollback-orchestrator.ts');
          if (existsSync(rollbackScript)) {
            const tsAlt = getTsEquivalent(rollbackScript);
            tsAlt
              ? runNpxTsxSync(tsAlt, ['-CheckpointId', ckptId, '-Force'], {
                  cwd: ROOT,
                  stdio: 'pipe',
                  timeout: 30000,
                })
              : runSync(
                  'pwsh',
                  ['-NoProfile', '-File', rollbackScript, '-CheckpointId', ckptId, '-Force'],
                  { cwd: ROOT, stdio: 'pipe', timeout: 30000 },
                );
          }
        }
        break;
      }
      case 'pscommand': {
        if (comp.command) {
          runSync('pwsh', ['-NoProfile', '-Command', comp.command], {
            cwd: ROOT,
            stdio: 'pipe',
            timeout: 30000,
          });
        }
        break;
      }
      default:
        log(`Unknown compensation type: ${comp.type}`, 'WARN');
    }
    return true;
  } catch (e: unknown) {
    log(`  Compensation failed: ${e instanceof Error ? e.message : String(e)}`, 'ERROR');
    return false;
  }
}

function executeSaga(args: Record<string, string>): SagaState {
  ensureDirs();
  const definitionRaw = args['Definition'];
  if (!definitionRaw) throw new Error('Definition JSON required');

  const definition = JSON.parse(definitionRaw);
  const sagaId = args['SagaId'] ?? newSagaId();

  const state: SagaState = {
    id: sagaId,
    name: definition.name ?? 'Unnamed Saga',
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: [],
    currentStep: 0,
    context: {},
  };

  log(`Saga ${sagaId} started: ${state.name}`, 'SUCCESS');

  const steps: SagaStep[] = definition.steps ?? [];
  let failed = false;

  for (let i = 0; i < steps.length; i++) {
    const stepDef = steps[i];
    state.currentStep = i + 1;

    const result = invokeStep(stepDef, state.context);
    state.steps.push({
      name: stepDef.name,
      type: stepDef.type,
      status: result.success ? 'completed' : 'failed',
      durationMs: result.durationMs,
      error: result.error ?? undefined,
    });

    if (result.success) {
      log(`  Step ${i + 1}/${steps.length} OK (${result.durationMs}ms)`, 'SUCCESS');
      if (stepDef.checkpoint && result.output) {
        try {
          const output = JSON.parse(result.output as string);
          state.context.lastCheckpointId = output.checkpointId;
        } catch {
          /* non-JSON output */
        }
      }
    } else {
      log(`  Step ${i + 1}/${steps.length} FAILED: ${result.error}`, 'ERROR');
      failed = true;

      for (let j = i; j >= 0; j--) {
        const compResult = invokeCompensation(steps[j], state.context);
        state.steps[j].compensated = compResult;
      }
      break;
    }
  }

  state.status = failed ? 'compensated' : 'completed';
  state.completedAt = new Date().toISOString();
  saveSagaState(state);

  if (failed) {
    log(`Saga ${sagaId} compensated after step ${state.currentStep}`, 'ERROR');
  } else {
    log(`Saga ${sagaId} completed successfully`, 'SUCCESS');
  }

  return state;
}

function compensateSaga(args: Record<string, string>): SagaState {
  const sagaId = args['SagaId'];
  if (!sagaId) throw new Error('SagaId required');
  const state = loadSagaState(sagaId);

  if (state.status !== 'completed') {
    throw new Error(
      `Saga ${sagaId} is in status '${state.status}' — can only compensate completed sagas`,
    );
  }

  log(`Triggering compensation for saga ${sagaId} (${state.name})`, 'WARN');
  state.status = 'compensating';

  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step = state.steps[i];
    if (step.name) {
      const compResult = invokeCompensation(
        { name: step.name, type: step.type, compensate: { type: 'rollback' } },
        state.context,
      );
      state.steps[i].compensated = compResult;
    }
  }

  state.status = 'compensated';
  state.compensatedAt = new Date().toISOString();
  saveSagaState(state);
  log(`Saga ${sagaId} fully compensated`, 'WARN');
  return state;
}

function listSagas(): Array<{
  id: string;
  name: string;
  status: string;
  startedAt: string;
  steps: number;
  completedAt?: string;
}> {
  const sagas: Array<{
    id: string;
    name: string;
    status: string;
    startedAt: string;
    steps: number;
    completedAt?: string;
  }> = [];
  if (!existsSync(SAGA_DIR)) return sagas;
  const files = readdirSync(SAGA_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const s: SagaState = JSON.parse(readFileSync(join(SAGA_DIR, file), 'utf-8'));
      sagas.push({
        id: s.id,
        name: s.name,
        status: s.status,
        startedAt: s.startedAt,
        steps: s.steps.length,
        completedAt: s.completedAt,
      });
    } catch {
      /* skip corrupt files */
    }
  }
  return sagas.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

// ===== MAIN =====

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv);
  const action = args['Action'] ?? 'list';
  quiet = args['Quiet'] === 'true';

  try {
    let result: unknown;
    switch (action) {
      case 'execute':
        result = executeSaga(args);
        break;
      case 'compensate':
        result = compensateSaga(args);
        break;
      case 'status': {
        const sagaId = args['SagaId'];
        if (!sagaId) throw new Error('SagaId required');
        result = loadSagaState(sagaId);
        break;
      }
      case 'list':
        result = listSagas();
        break;
      default:
        console.error(`Unknown action: ${action}`);
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Fatal error: ${msg}`, 'ERROR');
    process.exit(1);
  }
}
