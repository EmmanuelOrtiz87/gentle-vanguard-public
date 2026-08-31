#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { runSync, runNpxTsxSync } from '../core/run-command.js';

interface CliArgs {
  quiet: boolean;
  skipEngram: boolean;
  skipConfigs: boolean;
  skipDeps: boolean;
  skipHealth: boolean;
  skipTracing: boolean;
  skipAudit: boolean;
  skipEvents: boolean;
  skipCheckpoint: boolean;
  help: boolean;
}

interface ResolutionResult {
  step: string;
  ok: boolean;
  message: string;
}

const ROOT = resolve(process.cwd());

function log(msg: string, quiet: boolean) {
  if (!quiet) console.log(msg);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return {
    quiet: args.includes('--quiet') || args.includes('-q'),
    skipEngram: args.includes('--skip-engram'),
    skipConfigs: args.includes('--skip-configs'),
    skipDeps: args.includes('--skip-deps'),
    skipHealth: args.includes('--skip-health'),
    skipTracing: args.includes('--skip-tracing'),
    skipAudit: args.includes('--skip-audit'),
    skipEvents: args.includes('--skip-events'),
    skipCheckpoint: args.includes('--skip-checkpoint'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp(): void {
  console.log(`Usage: final-resolution.ts [options]

Options:
  -q, --quiet           Suppress output
  --skip-engram         Skip Engram version check
  --skip-configs        Skip config validation
  --skip-deps           Skip dependency audit
  --skip-health         Skip health check
  --skip-tracing        Skip tracing span closure
  --skip-audit          Skip audit log finalization
  --skip-events         Skip event store finalization
  --skip-checkpoint     Skip checkpoint creation
  -h, --help            Show this help`);
}

function runStep(script: string, args: string[], label: string, quiet: boolean): ResolutionResult {
  log(`  → ${label}...`, quiet);
  const scriptPath = join(ROOT, 'src', script);
  if (!existsSync(scriptPath)) {
    return { step: label, ok: false, message: `Script not found: ${script}` };
  }
  const result = runNpxTsxSync(scriptPath, args, {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
  });
  if (result.status === 0) {
    log(`  ✓ ${label}`, quiet);
    return { step: label, ok: true, message: 'OK' };
  }
  return {
    step: label,
    ok: false,
    message: result.stderr?.trim() || result.stdout?.trim() || `Exit code ${result.status}`,
  };
}

function checkEngram(quiet: boolean): ResolutionResult {
  log(`  → Checking Engram...`, quiet);
  try {
    const result = runSync('engram', ['--version'], {
      stdio: quiet ? 'pipe' : 'inherit',
    });
    if (result.status === 0) {
      log(`  ✓ Engram available: ${result.stdout?.trim() || result.stderr?.trim() || 'OK'}`, quiet);
      return { step: 'Engram', ok: true, message: 'OK' };
    }
    return { step: 'Engram', ok: false, message: 'Engram not available' };
  } catch {
    return { step: 'Engram', ok: false, message: 'Engram not available' };
  }
}

function validateConfigs(quiet: boolean): ResolutionResult[] {
  log(`  → Validating configs...`, quiet);
  const results: ResolutionResult[] = [];
  const configs = [
    { path: 'opencode.json', label: 'opencode.json' },
    { path: '.windsurf/config.json', label: '.windsurf/config.json' },
  ];
  for (const cfg of configs) {
    const fullPath = join(ROOT, cfg.path);
    if (!existsSync(fullPath)) {
      results.push({ step: cfg.label, ok: false, message: 'File not found' });
      continue;
    }
    try {
      JSON.parse(readFileSync(fullPath, 'utf-8'));
      results.push({ step: cfg.label, ok: true, message: 'Valid JSON' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ step: cfg.label, ok: false, message: msg });
    }
  }
  return results;
}

function checkDependencies(quiet: boolean): ResolutionResult {
  log(`  → Auditing dependencies...`, quiet);
  const result = runSync('pnpm', ['audit'], {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
  });
  const ok = result.status === 0;
  return {
    step: 'Dependencies',
    ok,
    message: ok
      ? 'No vulnerabilities'
      : result.stdout?.trim() || result.stderr?.trim() || `Exit code ${result.status}`,
  };
}

function checkHealth(quiet: boolean): ResolutionResult {
  log(`  → Running health check...`, quiet);
  const scriptPath = join(ROOT, 'src', 'health-check.ts');
  if (!existsSync(scriptPath)) {
    return { step: 'HealthCheck', ok: false, message: 'src/health-check.ts not found' };
  }
  const result = runNpxTsxSync(scriptPath, ['--quiet'], {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
  });
  const ok = result.status === 0;
  return {
    step: 'HealthCheck',
    ok,
    message: ok ? 'System healthy' : result.stderr?.trim() || `Exit code ${result.status}`,
  };
}

function finalizeTracing(quiet: boolean): ResolutionResult {
  return runStep(
    'tracing-instrument.ts',
    ['--action', 'end', '--span-name', 'final-resolution'],
    'Close tracing spans',
    quiet,
  );
}

function finalizeAudit(quiet: boolean): ResolutionResult {
  return runStep(
    'audit-pipeline.ts',
    ['--action', 'log', '--message', 'Session finalized'],
    'Audit log finalization',
    quiet,
  );
}

function finalizeEvents(quiet: boolean): ResolutionResult {
  return runStep(
    'event-sourcing.ts',
    ['--action', 'snapshot', '--aggregate-id', 'session-finalize'],
    'Event store finalization',
    quiet,
  );
}

function finalizeCheckpoint(quiet: boolean): ResolutionResult {
  return runStep(
    'checkpoint-manager.ts',
    ['--action', 'create', '--label', 'final-resolution'],
    'Checkpoint creation',
    quiet,
  );
}

function printSummary(results: ResolutionResult[], quiet: boolean): void {
  log('', quiet);
  log('=== Final Resolution Summary ===', quiet);
  let ok = 0;
  let fail = 0;
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    log(`  ${icon} ${r.step}: ${r.message}`, quiet);
    if (r.ok) ok++;
    else fail++;
  }
  log('', quiet);
  log(`Passed: ${ok}  Failed: ${fail}`, quiet);
}

function main(): void {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const q = args.quiet;
  log('=== Gentle-Vanguard Final Resolution ===', q);
  log('', q);

  const allResults: ResolutionResult[] = [];

  // 1. Engram check
  if (!args.skipEngram) {
    allResults.push(checkEngram(q));
  }

  // 2. Config validation
  if (!args.skipConfigs) {
    const configResults = validateConfigs(q);
    allResults.push(...configResults);
  }

  // 3. Dependency audit
  if (!args.skipDeps) {
    allResults.push(checkDependencies(q));
  }

  // 4. Health check
  if (!args.skipHealth) {
    allResults.push(checkHealth(q));
  }

  // 5. Tracing span closure
  if (!args.skipTracing) {
    allResults.push(finalizeTracing(q));
  }

  // 6. Audit log finalization
  if (!args.skipAudit) {
    allResults.push(finalizeAudit(q));
  }

  // 7. Event store finalization
  if (!args.skipEvents) {
    allResults.push(finalizeEvents(q));
  }

  // 8. Checkpoint creation
  if (!args.skipCheckpoint) {
    allResults.push(finalizeCheckpoint(q));
  }

  // Summary
  printSummary(allResults, q);

  const failed = allResults.filter((r) => !r.ok);
  if (failed.length > 0) {
    log(`\n[WARNING] ${failed.length} step(s) had issues. Review above.`, q);
  }

  log('\nSystem Gentle-Vanguard finalized.', q);
}

main();
