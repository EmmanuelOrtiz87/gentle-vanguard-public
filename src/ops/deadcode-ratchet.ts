#!/usr/bin/env node
/**
 * Deadcode Ratchet — puerta unidireccional sobre código muerto.
 *
 * Patrón absorbido de gentle-ai v4 (.deadcode-baseline.txt): el conteo de
 * issues de knip (archivos muertos, exports no usados, deps huérfanas,
 * duplicados) queda congelado en un baseline versionado. El gate falla si el
 * conteo SUBE; si baja, se recomienda fijar la nueva marca con
 * `--update-baseline` (acción explícita, justificada en el commit).
 *
 * Anti-falso-positivo: knip no ve los entry points invocados dinámicamente
 * (spawn/`node --import tsx`), así que un CLI nuevo puede aparecer como
 * "nuevo muerto". En ese caso se agrega el entry a `knip.json` o, si es
 * ruido aceptado, se actualiza el baseline con la justificación en el commit.
 *
 * Uso:
 *   npx tsx src/ops/deadcode-ratchet.ts                  # gate (exit 1 si crece)
 *   npx tsx src/ops/deadcode-ratchet.ts --update-baseline  # fija la marca actual
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSync } from '../core/run-command.js';

const ROOT = process.cwd();
const BASELINE = join(ROOT, '.deadcode-baseline.txt');
const CATEGORIES = [
  'files',
  'dependencies',
  'devDependencies',
  'optionalPeerDependencies',
  'unlisted',
  'binaries',
  'unresolved',
  'exports',
  'types',
  'duplicates',
  'enumMembers',
  'namespaceMembers',
] as const;

interface KnipIssue {
  file: string;
  [category: string]: unknown;
}

function countIssues(json: { issues?: KnipIssue[] }): {
  total: number;
  byCategory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const issue of json.issues ?? []) {
    for (const category of CATEGORIES) {
      const items = issue[category];
      if (Array.isArray(items) && items.length > 0) {
        byCategory[category] = (byCategory[category] ?? 0) + items.length;
        total += items.length;
      }
    }
  }
  return { total, byCategory };
}

function runKnip(): { total: number; byCategory: Record<string, number> } {
  const result = runSync('npx', ['knip', '--reporter', 'json'], {
    cwd: ROOT,
    timeout: 180_000,
  });
  // Contrato de knip: exit 1 = "hay issues" (nuestro caso normal), 0 = limpio.
  // Cualquier otro código sí es un fallo real del tool.
  if (result.status !== 0 && result.status !== 1) {
    console.error(`[deadcode-ratchet] knip falló con exit ${result.status}`);
    console.error((result.stderr || result.stdout || '').slice(0, 500));
    process.exit(2);
  }
  let parsed: { issues?: KnipIssue[] };
  try {
    parsed = JSON.parse(result.stdout) as { issues?: KnipIssue[] };
  } catch {
    console.error('[deadcode-ratchet] salida de knip no es JSON válido');
    process.exit(2);
  }
  return countIssues(parsed);
}

function parseBaseline(): Record<string, number> | null {
  if (!existsSync(BASELINE)) return null;
  const values: Record<string, number> = {};
  for (const line of readFileSync(BASELINE, 'utf-8').split(/\r?\n/)) {
    const match = /^([a-zA-Z]+)=(\d+)$/.exec(line.trim());
    if (match) values[match[1]] = Number(match[2]);
  }
  return 'total' in values ? values : null;
}

function writeBaseline(counts: { total: number; byCategory: Record<string, number> }): void {
  const lines = [
    `# Deadcode baseline (ratchet unidireccional — solo baja manualmente con limpieza real)`,
    `# Regenerar: npx tsx src/ops/deadcode-ratchet.ts --update-baseline`,
    `generatedAt=${new Date().toISOString()}`,
    `total=${counts.total}`,
    ...Object.entries(counts.byCategory).map(([k, v]) => `${k}=${v}`),
  ];
  writeFileSync(BASELINE, lines.join('\n') + '\n');
}

function main(): void {
  const update = process.argv.includes('--update-baseline');
  const current = runKnip();

  if (update) {
    writeBaseline(current);
    console.log(`[deadcode-ratchet] baseline fijado en ${current.total} issues`);
    return;
  }

  const baseline = parseBaseline();
  if (!baseline) {
    console.log('[deadcode-ratchet] sin baseline — generando la marca inicial…');
    writeBaseline(current);
    console.log(`[deadcode-ratchet] baseline inicial: ${current.total} issues (ratchet activo)`);
    return;
  }

  const base = baseline.total;
  if (current.total > base) {
    const delta = current.total - base;
    console.error(`[deadcode-ratchet] ✗ BLOQUEADO: deadcode creció +${delta} (${base} → ${current.total})`);
    for (const category of CATEGORIES) {
      const diff = (current.byCategory[category] ?? 0) - (baseline[category] ?? 0);
      if (diff > 0) console.error(`  ${category}: +${diff}`);
    }
    console.error('Opciones: limpiar el deadcode nuevo, o --update-baseline con justificación en el commit.');
    process.exit(1);
  }

  if (current.total < base) {
    console.log(`[deadcode-ratchet] ✓ PASS: ${current.total} issues (baseline ${base}, bajó ${base - current.total})`);
    console.log('  Podés fijar la nueva marca: npx tsx src/ops/deadcode-ratchet.ts --update-baseline');
    return;
  }

  console.log(`[deadcode-ratchet] ✓ PASS: ${current.total} issues (sin cambios contra baseline)`);
}

main();
