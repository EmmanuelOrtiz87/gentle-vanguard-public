#!/usr/bin/env node
/**
 * Runs the `tests/unit` suite with the node:test runner, skipping the specs that
 * are written for vitest.
 *
 * Why this exists: `tests/unit/*.test.ts` mixes two frameworks. The public-web
 * specs (`catalog-card`, `landing-*`, `public-source-boundary`, `public-web-*`)
 * import `vitest`; handing them to `node --test` makes the loader fail and the
 * whole suite go red even though every real assertion passes. Those specs are
 * covered by the `web-check` delivery-gate check (`vitest run --config
 * vitest.public-web.config.ts`), which is how CI splits them too.
 *
 * Rule: a spec is vitest if it imports from 'vitest' in its header. Everything
 * else runs under node:test. No file silently disappears from every suite: the
 * skipped list is printed and web-check is a blocking check.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const UNIT_DIR = join(ROOT, 'tests', 'unit');
const VITEST_IMPORT = /\bfrom\s+['"]vitest['"]/;

const files = readdirSync(UNIT_DIR)
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

const nodeSpecs: string[] = [];
const vitestSpecs: string[] = [];
for (const name of files) {
  const header = readFileSync(join(UNIT_DIR, name), 'utf-8').slice(0, 4000);
  (VITEST_IMPORT.test(header) ? vitestSpecs : nodeSpecs).push(name);
}

console.log(
  `[unit] node:test ${nodeSpecs.length} file(s) · vitest ${vitestSpecs.length} skipped (covered by web-check)`,
);
if (vitestSpecs.length > 0) {
  console.log(`[unit] skipped vitest specs: ${vitestSpecs.join(', ')}`);
}

if (nodeSpecs.length === 0) {
  console.error('[unit] no node:test specs found — refusing to report a green suite');
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...nodeSpecs.map((name) => join('tests', 'unit', name))],
  { cwd: ROOT, stdio: 'inherit', windowsHide: true },
);

process.exit(result.status ?? 1);
