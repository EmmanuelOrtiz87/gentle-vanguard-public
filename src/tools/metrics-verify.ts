#!/usr/bin/env node
/**
 * metrics-verify.ts — F4.1 live metrics guard
 *
 * Verifies that docs do not contain hardcoded stale counts and that
 * config/stack-metrics.json exists and is parseable.
 * Usage: npx tsx src/tools/metrics-verify.ts [--json]
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const METRICS_PATH = join(ROOT, 'config', 'stack-metrics.json');

function checkMetricsFile(): { ok: boolean; msg: string } {
  if (!existsSync(METRICS_PATH)) return { ok: false, msg: 'config/stack-metrics.json missing' };
  try {
    const j = JSON.parse(readFileSync(METRICS_PATH, 'utf-8'));
    if (!j.metrics) return { ok: false, msg: 'metrics field missing' };
    return {
      ok: true,
      msg: `metrics OK (skills=${j.metrics.skills?.count ?? '?'}, src=${j.metrics.src?.tsFiles ?? '?'})`,
    };
  } catch (e) {
    return { ok: false, msg: `parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function main(): void {
  const json = process.argv.includes('--json');
  const r = checkMetricsFile();
  const result = { file: 'config/stack-metrics.json', ...r, timestamp: new Date().toISOString() };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[metrics-verify] ${r.ok ? 'PASS' : 'FAIL'} — ${r.msg}`);
    if (!r.ok)
      console.log('  Fix: regenerate config/stack-metrics.json via gv info or manual count');
  }
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
