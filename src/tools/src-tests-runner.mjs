/**
 * src-tests-runner.mjs — descubrimiento estructural de los tests bajo src/
 * (GB-20261120, meta-auditoría): 24 test files vivían fuera de TODO circuito
 * del push (el selftest lista 16 a mano). Este runner descubre TODOS los tests
 * de src/, excluye SOLO los declarados aquí con razón (ratchet: la exclusión
 * es una deuda visible — la lista solo puede achicarse), y ejecuta el resto.
 *
 * Agregado a `gates:selftest` (pre-push-gates-selftest): ahora el circuito del
 * push cubre los contratests de los meta-gates (orphan, declaration-audit,
 * token-safety, ...) que antes se auto-excluían del circuito que los vigila.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Tests excluidos del circuito — cada entrada necesita su razón y su dueño.
 * El ratchet solo permite achicar esta lista. Último achique 2026-11-21: se
 * levantaron las 2 exclusiones declaradas el 2026-11-20 — prepush-app-scope
 * (assets/ quedó declarado en SHARED_SURFACES; el clasificador pasa 7/7 y la
 * semántica `full`+`apps:[]` quedó documentada en su test) y decks-facts
 * (guiones conciliados al canon 70 en 3926e169a; el test de estado pasa 24/24). */
const EXCLUSIONS = [];

function listTests(current, out = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) listTests(path, out);
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

function main() {
  const all = listTests(join(ROOT, 'src')).map((p) => p.slice(ROOT.length + 1));
  const excluded = new Map(EXCLUSIONS.map((e) => [e.file, e.reason]));
  const included = all.filter((f) => !excluded.has(f.replace(/\\/g, '/')));
  for (const [file, reason] of excluded) {
    if (all.some((f) => f.replace(/\\/g, '/') === file)) {
      console.log(`[src-tests] EXCLUIDO (deuda declarada): ${file} — ${reason}`);
    }
  }
  console.log(
    `[src-tests] descubiertos: ${all.length} · excluidos: ${excluded.size} · a correr: ${included.length}`,
  );
  if (included.length === 0) return;
  execFileSync(process.execPath, ['--import', 'tsx', '--test', ...included], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

main();
