#!/usr/bin/env node
/**
 * Engram auto-compact — runs engram doctor + conflict scan + prune for memory maintenance.
 * TS migration of scripts/utilities/memory/ENGRAM/engram-auto-compact.ps1
 */

import { runSyncShell } from './core/run-command.js';
import { pathToFileURL } from 'url';

function run(cmd: string): { ok: boolean; output: string } {
  try {
    const r = runSyncShell(cmd, { timeout: 60000 });
    return { ok: r.status === 0, output: r.stdout.trim() };
  } catch (e: unknown) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const project = args.includes('--project')
    ? args[args.indexOf('--project') + 1]
    : 'gentle-vanguard';
  const quiet = args.includes('--quiet') || args.includes('-Quiet');
  const aggressive = args.includes('--aggressive') || args.includes('-Aggressive');

  const info = (m: string) => {
    if (!quiet) console.log(`[INFO] ${m}`);
  };
  const ok = (m: string) => {
    if (!quiet) console.log(`[OK] ${m}`);
  };
  const warn = (m: string) => {
    if (!quiet) console.log(`[WARN] ${m}`);
  };

  info(`Starting Engram auto-compact for project: ${project}`);

  // Check if engram is available
  const version = run('engram --version');
  if (!version.ok) {
    warn(`Engram not found: ${version.output}`);
    process.exit(0);
  }
  info(`Engram ${version.output}`);

  // Step 1: Run doctor
  info('Running engram doctor...');
  const doctor = run(`engram doctor --project ${project}`);
  if (doctor.ok) ok('Doctor check passed');
  else warn(`Doctor check: ${doctor.output}`);

  // Step 2: Conflict scan
  info('Scanning memory conflicts...');
  const conflicts = run(
    `engram conflicts scan --project ${project}${aggressive ? ' --aggressive' : ''}`,
  );
  if (conflicts.ok) {
    const count = conflicts.output.match(/\d+/)?.[0] || '0';
    ok(`Conflict scan complete: ${count} conflicts`);
  } else warn(`Conflict scan: ${conflicts.output}`);

  // Step 3: Apply conflict resolution if aggressive
  if (aggressive) {
    info('Applying auto-resolution...');
    const resolve = run(`engram conflicts resolve --project ${project} --auto`);
    if (resolve.ok) ok('Conflicts auto-resolved');
    else warn(`Auto-resolve: ${resolve.output}`);
  }

  // Step 4: Prune old observations (using export/import cycle for compaction)
  info('Pruning old observations via sync...');
  const syncExport = run(`engram sync --export --project ${project}`);
  if (syncExport.ok) ok('Sync export complete (prune effect)');
  else warn(`Sync export: ${syncExport.output}`);

  // Step 5: Compact storage via sync import
  info('Compacting memory storage via sync...');
  const syncImport = run(`engram sync --import --project ${project}`);
  if (syncImport.ok) ok('Sync import complete (compact effect)');
  else warn(`Sync import: ${syncImport.output}`);

  // Record the run
  const ts = new Date().toISOString().slice(0, 19);
  const summary = `Auto-compact run at ${ts}. Project: ${project}. Aggressive: ${aggressive}`;
  run(`engram save "Auto-compact run" "${summary}" --project ${project}`);

  ok(`Engram auto-compact completed for ${project}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
