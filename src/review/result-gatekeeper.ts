#!/usr/bin/env node
/**
 * Result Gatekeeper — contract validation between pipeline phases.
 *
 * Implementa el patrón "Don't trust the phase's word for it, check the work product".
 * Cada fase del pipeline define un contrato de salida. El gatekeeper valida
 * que el output cumpla el contrato antes de permitir el avance a la siguiente fase.
 *
 * Fases del pipeline con contratos:
 *   session-manager → engram-policy: session ID válido, archivo .session creado
 *   engram-policy → security-orchestrator: Engram OK, DB íntegra
 *   security-orchestrator → skill-router: políticas cargadas, privacy config OK
 *   skill-router → session-scoring: router activo, skills detectados
 
 * Cada contrato tiene: precondiciones, validaciones, postcondiciones.
 *
 * Flags:
 *   --verify <phase>   Verify contract for a specific phase
 *   --list             List all phase contracts
 *   --report           Generate compliance report
 *   --quiet            Minimal output (pipeline mode)
 *   --dry-run          Preview without checking
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { loadConfigFile } from '../core/config-loader.js';

const _require = createRequire(import.meta.url);

// Lazy db import for SQLite dual-write

/** Minimal DatabaseManager surface used for contract-result dual-write. */
interface DbManagerLike {
  insertContractResult(
    phase: string,
    status: string,
    sessionId: string | undefined,
    detailsJson: string,
  ): unknown;
}

let _db: DbManagerLike | null = null;
function getDb(): DbManagerLike | null {
  if (!_db) {
    try {
      const mod = _require('../database/nexus//manager');
      _db = mod.DatabaseManager.getInstance();
    } catch {
      // SQLite not available — skip dual-write
    }
  }
  return _db;
}

/**
 * DI injection point (STACK-EVOLUTION-PLAN F2.6 batch 2).
 * Container-injected db handle takes precedence over the lazy require().
 */
export function setGatekeeperDb(handle: DbManagerLike | null): void {
  _db = handle;
}

// ─── Types ────────────────────────────────────────────────────────────

type ContractStatus = 'pass' | 'fail' | 'skip' | 'error';

interface PhaseContract {
  phase: string;
  description: string;
  preconditions: string[];
  validations: Validation[];
  postconditions: string[];
}

interface Validation {
  id: string;
  description: string;
  check:
    | 'file_exists'
    | 'file_not_empty'
    | 'json_valid'
    | 'json_has_key'
    | 'dir_exists'
    | 'process_running'
    | 'custom';
  target: string;
  param?: string;
}

interface ContractResult {
  phase: string;
  timestamp: string;
  status: ContractStatus;
  validationResults: { id: string; status: ContractStatus; detail: string }[];
  preconditionsMet: boolean;
  postconditionsMet: boolean;
  summary: string;
}

interface GatekeeperConfig {
  version: string;
  outputDir: string;
  failOnContractViolation: boolean;
  logOnly: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const DEFAULT_CONFIG: GatekeeperConfig = {
  version: '1.0.0',
  outputDir: '.session/contract-results',
  failOnContractViolation: false,
  logOnly: true,
};

const PHASE_CONTRACTS: PhaseContract[] = [
  {
    phase: 'session-manager',
    description: 'Session initialization contract',
    preconditions: ['Workspace is accessible', 'Config files exist'],
    validations: [
      {
        id: 'session-dir-exists',
        description: 'Session directory exists',
        check: 'dir_exists',
        target: '.session',
      },
      {
        id: 'session-file-exists',
        description: 'Session file was created',
        check: 'file_exists',
        target: '.session/session-current.json',
      },
      {
        id: 'session-id-valid',
        description: 'Session ID is valid',
        check: 'json_has_key',
        target: '.session/session-current.json',
        param: 'sessionId',
      },
    ],
    postconditions: ['Session is ready for next phase', 'Engram can be initialized'],
  },
  {
    phase: 'engram-policy',
    description: 'Engram integrity contract',
    preconditions: ['Session manager completed', 'Engram CLI available'],
    validations: [
      {
        id: 'engram-db-exists',
        description: 'Engram database exists',
        check: 'file_exists',
        target: '.engram/engram.db',
      },
      {
        id: 'engram-config-exists',
        description: 'Engram policy config exists',
        check: 'file_exists',
        target: 'config/engram-policy.json',
      },
    ],
    postconditions: ['Engram is operational', 'Memory persistence available'],
  },
  {
    phase: 'security-orchestrator',
    description: 'Security initialization contract',
    preconditions: ['Engram is running', 'Config files are valid'],
    validations: [
      {
        id: 'security-config-exists',
        description: 'Security config exists',
        check: 'file_exists',
        target: 'config/security-config.json',
      },
      {
        id: 'security-config-valid',
        description: 'Security config is valid JSON',
        check: 'json_valid',
        target: 'config/security-config.json',
      },
    ],
    postconditions: ['Security policies loaded', 'Privacy config applied'],
  },
  {
    phase: 'skill-router',
    description: 'Skill routing contract',
    preconditions: ['Security initialized', 'Skills directory exists'],
    validations: [
      {
        id: 'skill-dir-exists',
        description: 'Skills directory exists',
        check: 'dir_exists',
        target: '.opencode/skills',
      },
      {
        id: 'opencode-config-valid',
        description: 'OpenCode config is valid',
        check: 'json_valid',
        target: 'opencode.json',
      },
    ],
    postconditions: ['Skills are discoverable', 'Router is active'],
  },
  {
    phase: 'karpathy-guidelines',
    description: 'Karpathy guidelines contract',
    preconditions: ['Router is active'],
    validations: [
      {
        id: 'karpathy-config-exists',
        description: 'Karpathy config exists',
        check: 'file_exists',
        target: 'config/karpathy-enforcer.json',
      },
    ],
    postconditions: ['Guidelines enforced for session'],
  },
  {
    phase: 'session-metrics-start',
    description: 'Session metrics contract',
    preconditions: ['Session initialized'],
    validations: [
      {
        id: 'metrics-config-exists',
        description: 'Metrics config exists',
        check: 'file_exists',
        target: 'config/session-metrics-tracker.json',
      },
    ],
    postconditions: ['Metrics collection started'],
  },
  {
    phase: 'token-budget',
    description: 'Token budget contract',
    preconditions: ['Metrics initialized'],
    validations: [
      {
        id: 'token-config-exists',
        description: 'Token budget config exists',
        check: 'file_exists',
        target: 'config/token-budget-guard.json',
      },
    ],
    postconditions: ['Token budget tracked', 'Budget limits respected'],
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadConfig(): GatekeeperConfig {
  return loadConfigFile<GatekeeperConfig>('result-gatekeeper', { defaults: DEFAULT_CONFIG }).data;
}

function checkValidation(validation: Validation): { status: ContractStatus; detail: string } {
  const targetPath = join(ROOT, validation.target);

  switch (validation.check) {
    case 'file_exists':
      return existsSync(targetPath)
        ? { status: 'pass', detail: `File exists: ${validation.target}` }
        : { status: 'fail', detail: `File not found: ${validation.target}` };

    case 'dir_exists':
      return existsSync(targetPath)
        ? { status: 'pass', detail: `Directory exists: ${validation.target}` }
        : { status: 'fail', detail: `Directory not found: ${validation.target}` };

    case 'file_not_empty':
      if (!existsSync(targetPath))
        return { status: 'fail', detail: `File not found: ${validation.target}` };
      try {
        const content = readFileSync(targetPath, 'utf-8');
        return content.trim().length > 0
          ? { status: 'pass', detail: `File is not empty: ${validation.target}` }
          : { status: 'fail', detail: `File is empty: ${validation.target}` };
      } catch {
        return { status: 'error', detail: `Cannot read: ${validation.target}` };
      }

    case 'json_valid':
      if (!existsSync(targetPath))
        return { status: 'fail', detail: `File not found: ${validation.target}` };
      try {
        JSON.parse(readFileSync(targetPath, 'utf-8'));
        return { status: 'pass', detail: `Valid JSON: ${validation.target}` };
      } catch {
        return { status: 'fail', detail: `Invalid JSON: ${validation.target}` };
      }

    case 'json_has_key':
      if (!existsSync(targetPath))
        return { status: 'fail', detail: `File not found: ${validation.target}` };
      try {
        const data = JSON.parse(readFileSync(targetPath, 'utf-8'));
        const keys = (validation.param ?? '').split('.');
        let current: unknown = data;
        for (const key of keys) {
          if (
            current &&
            typeof current === 'object' &&
            key in (current as Record<string, unknown>)
          ) {
            current = (current as Record<string, unknown>)[key];
          } else {
            return {
              status: 'fail',
              detail: `Key '${validation.param}' not found in ${validation.target}`,
            };
          }
        }
        return {
          status: 'pass',
          detail: `Key '${validation.param}' found in ${validation.target}`,
        };
      } catch {
        return { status: 'error', detail: `Cannot parse ${validation.target}` };
      }

    case 'process_running':
      try {
        const result = runSync('tasklist', ['/FI', `IMAGENAME eq ${validation.target}`], {
          timeout: 5000,
        }).stdout;
        return result.includes(validation.target)
          ? { status: 'pass', detail: `Process running: ${validation.target}` }
          : { status: 'fail', detail: `Process not found: ${validation.target}` };
      } catch {
        return { status: 'skip', detail: `Cannot check process: ${validation.target}` };
      }

    default:
      return { status: 'skip', detail: `Unknown check: ${validation.check}` };
  }
}

// ─── Core API ──────────────────────────────────────────────────────────

export function verifyContract(phase: string): ContractResult {
  const config = loadConfig();
  const contract = PHASE_CONTRACTS.find((c) => c.phase === phase);
  if (!contract) {
    return {
      phase,
      timestamp: new Date().toISOString(),
      status: 'skip',
      validationResults: [],
      preconditionsMet: false,
      postconditionsMet: false,
      summary: `No contract defined for phase: ${phase}`,
    };
  }

  const validationResults = contract.validations.map((v) => ({
    id: v.id,
    ...checkValidation(v),
  }));

  const allPassed = validationResults.every((r) => r.status === 'pass');
  const anyFailed = validationResults.some((r) => r.status === 'fail');
  const status: ContractStatus = allPassed ? 'pass' : anyFailed ? 'fail' : 'error';

  const result: ContractResult = {
    phase,
    timestamp: new Date().toISOString(),
    status,
    validationResults,
    preconditionsMet: allPassed,
    postconditionsMet: allPassed,
    summary: allPassed
      ? `Contract '${phase}': ALL VALIDATIONS PASSED`
      : `Contract '${phase}': ${validationResults.filter((r) => r.status === 'fail').length} FAILURES`,
  };

  // Save result
  const dir = join(ROOT, config.outputDir);
  ensureDir(dir);
  writeFileSync(join(dir, `${phase}-${Date.now()}.json`), JSON.stringify(result, null, 2));

  // SQLite dual-write
  try {
    const mgr = getDb();
    if (mgr) {
      mgr.insertContractResult(
        phase,
        status,
        process.env.SESSION_ID,
        JSON.stringify({ summary: result.summary, validations: validationResults.length }),
      );
    }
  } catch {
    // Dual-write failure is non-critical
  }

  return result;
}

export function verifyAllContracts(): ContractResult[] {
  return PHASE_CONTRACTS.map((c) => verifyContract(c.phase));
}

export function listContracts(): PhaseContract[] {
  return PHASE_CONTRACTS;
}

export function getContract(phase: string): PhaseContract | undefined {
  return PHASE_CONTRACTS.find((c) => c.phase === phase);
}

// ─── CLI Handler ───────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let action = 'list';
  let phase = '';
  let quiet = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--verify':
        action = 'verify';
        phase = args[++i] ?? '';
        break;
      case '--list':
        action = 'list';
        break;
      case '--report':
        action = 'report';
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
    }
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Would run gatekeeper action=${action} phase=${phase}`);
    process.exit(0);
  }

  switch (action) {
    case 'list': {
      const contracts = listContracts();
      console.log('\n=== PHASE CONTRACTS ===');
      for (const c of contracts) {
        console.log(`\n${c.phase}: ${c.description}`);
        console.log(`  Validations: ${c.validations.map((v) => v.id).join(', ')}`);
      }
      break;
    }
    case 'verify': {
      if (!phase || phase === 'all') {
        // verify all
        const results = verifyAllContracts();
        if (!quiet) {
          console.log('\n=== GATEKEEPER RESULTS ===');
          let pass = 0,
            fail = 0;
          for (const r of results) {
            const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';
            console.log(`${icon} ${r.phase}: ${r.summary}`);
            if (r.status === 'pass') pass++;
            else fail++;
          }
          console.log(`\n${pass} passed, ${fail} failed`);
        } else {
          console.log(JSON.stringify(results, null, 2));
        }
      } else {
        const result = verifyContract(phase);
        if (!quiet) {
          const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
          console.log(`${icon} ${result.phase}: ${result.summary}`);
          for (const v of result.validationResults) {
            const vIcon = v.status === 'pass' ? '✅' : v.status === 'fail' ? '❌' : '⚠️';
            console.log(`  ${vIcon} ${v.id}: ${v.detail}`);
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
      break;
    }
    case 'report': {
      const results = verifyAllContracts();
      const passed = results.filter((r) => r.status === 'pass').length;
      const failed = results.filter((r) => r.status === 'fail').length;
      console.log('\n=== GATEKEEPER COMPLIANCE REPORT ===');
      console.log(`Generated: ${new Date().toISOString()}`);
      console.log(`Contracts: ${results.length}`);
      console.log(`Passed: ${passed}`);
      console.log(`Failed: ${failed}`);
      console.log(
        `Compliance: ${results.length > 0 ? Math.round((passed / results.length) * 100) : 100}%`,
      );
      break;
    }
  }
}
