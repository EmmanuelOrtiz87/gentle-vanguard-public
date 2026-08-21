#!/usr/bin/env node
/**
 * Root-Cause Correlator — cross-component failure correlation and cascade detection.
 *
 * Pasa de "algo falló" a "esto causó que esto otro falle":
 *   Health Checks + Audit Logs + Tracing → Correlación → Cascada → Remediation
 *
 * Flags:
 *   --correlate    Run full correlation (default)
 *   --cascade      Detect cascading failures only
 *   --remediate    Suggest remediation only
 *   --quiet        Minimal output (pipeline mode)
 *   --dry-run      Preview without saving
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { runNpxTsxSync } from './core/run-command.js';
import { pathToFileURL } from 'url';

// ─── Types ────────────────────────────────────────────────────────────

interface CorrArgs {
  mode: 'correlate' | 'cascade' | 'remediate';
  quiet: boolean;
  dryRun: boolean;
}

interface ComponentHealth {
  component: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  checks: number;
  passed: number;
  failed: number;
  detail: string;
}

interface FailureEvent {
  id: string;
  timestamp: string;
  component: string;
  type: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  message: string;
  source: 'watchtower' | 'audit' | 'telemetry' | 'correction' | 'metric';
}

interface FailureCluster {
  id: string;
  timestamp: string;
  events: FailureEvent[];
  components: string[];
  correlationScore: number;
  timeSpanMinutes: number;
  isCascading: boolean;
  likelyRootCause: string | null;
}

interface CascadeChain {
  id: string;
  rootComponent: string;
  chain: Array<{ component: string; failure: string; depth: number }>;
  confidence: number;
  description: string;
}

interface RemediationAction {
  component: string;
  action: string;
  priority: number;
  dependsOn: string[];
  estimatedEffort: string;
  reason: string;
}

interface CorrOutput {
  timestamp: string;
  components: ComponentHealth[];
  clusters: FailureCluster[];
  cascades: CascadeChain[];
  remediations: RemediationAction[];
  summary: {
    totalComponents: number;
    failedComponents: number;
    clustersFound: number;
    cascadesFound: number;
    rootCauses: string[];
    overallStatus: 'healthy' | 'degraded' | 'critical';
  };
}

// ─── Constants ────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const AUDIT_DIR = join(SESSION_DIR, 'audit', 'logs');
const CORRECTIONS_LOG = join(SESSION_DIR, 'corrections-log.jsonl');
const CORR_DIR = join(SESSION_DIR, 'correlations');
const CORR_CONFIG = join(ROOT, 'config', 'root-cause-correlator.json');
const TELEMETRY_TRACES = join(ROOT, '.telemetry', 'traces');
const TELEMETRY_SPANS = join(ROOT, '.telemetry', 'spans');
const WATCHTOWER_SCRIPT = join(ROOT, 'src', 'maintenance-watchtower.ts');

const COMPONENT_DEPENDENCIES: Record<string, string[]> = {
  'dashboard-ws': [],
  codegraph: ['engram'],
  'ml-embeddings': ['codegraph', 'engram'],
  engram: [],
  mcp: ['codegraph', 'engram'],
  session: ['engram', 'mcp'],
  hooks: [],
  configs: [],
  'tool-configs': [],
  security: ['configs'],
  governance: ['configs', 'security'],
};

const DEFAULT_CONFIG = {
  correlation: {
    timeWindowMinutes: 30,
    minCorrelationScore: 0.3,
    maxComponents: 20,
    maxEvents: 200,
  },
  cascade: { detectEnabled: true, maxDepth: 5, minCascadeConfidence: 0.5 },
  remediation: { enabled: true, autoSuggestOrder: true, maxSuggestions: 5 },
  sources: {
    watchtowerHealth: true,
    auditLogs: true,
    telemetrySpans: true,
    corrections: true,
    metrics: true,
  },
  outputDir: CORR_DIR,
};

// ─── Helpers ──────────────────────────────────────────────────────────

type LogFn = (msg: string) => void;

function loadJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function loadJsonLines(path: string): Record<string, unknown>[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function getLogger(quiet: boolean): LogFn {
  return (msg: string) => {
    if (!quiet) console.log(msg);
  };
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function now(): string {
  return new Date().toISOString();
}

// ─── Data Collection ──────────────────────────────────────────────────

function runWatchtowerHealth(log: LogFn): ComponentHealth[] {
  try {
    const out = runNpxTsxSync(WATCHTOWER_SCRIPT, ['--action', 'health', '--quiet'], {
      cwd: ROOT,
      timeout: 30000,
    }).stdout;
    const components: ComponentHealth[] = [];
    const lines = out.split('\n');

    // Parse component status lines like "  [dashboard-ws] HTTP API: FAIL - ..."
    // and summary line "PASS: 72 | WARN: 3 | FAIL: 3"
    let currentComponent = '';
    for (const line of lines) {
      const compMatch = line.match(/^\s{2}\[([a-z0-9_-]+)\]/);
      if (compMatch) {
        currentComponent = compMatch[1];
        const checkMatch = line.match(/:\s*(PASS|WARN|FAIL)/);
        const status = (checkMatch?.[1] || 'PASS') as 'PASS' | 'WARN' | 'FAIL';
        const detail = line.split(':').slice(2).join(':').trim() || '';

        const existing = components.find((c) => c.component === currentComponent);
        if (existing) {
          existing.checks++;
          if (status === 'FAIL') existing.failed++;
          else if (status === 'PASS') existing.passed++;
          existing.detail += `; ${detail}`;
        } else {
          components.push({
            component: currentComponent,
            status: status === 'FAIL' ? 'FAIL' : status === 'WARN' ? 'WARN' : 'PASS',
            checks: 1,
            passed: status === 'PASS' ? 1 : 0,
            failed: status === 'FAIL' ? 1 : 0,
            detail,
          });
        }
      }
    }

    // Set component status based on failed/passed ratio
    for (const c of components) {
      if (c.failed > 0) c.status = 'FAIL';
      else if (c.checks > c.passed) c.status = 'WARN';
      else c.status = 'PASS';
    }

    log(`  Watchtower: ${components.length} components`);
    return components;
  } catch (e) {
    log(`  Watchtower: failed to run (${e instanceof Error ? e.message : 'unknown'})`);
    return [];
  }
}

function collectAuditErrors(log: LogFn): FailureEvent[] {
  if (!existsSync(AUDIT_DIR)) return [];
  const files = readdirSync(AUDIT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .slice(-10);
  const events: FailureEvent[] = [];

  for (const f of files) {
    const entries = loadJsonLines(join(AUDIT_DIR, f));
    for (const e of entries) {
      const status = (e.status as string) || '';
      const type = (e.type as string) || '';

      if (status === 'failure' || type?.includes('error') || type?.includes('fail')) {
        events.push({
          id: (e.id as string) || `audit-${events.length}`,
          timestamp: (e.timestamp as string) || now(),
          component: (e.component as string) || 'unknown',
          type: type || 'audit.failure',
          severity: 'error',
          message: (e.message as string) || 'Audit failure event',
          source: 'audit',
        });
      }
    }
  }

  log(`  Audit errors: ${events.length}`);
  return events;
}

function collectTelemetryErrors(log: LogFn): FailureEvent[] {
  const events: FailureEvent[] = [];

  // Read span files for error status
  for (const dir of [TELEMETRY_SPANS, TELEMETRY_TRACES]) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 50);
    for (const f of files) {
      try {
        const data = loadJson<Record<string, unknown>>(join(dir, f), {});
        const status = (data.status as string) || '';
        if (status === 'error' || status === 'fail') {
          events.push({
            id: (data.spanId as string) || (data.traceId as string) || `tel-${events.length}`,
            timestamp: (data.startTime as string) || now(),
            component: (data.name as string)?.split('.')[0] || 'unknown',
            type: 'telemetry.error',
            severity: 'error',
            message: `Telemetry span '${(data.name as string) || 'unknown'}' failed`,
            source: 'telemetry',
          });
        }
      } catch {
        /* skip */
      }
    }
  }

  log(`  Telemetry errors: ${events.length}`);
  return events;
}

function collectCorrections(_log: LogFn): FailureEvent[] {
  const entries = loadJsonLines(CORRECTIONS_LOG);
  const events: FailureEvent[] = entries.map((e, i) => ({
    id: `corr-${i}`,
    timestamp: (e.timestamp as string) || now(),
    component: (e.target as string) || 'unknown',
    type: 'correction',
    severity: 'warn',
    message: `Correction: ${(e.action as string) || 'unknown'} on ${(e.target as string) || 'unknown'}`,
    source: 'correction',
  }));
  return events;
}

// ─── Correlation Engine ───────────────────────────────────────────────

function correlateFailures(
  allEvents: FailureEvent[],
  components: ComponentHealth[],
  config: typeof DEFAULT_CONFIG,
): FailureCluster[] {
  if (allEvents.length === 0) return [];

  const windowMs = config.correlation.timeWindowMinutes * 60 * 1000;
  const sorted = [...allEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const clusters: FailureCluster[] = [];
  let clusterId = 0;

  // Group temporally: events within the time window
  for (let i = 0; i < sorted.length; i++) {
    const cluster: FailureEvent[] = [sorted[i]];
    const startTime = new Date(sorted[i].timestamp).getTime();

    for (let j = i + 1; j < sorted.length; j++) {
      const eventTime = new Date(sorted[j].timestamp).getTime();
      if (eventTime - startTime <= windowMs) {
        cluster.push(sorted[j]);
      } else {
        break;
      }
    }

    if (cluster.length >= 2) {
      const comps = [...new Set(cluster.map((e) => e.component))];
      const failedComps = components.filter((c) => c.status === 'FAIL').map((c) => c.component);

      // Score: ratio of failed components in cluster
      const overlappingFailures = comps.filter((c) => failedComps.includes(c)).length;
      const correlationScore = Math.min(
        0.3 + (overlappingFailures / Math.max(comps.length, 1)) * 0.5 + (cluster.length / 20) * 0.2,
        0.95,
      );

      // Find likely root cause (component with most dependencies that failed)
      let likelyRoot: string | null = null;
      let maxDeps = -1;
      for (const c of comps) {
        const deps = COMPONENT_DEPENDENCIES[c] || [];
        if (deps.length > maxDeps && failedComps.includes(c)) {
          maxDeps = deps.length;
          likelyRoot = c;
        }
      }

      clusters.push({
        id: `cluster-${++clusterId}`,
        timestamp: sorted[i].timestamp,
        events: cluster,
        components: comps,
        correlationScore,
        timeSpanMinutes: Math.round(
          (new Date(cluster[cluster.length - 1].timestamp).getTime() - startTime) / 60000,
        ),
        isCascading: false, // will be set later
        likelyRootCause: likelyRoot,
      });
    }

    i += cluster.length - 1;
  }

  // Merge overlapping clusters
  const merged: FailureCluster[] = [];
  for (const c of clusters) {
    const existing = merged.find(
      (m) =>
        m.components.some((mc) => c.components.includes(mc)) &&
        Math.abs(new Date(m.timestamp).getTime() - new Date(c.timestamp).getTime()) <= windowMs,
    );
    if (existing) {
      existing.events.push(...c.events);
      existing.components = [...new Set([...existing.components, ...c.components])];
      existing.timeSpanMinutes = Math.max(existing.timeSpanMinutes, c.timeSpanMinutes);
      existing.correlationScore = Math.max(existing.correlationScore, c.correlationScore);
      if (c.likelyRootCause && !existing.likelyRootCause)
        existing.likelyRootCause = c.likelyRootCause;
    } else {
      merged.push(c);
    }
  }

  return merged.sort((a, b) => b.correlationScore - a.correlationScore).slice(0, 10);
}

// ─── Cascade Detection ────────────────────────────────────────────────

function detectCascading(
  clusters: FailureCluster[],
  components: ComponentHealth[],
  config: typeof DEFAULT_CONFIG,
): CascadeChain[] {
  if (!config.cascade.detectEnabled) return [];
  const cascades: CascadeChain[] = [];
  let cascadeId = 0;

  const failedComps = new Set(
    components.filter((c) => c.status === 'FAIL').map((c) => c.component),
  );

  for (const cluster of clusters) {
    if (!cluster.likelyRootCause) continue;

    // Walk dependency chain from likely root
    const chain: Array<{ component: string; failure: string; depth: number }> = [];
    const visited = new Set<string>();
    const queue: Array<{ component: string; depth: number }> = [
      { component: cluster.likelyRootCause, depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.component)) continue;
      if (current.depth > config.cascade.maxDepth) continue;
      visited.add(current.component);

      if (failedComps.has(current.component) || cluster.components.includes(current.component)) {
        chain.push({
          component: current.component,
          failure: `Failed (dependency of ${cluster.likelyRootCause})`,
          depth: current.depth,
        });
      }

      // Traverse dependencies: find components that depend on current
      for (const [comp, deps] of Object.entries(COMPONENT_DEPENDENCIES)) {
        if (deps.includes(current.component) && !visited.has(comp)) {
          queue.push({ component: comp, depth: current.depth + 1 });
        }
      }
    }

    if (chain.length >= 2) {
      const confidence = Math.min(
        0.4 + (chain.length / 5) * 0.3 + cluster.correlationScore * 0.3,
        0.95,
      );

      if (confidence >= config.cascade.minCascadeConfidence) {
        cluster.isCascading = true;
        cascades.push({
          id: `cascade-${++cascadeId}`,
          rootComponent: cluster.likelyRootCause || 'unknown',
          chain,
          confidence,
          description: `${chain[0].component} failure cascaded to ${chain
            .slice(1)
            .map((c) => c.component)
            .join(' → ')}`,
        });
      }
    }
  }

  return cascades.sort((a, b) => b.confidence - a.confidence);
}

// ─── Remediation ──────────────────────────────────────────────────────

function suggestRemediation(
  cascades: CascadeChain[],
  _clusters: FailureCluster[],
  components: ComponentHealth[],
  config: typeof DEFAULT_CONFIG,
): RemediationAction[] {
  if (!config.remediation.enabled) return [];
  const actions: RemediationAction[] = [];
  const failedComps = components.filter((c) => c.status === 'FAIL');

  // Remediation from cascades: fix root first
  for (const cascade of cascades) {
    if (!actions.some((a) => a.component === cascade.rootComponent)) {
      actions.push({
        component: cascade.rootComponent,
        action: `Restore ${cascade.rootComponent} — root cause of cascade affecting ${cascade.chain.length - 1} downstream component(s)`,
        priority: 1,
        dependsOn: [],
        estimatedEffort: 'medium',
        reason: cascade.description,
      });
    }

    for (let i = 1; i < cascade.chain.length; i++) {
      const c = cascade.chain[i];
      if (!actions.some((a) => a.component === c.component)) {
        actions.push({
          component: c.component,
          action: `Verify ${c.component} after ${cascade.rootComponent} is restored`,
          priority: i + 1,
          dependsOn: [cascade.rootComponent],
          estimatedEffort: 'low',
          reason: `Cascading failure from ${cascade.rootComponent}`,
        });
      }
    }
  }

  // Remediation for independent failures
  for (const c of failedComps) {
    if (!actions.some((a) => a.component === c.component)) {
      const isInCascade = cascades.some((ca) =>
        ca.chain.some((ch) => ch.component === c.component),
      );
      if (!isInCascade) {
        actions.push({
          component: c.component,
          action: `Investigate and restore ${c.component} — independent failure`,
          priority: 3,
          dependsOn: [],
          estimatedEffort: 'medium',
          reason: `${c.failed}/${c.checks} checks failed`,
        });
      }
    }
  }

  // Sort by dependency order
  const sorted: RemediationAction[] = [];
  const added = new Set<string>();
  while (actions.length > 0) {
    const ready = actions.filter((a) => a.dependsOn.every((d) => added.has(d)));
    if (ready.length === 0) {
      sorted.push(...actions);
      break;
    }
    for (const r of ready) {
      sorted.push(r);
      added.add(r.component);
    }
    actions.splice(0, actions.length, ...actions.filter((a) => !ready.includes(a)));
  }

  return sorted.slice(0, config.remediation.maxSuggestions);
}

// ─── Main ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CorrArgs {
  const args: CorrArgs = { mode: 'correlate', quiet: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--correlate') args.mode = 'correlate';
    else if (arg === '--cascade') args.mode = 'cascade';
    else if (arg === '--remediate') args.mode = 'remediate';
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--dry-run') args.dryRun = true;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);
  const log = getLogger(args.quiet);

  log('[ROOT-CAUSE-CORRELATOR] Starting...');

  const config = loadJson<typeof DEFAULT_CONFIG>(CORR_CONFIG, DEFAULT_CONFIG);
  const outputDir = join(ROOT, config.outputDir);
  ensureDir(outputDir);

  // 1. Collect data
  log('Collecting data...');
  const components = config.sources.watchtowerHealth ? runWatchtowerHealth(log) : [];
  const auditErrors = config.sources.auditLogs ? collectAuditErrors(log) : [];
  const telemetryErrors = config.sources.telemetrySpans ? collectTelemetryErrors(log) : [];
  const correctionEvents = config.sources.corrections ? collectCorrections(log) : [];

  const allEvents = [...auditErrors, ...telemetryErrors, ...correctionEvents];

  const failedComps = components.filter((c) => c.status === 'FAIL').length;
  const warnComps = components.filter((c) => c.status === 'WARN').length;
  log(`  Failed: ${failedComps}, Warn: ${warnComps}, Events: ${allEvents.length}`);

  // 2. Correlate failures
  let clusters: FailureCluster[] = [];
  if (args.mode === 'correlate' || args.mode === 'cascade') {
    log('Correlating failures...');
    clusters = correlateFailures(allEvents, components, config);
    log(`  Clusters: ${clusters.length}`);
    for (const c of clusters.slice(0, 3)) {
      log(
        `    ${c.id}: ${c.components.join(', ')} (score: ${(c.correlationScore * 100).toFixed(0)}%, root: ${c.likelyRootCause || 'unknown'})`,
      );
    }
  }

  // 3. Detect cascading
  let cascades: CascadeChain[] = [];
  if (args.mode === 'correlate' || args.mode === 'cascade') {
    log('Detecting cascading failures...');
    cascades = detectCascading(clusters, components, config);
    log(`  Cascades: ${cascades.length}`);
    for (const c of cascades) {
      log(`    ${c.id}: ${c.rootComponent} → ${c.chain.length - 1} downstream`);
    }
  }

  // 4. Suggest remediation
  let remediations: RemediationAction[] = [];
  if (args.mode === 'correlate' || args.mode === 'remediate') {
    log('Suggesting remediation...');
    remediations = suggestRemediation(cascades, clusters, components, config);
    log(`  Remediations: ${remediations.length}`);
    for (const r of remediations) {
      log(`    [P${r.priority}] ${r.component}: ${r.action}`);
    }
  }

  // 5. Summary
  const rootCauses = [...new Set(cascades.map((c) => c.rootComponent))];
  const overallStatus: 'healthy' | 'degraded' | 'critical' =
    failedComps > 2 ? 'critical' : failedComps > 0 ? 'degraded' : 'healthy';

  const output: CorrOutput = {
    timestamp: now(),
    components,
    clusters,
    cascades,
    remediations,
    summary: {
      totalComponents: components.length,
      failedComponents: failedComps,
      clustersFound: clusters.length,
      cascadesFound: cascades.length,
      rootCauses,
      overallStatus,
    },
  };

  if (!args.dryRun) {
    const outFile = join(outputDir, `correlation-${now().slice(0, 10)}.json`);
    writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf-8');
    log(`[OK] Correlation report saved: ${outFile}`);
  }

  if (!args.quiet) {
    console.log(
      JSON.stringify({
        components: output.summary.totalComponents,
        failed: output.summary.failedComponents,
        clusters: output.summary.clustersFound,
        cascades: output.summary.cascadesFound,
        rootCauses: output.summary.rootCauses.length,
        status: output.summary.overallStatus,
      }),
    );
  }

  log('[ROOT-CAUSE-CORRELATOR] Done');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
