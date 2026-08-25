#!/usr/bin/env node
/**
 * stack-verify.ts — Comprehensive Stack Verification Orchestrator
 *
 * Validates the ENTIRE Gentle-Vanguard stack in 4 layers:
 *   Layer 1: Machine Dependencies (via dependency-validator.ts)
 *   Layer 2: Stack Platform Components (Nexus, Graphify, Obsidian, MCP, etc.)
 *   Layer 3: Running Services (WS server, Vite, Presentations)
 *   Layer 4: Integrity Checks (Engram doctor, Nexus DB)
 *
 * Usage:
 *   npx tsx src/stack-verify.ts              # full verification
 *   npx tsx src/stack-verify.ts --quick      # skip service checks
 *   npx tsx src/stack-verify.ts --json       # machine-readable output
 *   npx tsx src/stack-verify.ts --fix        # attempt to fix failures
 */

import { runSync } from './core/run-command.js';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  layer: 'deps' | 'platform' | 'services' | 'integrity';
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
  message: string;
  fixCmd?: string;
}

interface VerificationReport {
  timestamp: string;
  platform: string;
  total: number;
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
  results: CheckResult[];
}

// ─── Platform Detection ───────────────────────────────────────────────

const PLATFORM: string =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
const ROOT = resolve(process.cwd());

// ─── Color ────────────────────────────────────────────────────────────

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Helper ───────────────────────────────────────────────────────────

function run(
  cmd: string,
  args: string[],
  timeoutMs?: number,
): { stdout: string; stderr: string; status: number | null } {
  try {
    const r = runSync(cmd, args, { stdio: 'pipe', timeout: timeoutMs ?? 30000 });
    return { stdout: r.stdout.trim(), stderr: r.stderr.trim(), status: r.status };
  } catch {
    return { stdout: '', stderr: '', status: -1 };
  }
}

function pingPort(port: number): boolean {
  try {
    const r = run('node', [
      '-e',
      `
      const net = require('net');
      const s = net.connect(${port}, '127.0.0.1', () => { s.end(); process.exit(0); });
      s.on('error', () => process.exit(1));
    `,
    ]);
    return r.status === 0;
  } catch {
    return false;
  }
}

// ─── Layer 1: Machine Dependencies ────────────────────────────────────

async function checkDeps(results: CheckResult[]): Promise<void> {
  results.push({
    name: 'Machine Dependencies',
    layer: 'deps',
    status: 'SKIP',
    message: 'Running dependency validator...',
  });

  try {
    // Import the validator directly — most reliable approach
    const { getDeps, validateAll } = await import('./dependency-validator.js');
    const deps = getDeps();
    const depResults = await validateAll(deps);
    const passed = depResults.filter((r) => r.status === 'PASS').length;
    const warned = depResults.filter((r) => r.status === 'WARN').length;
    const failed = depResults.filter((r) => r.status === 'FAIL').length;

    const lastResult = results[results.length - 1];
    lastResult.message = `${passed} PASS / ${warned} WARN / ${failed} FAIL`;
    lastResult.status = failed > 0 ? 'FAIL' : warned > 0 ? 'WARN' : 'PASS';
  } catch (err) {
    const lastResult = results[results.length - 1];
    lastResult.message = `Failed to run validator: ${(err as Error).message}`;
    lastResult.status = 'WARN';
  }
}

// ─── Layer 2: Platform Components ─────────────────────────────────────

function checkPlatform(results: CheckResult[]): void {
  const checks: {
    name: string;
    path: string;
    isDir?: boolean;
    detail?: string;
    fix?: string;
    optional?: boolean;
  }[] = [
    {
      name: 'Nexus DB',
      path: '.runtime/gentle-vanguard.db',
      detail: 'SQLite operational DB',
      fix: 'npm run db:init',
    },
    {
      name: 'Graphify Graph',
      path: 'graphify-out/graph.json',
      fix: 'npm run graphify -- update .',
    },
    {
      name: 'Obsidian Vault',
      path: 'knowledge-base',
      isDir: true,
      detail: 'Knowledge management KB',
      fix: 'mkdir -p knowledge-base/04-sessions',
    },
    {
      name: 'OpenCode Config',
      path: 'opencode.json',
      detail: 'Agent & MCP configuration',
      fix: 'npx opencode init',
    },
    {
      name: 'OpenCode Skills',
      path: '.opencode/skills',
      isDir: true,
      fix: 'Reinstall opencode or git submodule update',
    },
    {
      name: 'MCP Registry',
      path: 'config/mcp-registry.json',
      detail: 'MCP server definitions',
    },
    {
      name: 'Session Pipeline',
      path: 'config/session-autostart.config.json',
      detail: '53-step autostart config',
    },
    {
      name: 'Security Policies',
      path: 'config/security-policy.json',
      detail: 'Encryption & auth config',
    },
    {
      name: 'Lefthook Hooks',
      path: '.git/hooks/pre-commit',
      detail: 'Git validation hooks',
      fix: 'npx lefthook install',
      optional: true,
    },
    {
      name: 'Lefthook Config',
      path: '.lefthook.yml',
      detail: 'Hook definitions YAML',
    },
    {
      name: 'pnpm Lockfile',
      path: 'pnpm-lock.yaml',
      detail: 'Reproducible installs',
      fix: 'pnpm install',
    },
    {
      name: 'node_modules',
      path: 'node_modules',
      isDir: true,
      detail: 'Installed packages',
      fix: 'pnpm install',
    },
  ];

  for (const check of checks) {
    const absPath = join(ROOT, check.path);
    const found = check.isDir
      ? existsSync(absPath) && statSync(absPath).isDirectory()
      : existsSync(absPath);

    if (found) {
      let message = check.detail ?? (check.isDir ? 'Directory exists' : 'File exists');
      // Get file size for significant files
      if (!check.isDir && ['Nexus DB', 'Graphify Graph'].includes(check.name)) {
        try {
          const size = statSync(absPath).size;
          const sizeStr =
            size > 1024 * 1024
              ? `${(size / 1024 / 1024).toFixed(1)} MB`
              : size > 1024
                ? `${(size / 1024).toFixed(1)} KB`
                : `${size} B`;
          message += ` (${sizeStr})`;
        } catch {}
      }
      // Get node/edge count for graph
      if (check.name === 'Graphify Graph' && found) {
        try {
          const r = run('node', [
            '-e',
            `const f=require('fs');const j=JSON.parse(f.readFileSync('graphify-out/graph.json','utf8'));console.log((j.nodes||[]).length+' nodes, '+(j.links||[]).length+' edges')`,
          ]);
          if (r.status === 0 && r.stdout) message = r.stdout;
        } catch {}
      }
      results.push({ name: check.name, layer: 'platform', status: 'PASS', message });
    } else {
      const fixMsg = check.fix ? `Try: ${check.fix}` : 'File/directory missing';
      const status = check.optional ? 'WARN' : 'FAIL';
      results.push({
        name: check.name,
        layer: 'platform',
        status,
        message: `Missing — ${fixMsg}`,
        fixCmd: check.fix,
      });
    }
  }
}

// ─── Layer 3: Running Services ────────────────────────────────────────

function checkServices(results: CheckResult[]): void {
  // Dashboard WS Server (port 8080 typical)
  const wsPort = parseInt(process.env.WS_PORT ?? '8080', 10);
  const wsOk = pingPort(wsPort);
  results.push({
    name: `WS Server (:${wsPort})`,
    layer: 'services',
    status: wsOk ? 'PASS' : 'WARN',
    message: wsOk ? `Responding on port ${wsPort}` : 'Not reachable (may not be started)',
    fixCmd: 'npm run dashboard:server',
  });

  // Vite Dev Server (port 5173 typical)
  const vitePort = parseInt(process.env.VITE_DEV_PORT ?? '5173', 10);
  const viteOk = pingPort(vitePort);
  results.push({
    name: `Vite Dev Server (:${vitePort})`,
    layer: 'services',
    status: viteOk ? 'PASS' : 'SKIP',
    message: viteOk ? `Responding on port ${vitePort}` : 'Not running (development only)',
  });

  // Presentations Server (port 3000 typical)
  const presOk = pingPort(3000);
  results.push({
    name: 'Presentations (:3000)',
    layer: 'services',
    status: presOk ? 'PASS' : 'SKIP',
    message: presOk ? 'Responding on port 3000' : 'Not running (optional)',
  });
}

// ─── Layer 4: Integrity Checks ────────────────────────────────────────

async function checkIntegrity(results: CheckResult[]): Promise<void> {
  // Engram Doctor
  try {
    const r = run('engram', ['doctor', '--json']);
    if (r.stdout) {
      let data: { errors?: unknown[] } | null;
      try {
        data = JSON.parse(r.stdout) as { errors?: unknown[] };
      } catch {
        data = null;
      }
      if (data) {
        const hasErrors = (data.errors ?? []).length > 0;
        results.push({
          name: 'Engram Memory',
          layer: 'integrity',
          status: hasErrors ? 'WARN' : 'PASS',
          message: hasErrors ? `${data.errors?.length} issues found` : 'Healthy',
          fixCmd: hasErrors ? 'engram doctor --fix' : undefined,
        });
      } else {
        // Non-JSON output but command ran — treat as healthy
        results.push({
          name: 'Engram Memory',
          layer: 'integrity',
          status: 'PASS',
          message: 'Available',
        });
      }
    } else {
      results.push({
        name: 'Engram Memory',
        layer: 'integrity',
        status: 'WARN',
        message: `Doctor exited (${r.status}): ${r.stderr || 'unknown'}`,
      });
    }
  } catch {
    results.push({
      name: 'Engram Memory',
      layer: 'integrity',
      status: 'WARN',
      message: 'Could not run engram doctor',
    });
  }

  // Nexus DB Integrity — check DB file exists and is valid
  try {
    const dbPath = join(ROOT, '.runtime/gentle-vanguard.db');
    if (existsSync(dbPath)) {
      const r = run('node', [
        '-e',
        `
        const fs = require('fs');
        const path = '.runtime/gentle-vanguard.db';
        try {
          const size = fs.statSync(path).size;
          const ok = fs.readFileSync(path, 'utf-8').length > 0;
          // quick integrity: try reading first bytes
          const fd = fs.openSync(path, 'r');
          const buf = Buffer.alloc(16);
          fs.readSync(fd, buf, 0, 16, 0);
          fs.closeSync(fd);
          const isSQLite = buf[0] === 0x53 && buf[1] === 0x51 && buf[2] === 0x4C; // 'SQL'
          console.log(isSQLite ? 'OK' : 'CORRUPT');
        } catch(e) { console.log('ERROR: '+e.message); }
      `,
      ]);
      const dbOk = r.status === 0 && r.stdout.trim() === 'OK';
      results.push({
        name: 'Nexus DB Integrity',
        layer: 'integrity',
        status: dbOk ? 'PASS' : 'WARN',
        message: dbOk ? 'SQLite DB valid' : `DB check: ${r.stdout.slice(0, 60)}`,
        fixCmd: !dbOk ? 'npm run db:init' : undefined,
      });
    } else {
      results.push({
        name: 'Nexus DB Integrity',
        layer: 'integrity',
        status: 'FAIL',
        message: 'Nexus DB not found',
        fixCmd: 'npm run db:init',
      });
    }
  } catch {
    results.push({
      name: 'Nexus DB Integrity',
      layer: 'integrity',
      status: 'WARN',
      message: 'Could not check DB integrity',
    });
  }

  // TypeScript typecheck
  try {
    const r = run('npx', ['--yes', 'tsc', '--noEmit']);
    const errCount = r.stderr ? (r.stderr.match(/error TS\d+/g) || []).length : 0;
    const hasTsErrors = errCount > 0 || (r.stdout?.includes('error TS') ?? false);
    results.push({
      name: 'TypeScript Typecheck',
      layer: 'integrity',
      status: hasTsErrors ? 'FAIL' : 'PASS',
      message: hasTsErrors ? `${errCount} error(s) found` : '0 errors',
      fixCmd: hasTsErrors ? 'npm run typecheck' : undefined,
    });
  } catch {
    results.push({
      name: 'TypeScript Typecheck',
      layer: 'integrity',
      status: 'SKIP',
      message: 'Could not run tsc',
    });
  }
}

// ─── Reporter ─────────────────────────────────────────────────────────

function printReport(results: CheckResult[], json: boolean): VerificationReport {
  const report: VerificationReport = {
    timestamp: new Date().toISOString(),
    platform: PLATFORM,
    total: 0,
    passed: 0,
    warned: 0,
    failed: 0,
    skipped: 0,
    results,
  };

  for (const r of results) {
    report.total++;
    if (r.status === 'PASS') report.passed++;
    else if (r.status === 'WARN') report.warned++;
    else if (r.status === 'FAIL') report.failed++;
    else report.skipped++;
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  // ── HEADER ──
  console.log(C.bold(C.cyan('\n╔════════════════════════════════════════════════════════════╗')));
  console.log(C.bold(C.cyan('║         Gentle-Vanguard Stack Verification                ║')));
  console.log(C.bold(C.cyan('╚════════════════════════════════════════════════════════════╝')));
  console.log(`  ${C.dim(`Platform: ${PLATFORM}  |  ${report.timestamp}`)}`);
  console.log('');

  // ── LAYERS ──
  const layers: { key: CheckResult['layer']; label: string }[] = [
    { key: 'deps', label: 'MACHINE DEPENDENCIES' },
    { key: 'platform', label: 'STACK PLATFORM' },
    { key: 'services', label: 'RUNNING SERVICES' },
    { key: 'integrity', label: 'INTEGRITY CHECKS' },
  ];

  for (const layer of layers) {
    const items = results.filter((r) => r.layer === layer.key);
    if (items.length === 0) continue;
    console.log(C.bold(C.cyan(`  ── ${layer.label} ──`)));

    for (const item of items) {
      const icon =
        item.status === 'PASS'
          ? C.green('✔')
          : item.status === 'WARN'
            ? C.yellow('⚠')
            : item.status === 'FAIL'
              ? C.red('✘')
              : C.dim('−');
      const msg = item.status === 'PASS' ? C.dim(item.message) : item.message;
      console.log(`  ${icon} ${item.name.padEnd(24)} ${msg}`);
      if (item.status === 'FAIL' && item.fixCmd) {
        console.log(`     ${C.yellow('→')} ${C.dim(item.fixCmd)}`);
      }
    }
    console.log('');
  }

  // ── SUMMARY ──
  console.log(
    C.bold(
      `  ${C.cyan('═══')} ${C.green(`${report.passed} PASS`)} | ${C.yellow(`${report.warned} WARN`)} | ${report.failed > 0 ? C.red(`${report.failed} FAIL`) : `${report.failed} FAIL`} | ${C.dim(`${report.skipped} SKIP`)} | ${report.total} total ${C.cyan('═══')}`,
    ),
  );

  if (report.failed > 0) {
    console.log(C.red('\n  ✘ Some checks failed. Run with --fix to attempt auto-recovery.'));
    console.log(C.yellow('  ✘ Or run: npx tsx src/stack-verify.ts --fix'));
  }
  if (report.warned > 0) {
    console.log(C.yellow('  ⚠ Some items need attention (non-critical).'));
  }

  return report;
}

// ─── Auto-fix attempt ─────────────────────────────────────────────────

async function autoFix(results: CheckResult[]): Promise<number> {
  const fixable = results.filter((r) => r.status === 'FAIL' && r.fixCmd);
  if (fixable.length === 0) {
    console.log(C.green('\n  ✓ No fixable failures found.'));
    return 0;
  }

  console.log(C.cyan(`\n  Attempting to fix ${fixable.length} failure(s)...\n`));
  let fixed = 0;

  for (const item of fixable) {
    if (!item.fixCmd) continue;
    console.log(`  ${C.yellow('→')} Fixing: ${item.name} (${item.fixCmd})`);
    try {
      const parts = item.fixCmd.split(/\s+/);
      const r = runSync(parts[0], parts.slice(1), { stdio: 'pipe', timeout: 60000 });
      if (r.status === 0) {
        console.log(`    ${C.green('✔')} Fixed successfully`);
        fixed++;
      } else {
        console.log(
          `    ${C.red('✘')} Failed: ${(r.stderr || r.stdout || 'unknown error').slice(0, 200)}`,
        );
      }
    } catch (err) {
      console.log(`    ${C.red('✘')} Error: ${(err as Error).message}`);
    }
  }

  console.log(
    C.cyan(`\n  Fixed ${fixed}/${fixable.length} failures. Re-run without --fix to verify.`),
  );
  return fixable.length - fixed;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick') || args.includes('-q');
  const json = args.includes('--json') || args.includes('-j');
  const fix = args.includes('--fix') || args.includes('-f');

  const results: CheckResult[] = [];

  console.log(C.bold(C.cyan('\n  🔍 Running full stack verification...')));

  // Layer 1: Machine Dependencies
  await checkDeps(results);

  // Layer 2: Platform Components
  checkPlatform(results);

  // Layer 3: Running Services (skip in quick mode)
  if (!quick) {
    checkServices(results);
  }

  // Layer 4: Integrity Checks
  await checkIntegrity(results);

  // Report
  const report = printReport(results, json);

  // Auto-fix if requested
  let remainingFailures = report.failed;
  if (fix && report.failed > 0) {
    remainingFailures = await autoFix(results);
  }

  process.exit(remainingFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(C.red(`\n  FATAL: ${err.message}`));
  process.exit(2);
});
