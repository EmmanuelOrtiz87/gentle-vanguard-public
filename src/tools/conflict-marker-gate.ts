/**
 * Gate anti conflict-markers (absorción gentle-shell v4.8.0 — BL-2026-11-16).
 *
 * Un commit que agrega markers de conflicto sin resolver deja el árbol en
 * estado roto y tumba todos los builds siguientes hasta que alguien lo vea.
 * El gate escanea los archivos staged y bloquea el commit si aparecen
 * markers NUEVOS (`<<<<<<<`, `>>>>>>>`, y `=======` solo cuando el archivo
 * ya tiene markers de inicio/fin — una línea de `=======` sola es una regla
 * horizontal legítima de markdown).
 */
import { runSync } from '../core/run-command.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Líneas (1-based) con markers de conflicto. */
export function findConflictMarkers(contents: string): number[] {
  const lines = contents.split(/\r?\n/);
  const hits = new Set<number>();
  let hasStartOrEnd = false;
  // Start/end markers: inambiguos (git nunca los genera salvo en conflicto).
  lines.forEach((line, i) => {
    if (/^<{7}( |$)/.test(line) || /^>{7}( |$)/.test(line)) {
      hits.add(i + 1);
      hasStartOrEnd = true;
    }
  });
  // Separator `=======`: solo es marker si el archivo ya está en conflicto.
  if (hasStartOrEnd) {
    lines.forEach((line, i) => {
      if (/^={7}( |$)/.test(line)) hits.add(i + 1);
    });
  }
  return [...hits].sort((a, b) => a - b);
}

function stagedFiles(): string[] {
  const r = runSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter', 'ACMR'],
    { timeout: 15000 },
  );
  return (r.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function main(): number {
  const files = stagedFiles();
  const findings: string[] = [];
  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue; // borrado en el mismo commit o binario ilegible: no es marker
    }
    for (const line of findConflictMarkers(contents)) {
      findings.push(`${file}:${line}`);
    }
  }
  if (findings.length > 0) {
    console.error(
      `conflict-marker-gate -> FAIL: markers de conflicto sin resolver en el commit:\n` +
        findings.map((f) => `  ! ${f}`).join('\n') +
        `\n  Resolvé los conflictos antes de commitear.`,
    );
    return 1;
  }
  console.log(
    `conflict-marker-gate -> ${files.length} archivos staged, 0 conflict markers`,
  );
  return 0;
}

// CLI Guard pattern (normalizado para rutas Windows — ver src/integrations/zcode-sync.ts)
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1])
) {
  process.exit(main());
}
