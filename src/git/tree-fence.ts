#!/usr/bin/env node
/**
 * tree-fence.ts — Atribución de mutaciones fuera de banda en el árbol de trabajo.
 *
 * Contexto (2026-09-16): tras pushes se detectaron reescrituras de src/cli/gv.ts
 * que NINGÚN paso del prepush-gate produce (verificado empíricamente). La causa
 * real: agentes de IA concurrentes (sesiones zcode/codex/minimax/opencode)
 * editando el repo mientras se opera. Este CLI correlaciona los mtimes de los
 * archivos sucios con los turnos registrados en Nexus (token_transactions,
 * consolidado por token-ingest de las 4 fuentes) y nombra al autor probable.
 *
 * Usage:
 *   npx tsx src/git/tree-fence.ts             # atribuir el estado actual
 *   npx tsx src/git/tree-fence.ts --file <p>  # atribuir un archivo puntual
 *   npx tsx src/git/tree-fence.ts --window 5  # +/- minutos alrededor del mtime (default 2)
 *
 * Exit codes: 0 = árbol limpio o atribución informativa, 1 = sin datos para atribuir.
 */
import { spawnSync } from 'child_process';
import { statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DB_PATH = join(ROOT, '.runtime', 'gentle-vanguard.db');
const DEFAULT_WINDOW_MIN = 2;

const TOOL_BY_SESSION_PREFIX: Array<[string, string]> = [
  ['mvs_', 'minimax (mavis/pi-agent)'],
  ['sess_', 'zcode (sesión CLI)'],
  ['C:\\Users', 'zcode/codex (rollout por path)'],
  ['codex', 'codex'],
];

function runGit(args: string[]): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8', windowsHide: true });
  return (r.stdout ?? '').toString().trim();
}

function toolForSession(sessionId: string): string {
  for (const [prefix, tool] of TOOL_BY_SESSION_PREFIX) {
    if (sessionId.startsWith(prefix)) return tool;
  }
  return sessionId.slice(0, 24);
}

interface Attribution {
  tool: string;
  sessionId: string;
  turns: number;
  first: string;
  last: string;
  inputTokens: number;
  outputTokens: number;
}

function attributeWindow(fromIso: string, toIso: string): Attribution[] {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT session_id, COUNT(*) AS turns, MIN(created_at) AS first, MAX(created_at) AS last,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM token_transactions
       WHERE created_at BETWEEN ? AND ?
       GROUP BY session_id ORDER BY MAX(created_at) DESC`,
    )
    .all(fromIso, toIso) as Array<{
    session_id: string;
    turns: number;
    first: string;
    last: string;
    input_tokens: number | null;
    output_tokens: number | null;
  }>;
  return rows.map((r) => ({
    tool: toolForSession(r.session_id),
    sessionId: r.session_id,
    turns: r.turns,
    first: r.first,
    last: r.last,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
  }));
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function main(): void {
  const args = process.argv.slice(2);
  const windowMin = args.includes('--window')
    ? Number(args[args.indexOf('--window') + 1]) || DEFAULT_WINDOW_MIN
    : DEFAULT_WINDOW_MIN;

  let files: string[] = [];
  const fileArg = args.indexOf('--file');
  if (fileArg !== -1 && args[fileArg + 1]) {
    files = [args[fileArg + 1]];
  } else {
    files = runGit(['status', '--porcelain'])
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim())
      .filter((p) => !p.startsWith('.runtime') && !p.startsWith('sbom.json'));
  }

  if (files.length === 0) {
    console.log('[tree-fence] Árbol limpio — nada que atribuir.');
    return;
  }

  // Ventana temporal = min/max mtime de los archivos mutados
  let minMs = Infinity;
  let maxMs = 0;
  for (const f of files) {
    try {
      const { mtimeMs } = statSync(join(ROOT, f));
      minMs = Math.min(minMs, mtimeMs);
      maxMs = Math.max(maxMs, mtimeMs);
    } catch {
      /* archivo borrado (D en porcelain) — sin mtime */
    }
  }
  if (!Number.isFinite(minMs)) {
    console.log('[tree-fence] Solo borrados — sin mtimes para atribuir.');
    return;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const toLocalIso = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const from = new Date(minMs - windowMin * 60_000);
  const to = new Date(maxMs + windowMin * 60_000);

  console.log(`[tree-fence] Archivos mutados fuera de banda (${files.length}):`);
  for (const f of files.slice(0, 10)) {
    let extra = '';
    try {
      extra = ` (mtime ${toLocalIso(new Date(statSync(join(ROOT, f)).mtimeMs))})`;
    } catch {
      /* borrado */
    }
    console.log(`   ${f}${extra}`);
  }
  console.log(
    `\n[tree-fence] Ventana de búsqueda: ${toLocalIso(from)} → ${toLocalIso(to)} (+/-${windowMin}min)`,
  );

  let attributions: Attribution[];
  try {
    attributions = attributeWindow(toLocalIso(from), toLocalIso(to));
  } catch (e) {
    console.error(`[tree-fence] No se pudo consultar Nexus: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
    return;
  }

  if (attributions.length === 0) {
    console.log('[tree-fence] Sin turnos de agentes en la ventana — origen desconocido.');
    process.exit(1);
    return;
  }

  console.log('\n[tree-fence] Turnos de agentes activos en la ventana (autor probable arriba):');
  for (const a of attributions) {
    console.log(
      `   ${a.tool} — ${a.turns} turnos ${a.first} → ${a.last} ` +
        `(in ${fmt(a.inputTokens)} / out ${fmt(a.outputTokens)}) [${a.sessionId.slice(0, 20)}…]`,
    );
  }
  const top = attributions[0];
  console.log(
    `\n[tree-fence] Autor probable: ${top.tool}. ` +
      `Los checks del prepush-gate no editan código fuente; si el cambio no es tuyo, ` +
      `descartalo con git checkout -- <file> y pausá/cerrá esa sesión.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
