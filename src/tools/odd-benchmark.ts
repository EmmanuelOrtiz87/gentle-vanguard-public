/**
 * odd-benchmark.ts — Instrumento de medición del caso ODD estándar ("bug de 3 líneas inline").
 *
 * Gap #1 declarado por comparative-benchmark.ts (2026-10-21): Gentle-AI v4 mide su
 * ciclo inline con el benchmark 335s/56 turnos (v3 SDD) → 77s/10 turnos (v4 ODD).
 * Igualar el tipo de tarea no basta: requiere fixture, modelo, contexto y aceptación equivalentes.
 *
 * Protocolo v1 (fiel al espíritu v4): un bug conocido de pocas líneas, desde detección
 * hasta commit verificado, midiendo elapsed_seconds y turns (tool-calls del agente).
 *
 * Honestidad: las entradas del registro citan SIEMPRE sus commits verificados por git
 * (el número se puede re-chequear con `git log`), nunca a mano.
 *
 * Uso:
 *   npx tsx src/tools/odd-benchmark.ts          → reporte (seed + runtime entries)
 *   npx tsx src/tools/odd-benchmark.ts --add '{"id":"...","elapsedSeconds":N,"turns":N,"commit":"SHA"}'
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { runSync } from '../core/run-command.js';

interface OddCase {
  id: string;
  date: string;
  taskDescription: string;
  elapsedSeconds: number;
  turns: number;
  commit: string; // SHA corta del commit que cierra el caso (verificable por git)
  notes?: string;
}

const CASES_PATH = '.runtime/odd-bench/cases.json';
const V4_VALIDATED_S = 77; // gentla-ai v4 ODD — public-claim upstream (77s/10 turns)
const V4_TURNS = 10;

/**
 * Seed ronda 15 (2026-10-21) — caso REAL del stack:
 * El prepush-gate atrapó 2 errores de lint (detect-unsafe-regex + fileURLToPath huérfano)
 * tras commit 1c5a5da48; ciclo fix→commit→push verde 7248c7437.
 * Turns medidos en la sesión: 5 tool-calls (lint inspect → 2 edits → 1 bash verify+commit+push → confirm).
 */
const SEED_CASES: OddCase[] = [
  {
    id: 'r15-lint-gate-fix',
    date: '2026-10-21',
    taskDescription:
      'prepush-gate falló por 2 lint errors post-commit → fix (inline-comment justificado + import muerto) → commit → push verde (7248c7437)',
    elapsedSeconds: 97,
    turns: 5,
    commit: '7248c7437',
    notes: 'Ciclo completo detect-fallos→corrige→commit→detectado por ODD-protocol v1 en ronda 17 con timestamps git como evidencia',
  },
];

interface Store {
  cases: OddCase[];
}
function load(): Store {
  try {
    return JSON.parse(readFileSync(CASES_PATH, 'utf8'));
  } catch {
    return { cases: [...SEED_CASES] };
  }
}
function save(store: Store): void {
  mkdirSync('.runtime/odd-bench', { recursive: true });
  writeFileSync(CASES_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function render(store: Store): void {
  const ours = store.cases.slice().reverse();
  const seconds = store.cases.map((c) => c.elapsedSeconds);
  const turns = store.cases.map((c) => c.turns);
  const mdS = Math.round(median(seconds));
  const mdT = Math.round(median(turns));
  // Segmentación descriptiva: no selecciona un experimento comparable con upstream.
  const small = store.cases.filter((c) => c.turns <= 8);
  const smS = small.length ? Math.round(median(small.map((c) => c.elapsedSeconds))) : 0;
  const smT = small.length ? Math.round(median(small.map((c) => c.turns))) : 0;
  console.log('[ODD-BENCH] Protocolo v1 — caso estándar: bug pequeño inline, detección→commit verificado');
  console.log(`[ODD-BENCH] Nuestro stack — casos: ${ours.length}`);
  for (const c of ours) {
    console.log(`  • ${c.id} | ${c.elapsedSeconds}s / ${c.turns} turnos | commit ${c.commit} (git-verificable)`);
  }
  console.log(
    `[ODD-BENCH] GV global (todas las escalas): ${mdS}s / ${mdT} turnos · GV segmento ≤8 turnos (n=${small.length}): ${smS}s / ${smT} turnos · Gentle-AI v4 (public-claim 2026-10): ${V4_VALIDATED_S}s / ${V4_TURNS} turnos`,
  );
  console.log('[ODD-BENCH] Observación local: no demuestra paridad ni superioridad. Sin fixture, modelo, contexto y aceptación equivalentes no se calcula homologación de rendimiento.');
  console.log(`[ODD-BENCH] Registro: ${CASES_PATH} — agregar caso: --add '{"id":"...","elapsedSeconds":N,"turns":N,"commit":"SHA-corta"}'`);
}

const argvIndex = process.argv.indexOf('--add');
if (argvIndex !== -1) {
  const raw = process.argv[argvIndex + 1];
  if (!raw) {
    console.error('[ODD-BENCH] --add requiere un JSON válido apartados el offset argv');
    process.exit(1);
  }
  try {
    const one = JSON.parse(raw) as Partial<OddCase>;
    const store = load();
    if (typeof one.id !== 'string' || !one.id.trim() ||
      typeof one.elapsedSeconds !== 'number' || !Number.isFinite(one.elapsedSeconds) || one.elapsedSeconds <= 0 ||
      typeof one.turns !== 'number' || !Number.isSafeInteger(one.turns) || one.turns <= 0 ||
      typeof one.commit !== 'string' || !/^[a-f0-9]{7,40}$/i.test(one.commit)) {
      throw new Error('Requiere id no vacío, elapsedSeconds positivo, turns entero positivo y SHA de commit real');
    }
    const id = one.id.trim();
    if (store.cases.some((c) => c.id === id)) {
      throw new Error(`ID de caso duplicado: ${id}`);
    }
    const verified = runSync('git', ['rev-parse', '--verify', `${one.commit}^{commit}`], {
      timeout: 5000,
    });
    if (verified.status !== 0 || !/^[a-f0-9]{40}$/i.test(verified.stdout.trim())) {
      throw new Error(`Commit no encontrado en Git: ${one.commit}`);
    }
    const nowIso = new Date().toISOString().slice(0, 10);
    const entry: OddCase = {
      id,
      date: nowIso,
      taskDescription: one.taskDescription ?? '', // se provee; opcional protegido
      elapsedSeconds: one.elapsedSeconds,
      turns: one.turns,
      commit: verified.stdout.trim(),
      notes: one.notes,
    };
    store.cases.push(entry);
    save(store);
    console.log(`[ODD-BENCH] caso ${one.id} agregado — registro ${store.cases.length} entradas`);
    render(store);
  } catch (err) {
    console.error('[ODD-BENCH] Caso inválido en --add:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  if (!existsSync(CASES_PATH)) save({ cases: [...SEED_CASES] });
  render(load());
}
