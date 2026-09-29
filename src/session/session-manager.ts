#!/usr/bin/env node
/**
 * Session Manager — entry point for session lifecycle management.
 *
 * Delegates to session-cleanup-start.ts for STARTUP cleanup
 * (close orphans, flush caches, create session ID).
 *
 * For session CLOSE, use session-close-orchestrator.ts directly.
 *
 * These are TWO SEPARATE lifecycle phases:
 *   cleanup-start (START) ──→ [Session Active] ──→ close-orchestrator (END)
 *
 * Usage:
 *   npx tsx src/session/session-manager.ts                          # Full startup cleanup
 *   npx tsx src/session/session-manager.ts --lightweight             # Startup cleanup (alias)
 *   npx tsx src/session/session-manager.ts --mode AutoStart          # Legacy compat
 *   npx tsx src/session/session-manager.ts --quiet                   # Minimal output
 */
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { runNpxTsxSync } from '../core/run-command.js';

const ROOT = resolve(process.cwd());

function parseArgs(): { mode: string; quiet: boolean; lightweight: boolean } {
  const args = process.argv.slice(2);
  return {
    mode: args.includes('--mode') ? args[args.indexOf('--mode') + 1] || 'AutoStart' : 'AutoStart',
    quiet: args.includes('--quiet') || args.includes('-Quiet'),
    lightweight: args.includes('--lightweight') || args.includes('-l'),
  };
}

function run(): void {
  const { quiet, lightweight } = parseArgs();

  // Delegate to session-cleanup-start.ts (startup cleanup)
  const targetPath = join(ROOT, 'src', 'session-cleanup-start.ts');
  if (existsSync(targetPath)) {
    const tsArgs: string[] = [];
    if (quiet) tsArgs.push('-Quiet');
    if (lightweight) {
      tsArgs.push('-SkipOrphanCleanup');
      tsArgs.push('-SkipCompression');
    }

    const result = runNpxTsxSync(targetPath, tsArgs, { stdio: 'inherit', cwd: ROOT });
    process.exit(result.status ?? 0);
  } else {
    console.warn('[session-manager] Target not found:', targetPath);
    process.exit(1);
  }
}

run();
