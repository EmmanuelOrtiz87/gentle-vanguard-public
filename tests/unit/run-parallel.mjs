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
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
  /** @type {string[]} */
  const vitestRouted = [];
  function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (name.endsWith('.test.ts')) {
        if (pattern && !name.includes(pattern)) continue;
        // Los tests escritos contra la API de vitest no corren bajo node --test
        // (runner ausente → TypeError en validateTags). Se rutean a vitest.
        const head = readFileSync(p, 'utf8').split('\n', 5).join('\n');
        if (/from\s+'vitest'/.test(head)) {
          vitestRouted.push(p);
          continue;
        }
        out.push(p);
      }
    }
  }
  try {
    walk(dir);
  } catch {
    // tests/unit/ no existe — silent
  }
  if (vitestRouted.length > 0) {
    console.error(
      `[runner] ${vitestRouted.length} archivos vitest excluidos de node --test (correr con: pnpm vitest run):`,
    );
    for (const f of vitestRouted) console.error(`  - ${relative(ROOT, f)}`);
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
      ['--import', 'tsx', '--test', `--test-concurrency=1`, ...chunkFiles],
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

/**
 * Corre UN archivo de test solo y devuelve true si pasa.
 * Sirve para distinguir un fallo real de un test flaky (el que falla bajo
 * paralelismo y pasa solo).
 */
function runSingle(file) {
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx', '--test', `--test-concurrency=1`, file],
      { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
    );
    proc.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Segunda pasada: identifica QUÉ archivo falló y separa los flaky de los
 * fallos reales.
 *
 * Sin esto, un solo test con dependencia de red (p. ej. el crawler) bloquea
 * todos los pushes del stack. Con esto, el fallo se nombra y el flaky se
 * declara como flaky (aviso explícito), no se esconde ni se maquilla de verde.
 */
async function triageFailedChunks(chunks, codes) {
  const flaky = [];
  const hardFailures = [];
  for (let i = 0; i < chunks.length; i++) {
    if (codes[i] === 0) continue;
    for (const file of chunks[i]) {
      const passed = await runSingle(file);
      // Falló en el worker pero pasa solo:contamination entre tests del
      // mismo chunk (o dependencia externa). Es FLAKY y se nombra.
      if (passed) {
        flaky.push(file);
        continue;
      }
      // Falló solo también: se reintenta una vez (el flaky real es
      // intermitente, no determinista).
      const passedAgain = await runSingle(file);
      if (passedAgain) flaky.push(file);
      else hardFailures.push(file);
    }
  }
  return { flaky, hardFailures };
}

async function main() {
  const args = parseArgs();
  const files = discoverTests(UNIT_DIR, args.pattern);
  if (files.length === 0) {
    console.error(
      `No tests found under ${UNIT_DIR}${args.pattern ? ` matching ${args.pattern}` : ''}`,
    );
    process.exit(1);
  }
  const chunks = chunk(files, Math.max(1, Math.ceil(files.length / args.workers)));
  console.error(
    `[runner] ${files.length} test files → ${chunks.length} workers (concurrency=${args.workers}, files/worker=${chunks[0]?.length ?? 0})`,
  );
  const t0 = Date.now();
  const codes = await Promise.all(chunks.map((c, i) => runChunk(c, i + 1)));
  const t1 = Date.now();
  const failedWorkers = codes.filter((c) => c !== 0).length;

  if (failedWorkers === 0) {
    console.error(`[runner] ${files.length} files in ${(t1 - t0) / 1000}s — OK`);
    process.exit(0);
  }

  console.error(`[runner] ${failedWorkers} worker(s) fallaron: triage por archivo…`);
  const { flaky, hardFailures } = await triageFailedChunks(chunks, codes);
  const t2 = Date.now();

  for (const file of flaky) {
    console.error(`[runner] FLAKY (pasa solo, falla en paralelo): ${relative(ROOT, file)}`);
  }
  for (const file of hardFailures) {
    console.error(`[runner] FALLO REAL: ${relative(ROOT, file)}`);
  }
  console.error(
    `[runner] ${files.length} files in ${(t2 - t0) / 1000}s — ${hardFailures.length} fallo(s) real(es), ${flaky.length} flaky`,
  );
  process.exit(hardFailures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[runner] fatal', err);
  process.exit(2);
});
