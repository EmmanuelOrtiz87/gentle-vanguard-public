#!/usr/bin/env node
/**
 * Findings Ledger — structured lifecycle for review findings.
 *
 * Almacena hallazgos con lifecycle formal:
 *   open → triage → fix → verify → close | wont-fix | escalated
 *
 * Cada hallazgo tiene: id, source, lens, severity, description,
 * evidence, lifecycle state, timestamps, assignee.
 *
 * Flags:
 *   --list              List all findings (default)
 *   --get <id>          Show single finding
 *   --create            Create a new finding (interactive via args)
 *   --update <id>       Transition finding lifecycle
 *   --query <filter>    Query findings by lens/severity/state
 *   --report            Generate summary report
 *   --quiet             Minimal output (pipeline mode)
 *   --dry-run           Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

type FindingState = 'open' | 'triage' | 'fix' | 'verify' | 'close' | 'wont-fix' | 'escalated';
type FindingSeverity = 'info' | 'warning' | 'critical' | 'blocker';
type FindingLens =
  | 'security'
  | 'maintainability'
  | 'reliability'
  | 'resilience'
  | 'general'
  | 'style'
  | 'performance'
  | 'sdd';

interface Finding {
  id: string;
  source: string;
  lens: FindingLens;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: string[];
  state: FindingState;
  stateHistory: { from: FindingState; to: FindingState; timestamp: string; reason: string }[];
  file?: string;
  line?: number;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  metadata: Record<string, unknown>;
}

interface LedgerConfig {
  version: string;
  outputDir: string;
  autoArchiveDays: number;
  maxFindingsPerSource: number;
  requireEvidence: boolean;
}

interface LedgerQuery {
  lens?: FindingLens;
  severity?: FindingSeverity;
  state?: FindingState;
  source?: string;
  file?: string;
  limit?: number;
}

interface LedgerReport {
  total: number;
  byState: Record<FindingState, number>;
  bySeverity: Record<FindingSeverity, number>;
  byLens: Record<FindingLens, number>;
  oldestOpen: string | null;
  avgTimeToClose: number;
}

// ─── Constants ─────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'findings-ledger.json');
const DEFAULT_CONFIG: LedgerConfig = {
  version: '1.0.0',
  outputDir: '.session/findings',
  autoArchiveDays: 90,
  maxFindingsPerSource: 500,
  requireEvidence: true,
};

const VALID_TRANSITIONS: Record<FindingState, FindingState[]> = {
  open: ['triage', 'wont-fix', 'escalated'],
  triage: ['fix', 'wont-fix', 'escalated'],
  fix: ['verify', 'escalated'],
  verify: ['close', 'fix', 'escalated'],
  close: [],
  'wont-fix': [],
  escalated: [],
};

// ─── Helpers ───────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadConfig(): LedgerConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function generateId(): string {
  return `FINDING-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function loadFindings(config: LedgerConfig): Finding[] {
  const dir = join(ROOT, config.outputDir);
  if (!existsSync(dir)) return [];
  const findings: Finding[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      findings.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
    } catch {
      /* skip corrupt */
    }
  }
  return findings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function saveFinding(config: LedgerConfig, finding: Finding): void {
  const dir = join(ROOT, config.outputDir);
  ensureDir(dir);
  const filePath = join(dir, `${finding.id}.json`);
  writeFileSync(filePath, JSON.stringify(finding, null, 2));
}

function log(msg: string, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' = 'INFO', quiet: boolean) {
  if (quiet) return;
  const colors: Record<string, string> = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    SUCCESS: '\x1b[32m',
  };
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`${colors[level] ?? ''}[${ts}] [${level}] ${msg}\x1b[0m`);
}

// ─── Core API ──────────────────────────────────────────────────────────

export function createFinding(opts: {
  source: string;
  lens: FindingLens;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence?: string[];
  file?: string;
  line?: number;
  assignee?: string;
  metadata?: Record<string, unknown>;
  quiet?: boolean;
}): Finding {
  const config = loadConfig();
  const finding: Finding = {
    id: generateId(),
    source: opts.source,
    lens: opts.lens,
    severity: opts.severity,
    title: opts.title,
    description: opts.description,
    evidence: opts.evidence ?? [],
    state: 'open',
    stateHistory: [
      {
        from: 'open' as FindingState,
        to: 'open' as FindingState,
        timestamp: new Date().toISOString(),
        reason: 'Finding created',
      },
    ],
    file: opts.file,
    line: opts.line,
    assignee: opts.assignee,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: opts.metadata ?? {},
  };
  saveFinding(config, finding);
  log(`Created finding ${finding.id}: ${finding.title}`, 'SUCCESS', opts.quiet ?? false);
  return finding;
}

export function transitionFinding(
  id: string,
  toState: FindingState,
  reason: string,
  quiet = false,
): { success: boolean; finding?: Finding; error?: string } {
  const config = loadConfig();
  const findings = loadFindings(config);
  const finding = findings.find((f) => f.id === id);
  if (!finding) return { success: false, error: `Finding not found: ${id}` };

  const currentState = finding.state;
  const allowed = VALID_TRANSITIONS[currentState];
  if (!allowed.includes(toState)) {
    return {
      success: false,
      error: `Invalid transition: ${currentState} → ${toState}. Allowed: ${allowed.join(', ')}`,
    };
  }

  const fromState = finding.state;
  finding.state = toState;
  finding.stateHistory.push({
    from: fromState,
    to: toState,
    timestamp: new Date().toISOString(),
    reason,
  });
  finding.updatedAt = new Date().toISOString();
  if (toState === 'close') finding.closedAt = new Date().toISOString();

  saveFinding(config, finding);
  log(`Transitioned ${id}: ${fromState} → ${toState} (${reason})`, 'SUCCESS', quiet);
  return { success: true, finding };
}

export function queryFindings(query: LedgerQuery): Finding[] {
  const config = loadConfig();
  let findings = loadFindings(config);

  if (query.lens) findings = findings.filter((f) => f.lens === query.lens);
  if (query.severity) findings = findings.filter((f) => f.severity === query.severity);
  if (query.state) findings = findings.filter((f) => f.state === query.state);
  if (query.source) findings = findings.filter((f) => f.source === query.source);
  if (query.file) findings = findings.filter((f) => f.file === query.file);
  if (query.limit) findings = findings.slice(0, query.limit);

  return findings;
}

export function getFinding(id: string): Finding | null {
  const config = loadConfig();
  const findings = loadFindings(config);
  return findings.find((f) => f.id === id) ?? null;
}

export function generateReport(): LedgerReport {
  const config = loadConfig();
  const findings = loadFindings(config);

  const byState = {} as Record<FindingState, number>;
  const bySeverity = {} as Record<FindingSeverity, number>;
  const byLens = {} as Record<FindingLens, number>;

  for (const s of [
    'open',
    'triage',
    'fix',
    'verify',
    'close',
    'wont-fix',
    'escalated',
  ] as FindingState[])
    byState[s] = 0;
  for (const s of ['info', 'warning', 'critical', 'blocker'] as FindingSeverity[])
    bySeverity[s] = 0;
  for (const s of [
    'security',
    'maintainability',
    'reliability',
    'resilience',
    'general',
    'style',
    'performance',
    'sdd',
  ] as FindingLens[])
    byLens[s] = 0;

  let oldestOpen: string | null = null;
  let totalCloseTimeMs = 0;
  let closeCount = 0;

  for (const f of findings) {
    byState[f.state]++;
    bySeverity[f.severity]++;
    byLens[f.lens]++;
    if (f.state === 'open' || f.state === 'triage' || f.state === 'fix' || f.state === 'verify') {
      if (!oldestOpen || f.createdAt < oldestOpen) oldestOpen = f.createdAt;
    }
    if (f.closedAt) {
      totalCloseTimeMs += new Date(f.closedAt).getTime() - new Date(f.createdAt).getTime();
      closeCount++;
    }
  }

  return {
    total: findings.length,
    byState,
    bySeverity,
    byLens,
    oldestOpen,
    avgTimeToClose: closeCount > 0 ? totalCloseTimeMs / closeCount / 3600000 : 0,
  };
}

// ─── CLI Handler ───────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let action = 'list';
  let findingId = '';
  let quiet = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--list':
        action = 'list';
        break;
      case '--get':
        action = 'get';
        findingId = args[++i] ?? '';
        break;
      case '--create':
        action = 'create';
        break;
      case '--update':
        action = 'update';
        findingId = args[++i] ?? '';
        break;
      case '--query':
        action = 'query';
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

  switch (action) {
    case 'list': {
      const findings = queryFindings({});
      if (findings.length === 0) {
        console.log('No findings recorded.');
        break;
      }
      for (const f of findings) {
        console.log(
          `${f.id} | ${f.state.padEnd(8)} | ${f.severity.padEnd(8)} | ${f.lens.padEnd(14)} | ${f.title}`,
        );
      }
      break;
    }
    case 'get': {
      if (!findingId) {
        console.error('Provide finding ID with --get <id>');
        process.exit(1);
      }
      const f = getFinding(findingId);
      if (!f) {
        console.error(`Finding not found: ${findingId}`);
        process.exit(1);
      }
      console.log(JSON.stringify(f, null, 2));
      break;
    }
    case 'create': {
      const f = createFinding({
        source: 'cli',
        lens: 'general',
        severity: 'info',
        title: 'Manual finding',
        description: 'Created via CLI',
        quiet,
      });
      console.log(JSON.stringify(f, null, 2));
      break;
    }
    case 'update': {
      if (!findingId) {
        console.error('Provide finding ID with --update <id>');
        process.exit(1);
      }
      const toState = args.includes('--to')
        ? (args[args.indexOf('--to') + 1] as FindingState)
        : 'close';
      const reason = args.includes('--reason')
        ? args[args.indexOf('--reason') + 1]
        : 'Updated via CLI';
      if (dryRun) {
        console.log(`[DRY-RUN] Would transition ${findingId} → ${toState}: ${reason}`);
        break;
      }
      const result = transitionFinding(findingId, toState, reason, quiet);
      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }
      console.log(JSON.stringify(result.finding, null, 2));
      break;
    }
    case 'query': {
      const lens = args.includes('--lens')
        ? (args[args.indexOf('--lens') + 1] as FindingLens)
        : undefined;
      const severity = args.includes('--severity')
        ? (args[args.indexOf('--severity') + 1] as FindingSeverity)
        : undefined;
      const state = args.includes('--state')
        ? (args[args.indexOf('--state') + 1] as FindingState)
        : undefined;
      const results = queryFindings({ lens, severity, state });
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case 'report': {
      const report = generateReport();
      console.log('\n=== FINDINGS LEDGER REPORT ===');
      console.log(`Total findings: ${report.total}`);
      console.log('\nBy State:');
      for (const [s, c] of Object.entries(report.byState)) console.log(`  ${s}: ${c}`);
      console.log('\nBy Severity:');
      for (const [s, c] of Object.entries(report.bySeverity)) console.log(`  ${s}: ${c}`);
      console.log('\nBy Lens:');
      for (const [s, c] of Object.entries(report.byLens)) console.log(`  ${s}: ${c}`);
      console.log(`\nOldest open finding: ${report.oldestOpen ?? 'N/A'}`);
      console.log(`Avg time to close: ${report.avgTimeToClose.toFixed(1)} hours`);
      break;
    }
  }
}
