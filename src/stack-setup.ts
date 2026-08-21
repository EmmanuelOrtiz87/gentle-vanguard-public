#!/usr/bin/env node
/**
 * stack-setup.ts — One-Command First-Time Stack Installation
 *
 * Runs EVERYTHING needed to get Gentle-Vanguard running from scratch:
 *   1. Check + install machine dependencies (Node, pnpm, Git, etc.)
 *   2. Initialize Nexus operational database
 *   3. Install git hooks (lefthook)
 *   4. Generate knowledge graph (graphify)
 *   5. Install dashboard dependencies
 *   6. Verify the full stack
 *
 * Usage:
 *   npm run stack:setup              # interactive (asks before each step)
 *   npm run stack:setup -- --yes     # non-interactive, auto-install all
 *   npm run stack:setup -- --dry-run # preview only, no changes
 */

import { runSync } from './core/run-command.js';
import { resolve } from 'node:path';

// ─── Config ───────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);
const YES = args.includes('--yes') || args.includes('-y');
const DRY_RUN = args.includes('--dry-run') || args.includes('-d');

const steps: { name: string; cmd: string; desc: string; critical: boolean }[] = [
  {
    name: 'Machine Dependencies',
    cmd: `npx tsx src/dependency-validator.ts${YES ? ' --install --yes' : ' --install'}`,
    desc: 'Check and install core tools (Node, pnpm, Git, TruffleHog, Lefthook, etc.)',
    critical: true,
  },
  {
    name: 'Nexus Database',
    cmd: 'npm run db:init',
    desc: 'Initialize SQLite operational database (metrics, sessions, traces)',
    critical: true,
  },
  {
    name: 'Git Hooks',
    cmd: 'npx lefthook install',
    desc: 'Install pre-commit, pre-push, post-commit validation hooks',
    critical: false,
  },
  {
    name: 'Knowledge Graph',
    cmd: 'npm run graphify -- update .',
    desc: 'Generate codebase knowledge graph with node/edge relationships',
    critical: false,
  },
  {
    name: 'Dashboard Dependencies',
    cmd: 'cd apps/web-dashboard && pnpm install',
    desc: 'Install npm packages for the LLM observability dashboard',
    critical: false,
  },
  {
    name: 'Stack Verification',
    cmd: 'npx tsx src/stack-verify.ts',
    desc: 'Verify all 4 layers: deps → platform → services → integrity',
    critical: true,
  },
];

// ─── Color ────────────────────────────────────────────────────────────

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Helpers ──────────────────────────────────────────────────────────

function runInteractive(cmd: string, args: string[]): number | null {
  console.log(C.dim(`  > ${cmd} ${args.join(' ')}`));
  try {
    const r = runSync(cmd, args, { stdio: 'inherit', timeout: 300000 });
    return r.status;
  } catch {
    return -1;
  }
}

function prompt(msg: string): boolean {
  if (YES) return true;
  if (DRY_RUN) {
    console.log(C.yellow(`  [DRY-RUN] Would execute: ${msg}`));
    return false;
  }
  console.log(C.cyan(`\n  ? ${msg} (Y/n)`));
  // Simple read from stdin
  try {
    runSync(
      process.platform === 'win32' ? 'powershell' : 'read',
      process.platform === 'win32'
        ? ['-NoProfile', '-Command', '$host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown").Key']
        : [],
      { stdio: 'inherit', timeout: 30000 },
    );
    return true; // default proceed
  } catch {
    return true;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(C.bold(C.cyan('\n╔════════════════════════════════════════════════════════════╗')));
  console.log(C.bold(C.cyan('║        Gentle-Vanguard Stack Setup                        ║')));
  console.log(C.bold(C.cyan('║        One-command first-time installation                ║')));
  console.log(C.bold(C.cyan('╚════════════════════════════════════════════════════════════╝')));
  console.log(`  ${C.dim(`Platform: ${process.platform}  |  ${new Date().toISOString()}`)}`);
  console.log(`  ${C.dim(`Working dir: ${ROOT}`)}`);

  if (DRY_RUN) {
    console.log(C.yellow('\n  ⚠ DRY-RUN MODE — no changes will be made\n'));
  }

  console.log(C.bold(C.cyan(`\n  ${steps.length} setup steps to complete\n`)));

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const prefix = `${i + 1}/${steps.length}`;
    console.log(C.bold(C.cyan(`\n  ── [${prefix}] ${step.name} ──`)));
    console.log(C.dim(`      ${step.desc}`));

    if (DRY_RUN) {
      console.log(C.yellow(`      Would run: ${step.cmd}`));
      skipped++;
      continue;
    }

    if (!YES && !step.critical) {
      const ok = prompt(`Run "${step.name}"?`);
      if (!ok) {
        console.log(C.yellow(`  − Skipped`));
        skipped++;
        continue;
      }
    }

    try {
      const parts = resolveCommand(step.cmd);
      const status = runInteractive(parts.cmd, parts.args);
      if (status === 0) {
        console.log(C.green(`  ✔ ${step.name} — OK`));
        completed++;
      } else {
        if (step.critical) {
          console.log(C.red(`  ✘ ${step.name} — FAILED (critical)`));
          failed++;
          console.log(C.red(`\n  ✘ Critical step failed. Run manually: ${step.cmd}`));
          process.exit(1);
        } else {
          console.log(C.yellow(`  ⚠ ${step.name} — FAILED (non-critical, continuing)`));
          failed++;
        }
      }
    } catch (err: any) {
      console.log(C.red(`  ✘ ${step.name} — Error: ${err.message}`));
      if (step.critical) {
        console.log(C.red(`\n  ✘ Critical step failed. Aborting.`));
        process.exit(1);
      }
      failed++;
    }
  }

  // ── Summary ──
  console.log(C.bold(C.cyan(`\n╔════════════════════════════════════════════════════════════╗`)));
  console.log(C.bold(C.cyan(`║                     Setup Complete                        ║`)));
  console.log(C.bold(C.cyan(`╚════════════════════════════════════════════════════════════╝`)));
  console.log(
    `  ${C.green(`✔ ${completed} completed`)}  ${failed > 0 ? C.red(`${failed} failed`) : `${failed} failed`}  ${skipped > 0 ? C.yellow(`${skipped} skipped`) : `${skipped} skipped`}`,
  );

  if (failed === 0) {
    console.log(C.green('\n  ✅ Stack is ready! Run: npm run stack:verify'));
    console.log(C.dim('     Or start working: npx tsx src/session-autostart.ts\n'));
  } else {
    console.log(C.yellow('\n  ⚠ Some steps had issues. Check output above.'));
    console.log(C.yellow('  Run: npm run stack:verify to check current state\n'));
  }

  process.exit(failed > 0 && steps.some((s) => s.critical && failed) ? 1 : 0);
}

/**
 * Resolve a command string into { cmd, args[] } splitting by spaces
 * but preserving quoted strings.
 */
function resolveCommand(input: string): { cmd: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of input) {
    if (ch === '"' || ch === "'") {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ' ' && !inQuote) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return { cmd: tokens[0] ?? '', args: tokens.slice(1) };
}

main().catch((err) => {
  console.error(C.red(`\n  FATAL: ${err.message}`));
  process.exit(2);
});
