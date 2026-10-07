/**
 * tests/unit/run-parallel.mjs
 *
 * Runner paralelo para los tests unitarios del stack.
 * Descubre *.test.ts bajo tests/unit/ y los reparte en N workers
 * vía `node --test --test-concurrency=N --import tsx` para tener
 * paralelismo real (no fake "fork por archivo").
 *
 * Uso:
 *   node tests/unit/run-parallel.mjs                   # default: CPUs/2 workers
 *   node tests/unit/run-parallel.mjs --workers=4       # explícito
 *   node tests/unit/run-parallel.mjs --pattern=policy  # solo los que matchean
 *
 * Output: TAP (compatible con `node --test`). Exit 0 si todos pasan.
 *
 * Por qué existe:
 *   - El stack tiene 80+ test files en tests/unit/.
 *   - `tsx --test tests/unit/*.test.ts` corre en serie (~25-40s en hardware típico).
 *   - Vitest workers paraleliza dentro de cada package, pero los `node --test`
 *     aislados del root NO.
 *   - Este runner cierra GAP-008 con paralelización nativa de Node 22+.
 */
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cpus } from 'node:os';

const ROOT = process.cwd();
const UNIT_DIR = join(ROOT, 'tests', 'unit');
const DEFAULT_WORKERS = Math.max(2, Math.floor(cpus().length / 2));

function parseArgs() {
  const args = { workers: DEFAULT_WORKERS, pattern: null };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--workers=')) {
      const n = Number(arg.slice('--workers='.length));
      if (Number.isFinite(n) && n > 0) args.workers = Math.floor(n);
    } else if (arg.startsWith('--pattern=')) {
      args.pattern = arg.slice('--pattern='.length);
    }
  }
  return args;
}

function discoverTests(dir, pattern) {
  /** @type {string[]} */
  const out = [];
  function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (name.endsWith('.test.ts')) {
        if (!pattern || name.includes(pattern)) out.push(p);
      }
    }
  }
  try {
    walk(dir);
  } catch {
    // tests/unit/ no existe — silent
  }
  return out.sort();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function runChunk(chunkFiles, workerId) {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      [
        '--import', 'tsx',
        '--test',
        `--test-concurrency=1`,
        ...chunkFiles,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    proc.stdout.on('data', (c) => {
      const s = c.toString();
      // Prefix lines con worker id para distinguir
      process.stdout.write(s.replace(/^/gm, `[w${workerId}] `));
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const args = parseArgs();
  const files = discoverTests(UNIT_DIR, args.pattern);
  if (files.length === 0) {
    console.error(`No tests found under ${UNIT_DIR}${args.pattern ? ` matching ${args.pattern}` : ''}`);
    process.exit(1);
  }
  const chunks = chunk(files, Math.max(1, Math.ceil(files.length / args.workers)));
  console.error(`[runner] ${files.length} test files → ${chunks.length} workers (concurrency=${args.workers}, files/worker=${chunks[0]?.length ?? 0})`);
  const t0 = Date.now();
  const codes = await Promise.all(chunks.map((c, i) => runChunk(c, i + 1)));
  const t1 = Date.now();
  const failed = codes.filter((c) => c !== 0).length;
  console.error(`[runner] ${files.length} files in ${(t1 - t0) / 1000}s — ${failed} worker(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[runner] fatal', err);
  process.exit(2);
});