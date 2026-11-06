#!/usr/bin/env node
/**
 * Anti-drift ESTRUCTURAL: MetricsWriter vendido del dashboard vs canonico.
 *
 * La copia es VENDIDA por ADR app autonomy (imports ../lib/*, OBSERVED_ROOT,
 * rutas propias) — el texto NO va a ser identico y no debe serlo. Lo que no
 * puede driftar silenciosamente es la SUPERFICIE LOGICA: funciones y metodos
 * que existen en uno y no en el otro. Si alguien agrega/quita/cambia la firma
 * de algo en el canonico sin re-sincronizar el vendido (o viceversa), este
 * test muerde con la instruccion de re-sync.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CANONICAL = readFileSync(join(ROOT, 'src', 'database', 'nexus', 'metrics-writer.ts'), 'utf8');
const VENDORED = readFileSync(join(ROOT, 'apps', 'web-dashboard', 'server', 'database', 'metrics-writer.ts'), 'utf8');

/** Superficie logica: funciones/metodos con sus aridades (name/arity). */
function surface(source: string): Set<string> {
  const out = new Set<string>();
  // funciones exportadas y internas de nivel modulo
  for (const m of source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)/gm)) {
    out.add(`fn ${m[1]}/${(m[2].match(/,/g)?.length ?? 0) + (m[2].trim() ? 1 : 0)}`);
  }
  // metodos de la clase MetricsWriter (indentados 2 espacios, no private fields)
  for (const m of source.matchAll(/^  (?:private\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:{]/gm)) {
    out.add(`method ${m[1]}/${(m[2].match(/,/g)?.length ?? 0) + (m[2].trim() ? 1 : 0)}`);
  }
  // interfaces exportadas
  for (const m of source.matchAll(/^export\s+(?:interface|type)\s+(\w+)/gm)) {
    out.add(`type ${m[1]}`);
  }
  return out;
}

test('MetricsWriter vendido: superficie logica sincronizada con el canonico', () => {
  const canon = surface(CANONICAL);
  const vend = surface(VENDORED);
  const missingInVendored = [...canon].filter((x) => !vend.has(x));
  const missingInCanonical = [...vend].filter((x) => !canon.has(x));
  const problems: string[] = [];
  if (missingInVendored.length) {
    problems.push(`FALTA en vendido (re-sincronizar desde src/database/nexus/metrics-writer.ts):\n    ${missingInVendored.join('\n    ')}`);
  }
  if (missingInCanonical.length) {
    problems.push(`SOLO en vendido (promover al canonico o eliminar conscientemente):\n    ${missingInCanonical.join('\n    ')}`);
  }
  assert.strictEqual(problems.length, 0, `MetricsWriter vendido driftó estructuralmente.\n  ${problems.join('\n  ')}`);
  assert.ok(canon.size >= 5, `superficie esperada: ${canon.size} simbolos (debe existir logica real)`);
});
