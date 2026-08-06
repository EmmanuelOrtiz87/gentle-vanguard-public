#!/usr/bin/env node
/**
 * Cross-workspace validator — validate consistency between local and gentle-vanguard.
 * TS migration of scripts/monitoring/cross-workspace-validator.ps1
 */

import { existsSync, readFileSync, copyFileSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

interface Validation { name: string; local: string; gentleVanguard: string; status: boolean }

function readFileContent(p: string): string | null {
  try { return readFileSync(p, 'utf-8'); } catch { return null; }
}

function compareFiles(file1: string, file2: string): boolean {
  if (!existsSync(file1)) return false;
  if (!existsSync(file2)) return false;
  return readFileContent(file1) === readFileContent(file2);
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const detailed = args.includes('--detailed');

  let gentleVanguardRepoRoot = '';
  const manifestPath = join(ROOT, 'config', 'gentle-vanguard-sync.json');
  let manifest: Record<string, unknown> | null = null;

  if (existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')); } catch { /* */ }
  }

  if (manifest && manifest.role === 'source') {
    console.log('[OK] Repository marked as gentle-vanguard source; no external workspace comparison needed');
    process.exit(0);
  }

  if (!gentleVanguardRepoRoot) {
    if (manifest && manifest.gentleVanguardPath) gentleVanguardRepoRoot = String(manifest.gentleVanguardPath);
    else if (process.env.GENTLE_VANGUARD_REPO_PATH) gentleVanguardRepoRoot = process.env.GENTLE_VANGUARD_REPO_PATH;
    else gentleVanguardRepoRoot = ROOT;
  }

  gentleVanguardRepoRoot = isAbsolute(gentleVanguardRepoRoot) ? gentleVanguardRepoRoot : join(ROOT, gentleVanguardRepoRoot);
  if (!existsSync(gentleVanguardRepoRoot)) { console.error(`[ERROR] Gentle-Vanguard root not found: ${gentleVanguardRepoRoot}`); process.exit(1); }

  const validations: Validation[] = [];
  let issues = 0;

  const checks: Array<{ name: string; local: string; gv: string }> = [
    { name: 'Context Efficiency Config', local: 'scripts/utilities/context-efficiency-config.json', gv: join(gentleVanguardRepoRoot, 'scripts/utilities/context-efficiency-config.json') },
    { name: 'Session Autostart Config', local: 'scripts/utilities/session-autostart.config.json', gv: join(gentleVanguardRepoRoot, 'scripts/utilities/session-autostart.config.json') },
    { name: 'AGENTS.md', local: 'AGENTS.md', gv: join(gentleVanguardRepoRoot, 'AGENTS.md') },
  ];

  const adaptivePath = 'config/adaptive-config.json';
  if (existsSync(adaptivePath)) checks.push({ name: 'Adaptive Config', local: adaptivePath, gv: join(gentleVanguardRepoRoot, adaptivePath) });

  const gvPath = 'src/gv.ts';
  const gvTarget = join(gentleVanguardRepoRoot, gvPath);
  if (existsSync(gvPath) && existsSync(gvTarget)) checks.push({ name: 'Workflow Script (gv.ps1)', local: gvPath, gv: gvTarget });

  for (const check of checks) {
    const result = compareFiles(check.local, check.gv);
    const statusStr = result ? 'OK' : 'WARN';
    if (!result) console.log(`[${statusStr}] ${check.name}`);
    if (detailed && !result) {
      const c1 = readFileContent(check.local);
      const c2 = readFileContent(check.gv);
      if (c1 !== null && c2 !== null) {
        const l1 = c1.split('\n');
        const l2 = c2.split('\n');
        for (let i = 0; i < Math.max(l1.length, l2.length); i++) {
          if (l1[i] !== l2[i]) console.log(`  Line ${i + 1}: LOCAL="${l1[i] || ''}"  GV="${l2[i] || ''}"`);
        }
      }
    }
    validations.push({ name: check.name, local: check.local, gentleVanguard: check.gv, status: result });
    if (!result) issues++;
  }

  console.log(`\n=== Resumen de Validacion ===`);
  console.log(`Total validaciones: ${validations.length}`);
  console.log(`Inconsistencias encontradas: ${issues}`);

  if (issues > 0) {
    console.log(`\nArchivos con diferencias:`);
    for (const v of validations) {
      if (!v.status) console.log(`  - ${v.name}\n    Local: ${v.local}\n    Gentle-Vanguard: ${v.gentleVanguard}`);
    }
  }

  if (fix && issues > 0) {
    console.log(`\n=== Aplicando Correcciones ===`);
    let fixed = 0;
    for (const v of validations) {
      if (!v.status && existsSync(v.gentleVanguard) && existsSync(v.local)) {
        copyFileSync(v.gentleVanguard, v.local);
        console.log(`[OK] Sincronizado: ${v.local}`);
        fixed++;
      }
    }
    console.log(`Archivos sincronizados: ${fixed}/${issues}`);
  } else if (issues > 0) {
    console.log(`\nPara corregir automaticamente, ejecuta con --fix`);
  }

  process.exit(issues === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
