import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { getEffectiveProcessTimeout } from './core/timeout-config';
import { runSyncShell } from './core/run-command.js';

const ROOT = resolve(process.cwd());
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const S = (p: string) => join(ROOT, p);

function run(cmd: string): string {
  try {
    const result = runSyncShell(cmd, {
      timeout: getEffectiveProcessTimeout('long_running'),
      cwd: ROOT,
    });
    return result.stdout?.trim() ?? '';
  } catch (e: unknown) {
    return 'ERR: ' + (e instanceof Error ? e.message : String(e));
  }
}
function read(p: string): string {
  return existsSync(S(p)) ? readFileSync(S(p), 'utf-8') : '';
}
function write(p: string, c: string) {
  writeFileSync(S(p), c, 'utf-8');
  console.log('  [OK] ' + p);
}
function patch(p: string, from: string, to: string) {
  const c = read(p);
  if (c.includes(to)) {
    console.log('  [SKIP] ' + p + ' (already patched)');
    return;
  }
  const n = c.replace(from, to);
  writeFileSync(S(p), n, 'utf-8');
  console.log('  [PATCH] ' + p);
}
function log(m: string, c = 'white') {
  const cl: Record<string, string> = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
  };
  console.log((cl[c] || '') + m + '\x1b[0m');
}

// --- MAIN ---
log('=== COMPLETE STACK FIX ===', 'cyan');
log('Timestamp: ' + TS, 'gray');

// 1. Fix adaptive-common.ps1 - Get-DefaultState
log('\n[1/6] Fix adaptive-common.ps1 Get-DefaultState...', 'yellow');
patch(
  'src/adaptive-common.ts',
  'function Get-DefaultState {',
  "function Get-DefaultState {\n    return [pscustomobject]@{\n        optimizationActive = $false\n        normalStreak = 0\n        lastAction = 'none'\n        lastReason = 'none'\n        lastChangedAt = $null\n    }\n}",
);

// 2. Fix adaptive-opencode-profile.ps1 - remove Invoke-AdaptiveNotify calls
log('[2/6] Fix adaptive-opencode-profile.ps1...', 'yellow');
patch('src/adaptive-opencode-profile.ts', 'Invoke-AdaptiveNotify', '# AdaptiveNotify');

// 3. Fix adaptive-codex-windsurf-profile.ps1 - remove Notify-Change calls
log('[3/6] Fix adaptive-codex-windsurf-profile.ps1...', 'yellow');
patch('src/adaptive-codex-windsurf-profile.ts', 'Notify-Change', '# NotifyChange');

// 4. Create recovery scripts directory
log('[4/6] Create recovery infrastructure...', 'yellow');
const recDir = 'scripts/recovery';
mkdirSync(S(recDir), { recursive: true });

// rescue-database.ts - simple version
write(
  recDir + '/rescue-database.ts',
  [
    'import { execSync } from "child_process"',
    'import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, cpSync } from "fs"',
    'import { join, resolve } from "path"',
    '',
    'const ROOT = resolve(process.cwd())',
    'const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)',
    '',
    'function findDBs(dir: string): string[] {',
    '  if (!existsSync(dir)) return []',
    '  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>',
    '    e.isDirectory() ? findDBs(join(dir, e.name)) : (e.name.endsWith(".db") || e.name.endsWith(".sqlite")) ? [join(dir, e.name)] : []',
    '  )',
    '}',
    '',
    'const checks = [',
    '  { name: ".codegraph", critical: true },',
    '  { name: ".engram-data", critical: false },',
    ']',
    'let critical = false',
    'console.log("=== RESCUE DATABASE ===")',
    '',
    'for (const c of checks) {',
    '  const p = join(ROOT, c.name)',
    '  if (!existsSync(p)) { console.log("  " + c.name + ": no existe"); continue }',
    '  const dbs = findDBs(p)',
    '  if (!dbs.length) { console.log("  " + c.name + ": sin .db"); continue }',
    '  try {',
    '    const r = execSync(\'sqlite3 "\' + dbs[0] + \'" "SELECT COUNT(*) FROM nodes"\', { encoding: "utf8", timeout: 5000 }).trim()',
    '    console.log("  " + c.name + ": OK (" + r + " nodos)")',
    '  } catch {',
    '    console.log("  " + c.name + ": CORRUPT")',
    '    if (c.critical) critical = true',
    '    const bk = join(ROOT, ".recovery", "backup-" + TS, c.name)',
    '    mkdirSync(bk, { recursive: true })',
    '    cpSync(p, bk, { recursive: true, force: true })',
    '    rmSync(p, { recursive: true, force: true })',
    '    console.log("    -> Backup + eliminada")',
    '  }',
    '}',
    '',
    'mkdirSync(join(ROOT, ".session", "restore-points"), { recursive: true })',
    'writeFileSync(join(ROOT, ".session", "restore-points", TS + ".json"), JSON.stringify({',
    '  id: "restore-" + TS, timestamp: TS, type: "post-recovery-baseline", status: critical ? "repaired" : "healthy"',
    '}, null, 2))',
    '',
    'mkdirSync(join(ROOT, ".recovery"), { recursive: true })',
    'writeFileSync(join(ROOT, ".recovery", "recovery-log.json"), JSON.stringify({',
    '  timestamp: TS, action: "rescue", repaired: critical, status: critical ? "restart-needed" : "healthy"',
    '}, null, 2))',
    '',
    'console.log("\\n=== " + (critical ? "REPARADO -- reinicia opencode" : "TODO OK") + " ===")',
    'process.exit(critical ? 1 : 0)',
  ].join('\n'),
);

// RECOVERY-NORMATIVA.md
write(
  'rules/RECOVERY-NORMATIVA.md',
  [
    '# RECOVERY-NORMATIVA.md',
    'Protocolo de recuperacion ante corrupcion de base de datos.',
    '',
    '## Sintomas',
    '- Todas las herramientas devuelven: no such column: "data"',
    '- Error SQLite en tool calls del runtime opencode',
    '',
    '## Causa',
    'Base de datos CodeGraph (.codegraph/) corrupta o schema mismatch.',
    'El tool runner de opencode consulta la DB en cada tool call.',
    '',
    '## Protocolo Automatico',
    'npx tsx scripts/recovery/rescue-database.ts',
    '',
    '## Protocolo Manual',
    'cd <project-root>',
    'Rename-Item ".codegraph" ".codegraph-corrupt-$(Get-Date -Format yyyyMMddTHHmmss)"',
    'Reiniciar opencode',
    '',
    '## Restore Points',
    'Ubicacion: .session/restore-points/',
  ].join('\n'),
);

// 5. Run autoheal
log('[5/6] Run watchtower autoheal...', 'yellow');
const heal = run('npx tsx src/maintenance-watchtower.ts --action autoheal --quiet');
const healOk = heal.includes('PASS') || heal.includes('OK') || heal.includes('ISSUES');
log('  watchtower: ' + (healOk ? 'TRIGGERED' : 'CHECK'), healOk ? 'green' : 'yellow');
if (!healOk) console.log('  ' + heal.slice(0, 300));

// 6. Verify
log('[6/6] Verification...', 'yellow');
const tsCheck = run('npx tsx scripts/recovery/rescue-database.ts');
log(
  '  rescue-database: ' + (tsCheck.includes('TODO OK') ? 'PASS' : 'CHECK'),
  tsCheck.includes('TODO OK') ? 'green' : 'yellow',
);

log('\n=== COMPLETE STACK FIX DONE ===', 'cyan');
log('Restore point: ' + TS, 'green');
log('Rescue script: scripts/recovery/rescue-database.ts', 'green');
log('Normativa: rules/RECOVERY-NORMATIVA.md', 'green');
log('\nNext steps (after restart): typecheck + dashboard build + commit', 'gray');
