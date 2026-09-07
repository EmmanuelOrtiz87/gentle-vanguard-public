#!/usr/bin/env node

// Maintenance Watchtower — orchestrator (F2.5 split).
//
// The 24 per-component checks now live in src/core/watchtower/checks-*.ts,
// shared helpers in src/core/watchtower/helpers.ts, rebuild actions in
// src/core/watchtower/rebuild.ts and shared state in src/core/watchtower/context.ts.
// This file keeps only the orchestration: autoHeal, report generation, arg
// parsing, check scheduling, witr tracing and the CLI entry point.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { runNpxTsx } from './run-command';
import { runHygiene } from './process-hygiene';
import {
  sweepStaleSessions,
  resolveSweepDbPath,
  DEFAULT_STALE_HOURS,
  DEFAULT_PROTECT_HOURS,
  DEFAULT_IDLE_WINDOW_DAYS,
} from '../session/stale-session-sweeper';
import { witr, ensureWitrInstalled } from '../web/witr-wrapper';
import {
  results,
  quiet,
  setQuiet,
  getExitCode,
  addResult,
  ROOT,
  RUNTIME_DIR,
} from './watchtower/context';
import { fileExists, readJson, testPort, isCodeGraphProcessRunning } from './watchtower/helpers';
import { checkDashboardWs, checkGvAnalytics } from './watchtower/checks-dashboard';
import {
  checkCodeGraph,
  checkTimeoutDaemon,
  checkProcessHygiene,
  checkMlEmbeddings,
  checkEngram,
  checkMcp,
  checkLoopGuard,
  checkGuardrails,
} from './watchtower/checks-infra';
import {
  checkSessionPipeline,
  checkHooks,
  checkConfigs,
  checkToolConfigs,
  checkMissingScripts,
} from './watchtower/checks-config';
import {
  checkSecurity,
  checkSecretScanner,
  checkCliGuard,
  checkHiddenSpawns,
  checkCloudConnectors,
  checkWebCrawler,
  checkAgentGovernance,
  checkGitHistorySecrets,
} from './watchtower/checks-security';
import {
  checkTracing,
  checkStatePersistence,
  checkGentleVanguardDb,
  checkModelHealth,
  checkAuditPipeline,
  checkGovernance,
} from './watchtower/checks-data';
import { rebuildMlEmbeddings, reindexEngramRag } from './watchtower/rebuild';

// ─── Auto-Heal ──────────────────────────────────────────────────────────────

async function autoHeal() {
  if (!quiet) console.log('\n  -- Auto-Heal Phase --');

  const needsRestart = results.filter((r) => r.action === 'restart' && r.status !== 'PASS');
  const needsStart = results.filter((r) => r.action === 'start' && r.status !== 'PASS');
  const needsCleanup = results.filter((r) => r.action === 'cleanup' && r.status !== 'PASS');

  let healed = 0;
  let failed = 0;

  // Process hygiene reap — duplicates, hung one-shots, stale PID files and
  // leftover headless chrome are all fixed by the same action: reaping.
  if (needsCleanup.length > 0) {
    if (!quiet) console.log('  [Heal] Reaping orphan/duplicate processes...');
    try {
      const res = await runHygiene({ apply: true, recycleAged: false });
      const remaining = res.findings.filter(
        (f) =>
          f.action !== 'report' &&
          !(res.killed.includes(f.pid) || res.cleanedFiles.includes(f.cmdline)),
      );
      if (remaining.length === 0) {
        addResult(
          'process-hygiene',
          'autoheal',
          'PASS',
          `reaped ${res.killed.length} process(es), cleaned ${res.cleanedFiles.length} pid file(s)`,
          'ok',
        );
        healed++;
      } else {
        addResult(
          'process-hygiene',
          'autoheal',
          'FAIL',
          `${remaining.length} finding(s) survived the reap`,
          'manual',
        );
        failed++;
      }
    } catch (e: unknown) {
      addResult(
        'process-hygiene',
        'autoheal',
        'FAIL',
        `reap failed: ${e instanceof Error ? e.message : String(e)}`,
        'manual',
      );
      failed++;
    }
  }

  // Stale session sweep — sessions whose status never transitions to terminal
  // (the close orchestrator does not update the sessions table) starve the
  // continuous-eval dataset and the learnable routing table. Idempotent and
  // gated by staleness heuristics; live sessions (<2h) are never touched.
  if (!quiet) console.log('  [Heal] Sweeping stale sessions...');
  try {
    const sweepDbPath = resolveSweepDbPath();
    if (existsSync(sweepDbPath)) {
      const sweepDb = new Database(sweepDbPath);
      try {
        const sweep = sweepStaleSessions(sweepDb, {
          staleHours: DEFAULT_STALE_HOURS,
          protectHours: DEFAULT_PROTECT_HOURS,
          idleWindowDays: DEFAULT_IDLE_WINDOW_DAYS,
          apply: true,
          dbPath: sweepDbPath,
          syncContextLog: true,
          repoRoot: ROOT,
        });
        addResult(
          'gentle-vanguard-db',
          'autoheal',
          'PASS',
          `stale-session sweep: ${sweep.counts.idle} idle / ${sweep.counts.completed} completed / ` +
            `${sweep.counts.abandoned} abandoned (${sweep.remainingActive} active remaining)`,
          'ok',
        );
        healed++;
      } finally {
        sweepDb.close();
      }
    }
  } catch (e: unknown) {
    addResult(
      'gentle-vanguard-db',
      'autoheal',
      'FAIL',
      `stale-session sweep failed: ${e instanceof Error ? e.message : String(e)}`,
      'manual',
    );
    failed++;
  }

  if (needsRestart.length === 0 && needsStart.length === 0) {
    if (!quiet) console.log('  No components need healing');
    return;
  }

  // Dashboard WS server restart
  const dashFail = [...needsRestart, ...needsStart].filter((r) => r.component === 'dashboard-ws');
  if (dashFail.length > 0) {
    let wsPort = 8080;
    const portsFile = join(RUNTIME_DIR, 'dashboard-ports.json');
    if (fileExists(portsFile)) {
      try {
        const ports = readJson(portsFile);
        wsPort = typeof ports.wsPort === 'number' ? ports.wsPort : 8080;
      } catch {
        /* port file parse error, use default */
      }
    }

    const wsRunning = await testPort(wsPort);
    const wsAutostart = join(ROOT, 'src', 'ops', 'dashboard-ws-autostart.ts');

    if (wsRunning) {
      if (!quiet)
        console.log(`  [Heal] WS alive on port ${wsPort}, no action needed (watchdog optional)`);
      addResult('dashboard-ws', 'autoheal', 'PASS', 'WS alive, watchdog skipped', 'ok');
      healed++;
    } else if (wsAutostart.endsWith('.ts')) {
      // Use TS wrapper for reliable Windows process launching
      const wrapperTs = join(ROOT, 'src', 'ops', 'dashboard-ws-launcher.ts');
      if (!quiet) console.log('  [Heal] Restarting Dashboard WS server via wrapper...');
      try {
        // Launch via TS wrapper - creates truly detached process
        const child = runNpxTsx(wrapperTs, ['--quiet'], {
          cwd: ROOT,
          stdio: 'ignore',
          windowsHide: true,
          detached: true,
        });
        child.unref();

        // Wait for process to start and check if port is up
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Verify by checking if port is now responding
        const isPortUp = await testPort(wsPort);
        if (isPortUp) {
          addResult(
            'dashboard-ws',
            'autoheal',
            'PASS',
            `Restarted (port ${wsPort} responding)`,
            'ok',
          );
          healed++;
        } else {
          // Try fallback to direct tsx launch
          if (!quiet) console.log('  [Heal] Wrapper launch incomplete, trying direct spawn...');
          const fallback = runNpxTsx(wsAutostart, ['--quiet'], {
            cwd: ROOT,
            stdio: 'ignore',
            detached: true,
            windowsHide: true,
          });
          fallback.unref();
          await new Promise((resolve) => setTimeout(resolve, 10000));

          const fallbackCheck = await testPort(wsPort);
          if (fallbackCheck) {
            addResult(
              'dashboard-ws',
              'autoheal',
              'PASS',
              `Restarted via fallback (port ${wsPort} responding)`,
              'ok',
            );
            healed++;
          } else {
            addResult(
              'dashboard-ws',
              'autoheal',
              'FAIL',
              'Restart failed - port not responding',
              'manual',
              true,
            );
            failed++;
          }
        }
      } catch (e: unknown) {
        addResult(
          'dashboard-ws',
          'autoheal',
          'FAIL',
          `Error: ${e instanceof Error ? e.message : String(e)}`,
          'manual',
          true,
        );
        failed++;
      }
    } else {
      if (!quiet) console.log('    No dashboard-ws-autostart script found');
      addResult('dashboard-ws', 'autoheal', 'FAIL', 'No autostart script found', 'manual', true);
      failed++;
    }
  }

  // CodeGraph server restart
  const cgFail = needsRestart.filter((r) => r.component === 'codegraph');
  if (cgFail.length > 0) {
    if (!quiet) console.log('  [Heal] Restarting CodeGraph serve...');
    try {
      // Delegate to the canonical daemon script (src/integrations/codegraph-mcp-server-start.ts).
      // It spawns `node codegraph.js serve --mcp` with an OPEN stdin pipe (keeping
      // the stdio MCP server alive) and writes the real server PID itself.
      //
      // IMPORTANT: spawning `codegraph serve --mcp` directly with stdio:'ignore'
      // would close stdin -> the server exits instantly, and a second instance
      // competing for the codegraph index lock can kill an already-running
      // daemon. Delegating to the daemon script avoids both failure modes.
      const child = runNpxTsx(
        join(ROOT, 'src', 'integrations', 'codegraph-mcp-server-start.ts'),
        [],
        {
          cwd: ROOT,
          stdio: 'ignore',
          detached: true,
          windowsHide: true,
        },
      );
      child.unref();
      // Give the daemon time to boot (npx+tsx resolution + server start).
      // The stdio MCP server does NOT open a TCP port, so liveness must be
      // determined by the process table and the PID file written by the
      // daemon script. A single 6s probe is racy (spawn + npx+tsx resolution
      // can exceed it), so poll with retries up to ~20s.
      let up = false;
      for (let attempt = 0; attempt < 5 && !up; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        up = isCodeGraphProcessRunning();
        if (!up) {
          // The daemon script writes the real server PID; trust it as a
          // secondary signal even if the process-table scan is still racing.
          const pidFile = join(RUNTIME_DIR, 'codegraph-mcp-server.pid');
          if (fileExists(pidFile)) {
            try {
              const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
              if (!isNaN(pid)) {
                try {
                  process.kill(pid, 0);
                  up = true;
                } catch {
                  /* PID not alive yet */
                }
              }
            } catch {
              /* unreadable PID file */
            }
          }
        }
      }
      if (up) {
        addResult('codegraph', 'autoheal', 'PASS', `Restarted (PID ${child.pid})`, 'ok');
        healed++;
      } else {
        addResult(
          'codegraph',
          'autoheal',
          'FAIL',
          'Restart failed - no server process detected after 20s',
          'manual',
          true,
        );
        failed++;
      }
    } catch {
      failed++;
    }
  }

  if (!quiet) console.log(`  Healed: ${healed} | Failed: ${failed}`);
}

// ─── Summary ────────────────────────────────────────────────────────────────

function generateReport(outputPath?: string) {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  const total = results.length;

  const byComponentMap = new Map<
    string,
    { pass: number; warn: number; fail: number; skip: number }
  >();
  for (const r of results) {
    if (!byComponentMap.has(r.component))
      byComponentMap.set(r.component, { pass: 0, warn: 0, fail: 0, skip: 0 });
    const c = byComponentMap.get(r.component) ?? { pass: 0, warn: 0, fail: 0, skip: 0 };
    c[r.status.toLowerCase() as keyof typeof c]++;
  }
  const byComponent = Array.from(byComponentMap.entries()).map(([name, counts]) => ({
    component: name,
    status: counts.fail > 0 ? 'ISSUES' : ('OK' as const),
    fails: counts.fail,
    pass: counts.pass,
    warn: counts.warn,
    skip: counts.skip,
  }));

  const report = {
    watchtowerVersion: '2.0.0',
    timestamp: new Date().toISOString(),
    summary: { pass, warn, fail, skip, total },
    byComponent,
    findings: results,
  };

  console.log(`\n=======================================`);
  console.log(`  PASS: ${pass} | WARN: ${warn} | FAIL: ${fail} | SKIP: ${skip} | Total: ${total}`);

  for (const c of byComponent) {
    const icon = c.status === 'OK' ? '  ' : '  ';
    console.log(`    ${icon}${c.component}: ${c.status}`);
  }

  if (outputPath) {
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`  Report: ${outputPath}`);
  }

  console.log(`=======================================`);

  return report;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean | number> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-Action' || args[i] === '--action') {
      flags.action = (args[++i] || 'health').toLowerCase();
    } else if (args[i] === '-Quiet' || args[i] === '--quiet') {
      flags.quiet = true;
    } else if (args[i] === '-OutputFile' || args[i] === '--output') {
      flags.output = args[++i];
    } else if (args[i] === '-Interval' || args[i] === '--interval') {
      flags.interval = parseInt(args[++i], 10) || 60;
    } else if (args[i] === '-Force' || args[i] === '--force') {
      flags.force = true;
    }
  }

  return {
    action: (flags.action as string) || 'health',
    quiet: !!flags.quiet,
    output: flags.output as string | undefined,
    interval: (flags.interval as number) || 60,
    force: !!flags.force,
  };
}

async function runAllChecks() {
  const checks = [
    checkDashboardWs,
    checkCodeGraph,
    checkGvAnalytics,
    checkTimeoutDaemon,
    checkProcessHygiene,
    checkMlEmbeddings,
    checkEngram,
    checkMcp,
    checkSessionPipeline,
    checkHooks,
    checkConfigs,
    checkToolConfigs,
    checkMissingScripts,
    checkSecurity,
    checkSecretScanner,
    checkCliGuard,
    checkHiddenSpawns,
    checkCloudConnectors,
    checkTracing,
    checkStatePersistence,
    checkAuditPipeline,
    checkGovernance,
    checkGentleVanguardDb,
    checkModelHealth,
    checkWebCrawler,
    checkAgentGovernance,
    checkGitHistorySecrets,
    checkLoopGuard,
    checkGuardrails,
  ];
  // Parallelized with Promise.allSettled — each check is I/O-bound (file reads, HTTP, DB)
  const settled = await Promise.allSettled(
    checks.map(async (check) => {
      try {
        await check();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        addResult('system', check.name, 'FAIL', `Check failed: ${msg}`, 'manual');
      }
    }),
  );
  const rejected = settled.filter((r) => r.status === 'rejected');
  if (rejected.length > 0 && !quiet) {
    console.log(`  [WARN] ${rejected.length} check(s) threw unhandled rejection`);
  }
}

// ─── Witr Trace Integration ──────────────────────────────────────────────────

/** Well-known ports per component, used when a component reports FAIL/WARN. */
const COMPONENT_PORTS: Record<string, number[]> = {
  'dashboard-ws': [8080],
  codegraph: [3000],
};

/**
 * After all checks run, use witr to trace the causal chain of any FAIL/WARN
 * finding back to its root process. Best-effort: witr is auto-installed on
 * first use; if it is unavailable the run degrades gracefully.
 */
async function traceFindings() {
  if (quiet) return;
  const findings = results.filter((r) => r.status === 'FAIL' || r.status === 'WARN');
  if (findings.length === 0) return;

  if (!ensureWitrInstalled()) {
    console.log('  [witr] not available — run src/web/witr-installer.ts to enable tracing');
    return;
  }

  const ports = new Set<number>();
  for (const f of findings) {
    // Ports named explicitly in the check/detail text (e.g. "HTTP API (port 8080)")
    const text = `${f.component} ${f.check} ${f.detail}`;
    const matches = text.matchAll(/port\s+(\d+)/g);
    for (const m of matches) {
      const p = parseInt(m[1], 10);
      if (p > 0 && p <= 65535) ports.add(p);
    }
    // Well-known component ports
    for (const p of COMPONENT_PORTS[f.component] ?? []) ports.add(p);
  }

  if (ports.size === 0) return;
  console.log('\n  [witr] tracing causal chain for failing components...');
  for (const port of ports) {
    try {
      const chain = await witr.tracePort(port);
      const names = chain.causalChain
        .map((link) => `${link.name} (pid ${link.pid})`)
        .join(' \u2192 ');
      console.log(`  [witr] port ${port} \u2192 ${names}`);
    } catch (e) {
      if (!quiet) {
        console.log(
          `  [witr] trace port ${port} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}

async function main() {
  const opts = parseArgs();
  setQuiet(opts.quiet);

  console.log(`===============================================`);
  console.log(` [MW] Maintenance Watchtower (v2.0.0)`);
  console.log(`    Action: ${opts.action} | Force: ${opts.force} | Interval: ${opts.interval}s`);
  console.log(`===============================================`);

  switch (opts.action) {
    case 'health':
      await runAllChecks();
      await traceFindings();
      generateReport(opts.output);
      break;

    case 'rebuild':
      await runAllChecks();
      await traceFindings();
      if (!quiet) console.log('\n  -- Auto-Rebuild Phase --');
      {
        const needsRebuild = results.filter(
          (r) => ['rebuild', 'reindex'].includes(r.action) && r.status !== 'PASS',
        );
        if (needsRebuild.length === 0 && !opts.force) {
          if (!quiet) console.log('  Everything fresh');
        } else {
          if (opts.force && !quiet) console.log('  Force rebuild');
          else if (!quiet) console.log(`  ${needsRebuild.length} component(s) need rebuild`);
          if (
            opts.force ||
            results.some(
              (r) =>
                r.component === 'ml-embeddings' && r.action === 'rebuild' && r.status !== 'PASS',
            )
          ) {
            await rebuildMlEmbeddings();
          }
          if (
            opts.force ||
            results.some(
              (r) => r.component === 'engram' && r.action === 'reindex' && r.status !== 'PASS',
            )
          ) {
            await reindexEngramRag();
          }
        }
      }
      generateReport(opts.output);
      break;

    case 'autoheal':
      await runAllChecks();
      await traceFindings();
      await autoHeal();
      generateReport(opts.output);
      break;

    case 'all':
      await runAllChecks();
      await traceFindings();
      await autoHeal();
      if (!quiet) console.log('\n  -- Rebuild Phase --');
      if (
        opts.force ||
        results.some(
          (r) => r.component === 'ml-embeddings' && r.action === 'rebuild' && r.status !== 'PASS',
        )
      ) {
        await rebuildMlEmbeddings();
      }
      if (
        opts.force ||
        results.some(
          (r) => r.component === 'engram' && r.action === 'reindex' && r.status !== 'PASS',
        )
      ) {
        await reindexEngramRag();
      }
      generateReport(opts.output);
      break;

    case 'continuous': {
      if (!quiet) console.log(`Continuous mode: Interval=${opts.interval}s (Ctrl+C to stop)`);
      let cycle = 0;
      const loop = async () => {
        cycle++;
        if (!quiet) console.log(`\n=== Cycle ${cycle} (${new Date().toLocaleTimeString()}) ===`);
        results.length = 0;
        await runAllChecks();
        await traceFindings();
        await autoHeal();
        generateReport();
        if (!quiet) console.log(`  Next cycle in ${opts.interval}s...`);
        setTimeout(loop, opts.interval * 1000);
      };
      void loop().catch((err) => {
        console.error('Watchtower continuous loop error:', err);
        process.exit(1);
      });
      break;
    }

    case 'report':
      await runAllChecks();
      await traceFindings();
      generateReport(opts.output);
      break;

    default:
      console.error(`Unknown action: ${opts.action}`);
      process.exit(1);
  }

  if (opts.action !== 'continuous') {
    console.log(`===============================================`);
  }

  if (getExitCode() > 0) process.exit(Math.min(getExitCode(), 255));
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
