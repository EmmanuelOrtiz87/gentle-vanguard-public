#!/usr/bin/env node
/**
 * Engram auto-compact — diagnóstico honesto, sin mutaciones.
 *
 * Contexto (auditoría 2026-11-18, P0-2): el "compact" anterior ejecutaba
 * `engram sync --export` + `engram sync --import` sobre el MISMO proyecto (el
 * import ignora los chunks que acaba de exportar: ciclo vacío), y después se
 * auto-logueaba con `engram save "Auto-compact run" ...`. Eso dejó 420
 * observaciones basura en la memoria (190 `Auto-compact run` + 230 con el
 * título truncado `"Auto-compact`) sin compactar una sola fila.
 *
 * Este script reporta la verdad: doctor, conflictos pendientes, grupos de
 * títulos duplicados y self-logs heredados. No escribe en Engram — el dedupe
 * masivo y la resolución de conflictos son decisiones del owner (soft-delete
 * por `engram delete <id>` / MCP `mem_judge`), fuera de la Ola 0.
 *
 * Uso: node --import tsx src/knowledge/engram-auto-compact.ts [--project P] [--quiet] [--json]
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';
import { resolveEngramDbPath } from './engram-paths.js';

const ROOT = resolve(process.cwd());
const RESULT_FILE = join(ROOT, '.runtime', 'engram-compact-last.json');

interface DoctorCheck {
  check_id: string;
  result: string;
  message: string;
  safe_next_step?: string;
}

interface ConflictStats {
  pending?: number;
  judged?: number;
  deferred?: number;
}

interface DuplicateReport {
  liveObservations: number;
  duplicateTitleGroups: number;
  redundantRows: number;
  legacySelfLogs: number;
  topGroups: Array<{ title: string; count: number }>;
}

function runEngram(args: string[], timeout = 120_000) {
  return runSync('engram', args, { timeout, stdio: 'pipe' });
}

function readDoctor(): {
  status: string;
  summary: Record<string, number>;
  problems: DoctorCheck[];
} | null {
  const r = runEngram(['doctor', '--json']);
  if (r.status !== 0 && !r.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(r.stdout) as {
      status?: string;
      summary?: Record<string, number>;
      checks?: DoctorCheck[];
    };
    const problems = (parsed.checks ?? []).filter((c) => c.result !== 'ok');
    return { status: parsed.status ?? 'unknown', summary: parsed.summary ?? {}, problems };
  } catch {
    return null;
  }
}

function readConflictStats(project: string): ConflictStats | null {
  const r = runEngram(['conflicts', 'stats', '--project', project]);
  const text = `${r.stdout}\n${r.stderr}`;
  const block = text.match(/By judgment_status:\s*([\s\S]*?)(?:By relation type:|$)/);
  const stats: ConflictStats = {};
  if (block) {
    for (const m of block[1].matchAll(/^\s*(\w+):\s+(\d+)/gm)) {
      if (m[1] === 'pending' || m[1] === 'judged') stats[m[1]] = Number(m[2]);
    }
  }
  const deferred = text.match(/Deferred:\s+(\d+)/);
  if (deferred) stats.deferred = Number(deferred[1]);
  return Object.keys(stats).length > 0 ? stats : null;
}

function readDuplicates(dbPath: string, project: string): DuplicateReport | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const live = (
      db
        .prepare('SELECT count(*) c FROM observations WHERE deleted_at IS NULL AND project = ?')
        .get(project) as { c: number }
    ).c;
    const groups = db
      .prepare(
        `SELECT title, count(*) c FROM observations
         WHERE deleted_at IS NULL AND project = ?
         GROUP BY title HAVING c > 1 ORDER BY c DESC`,
      )
      .all(project) as Array<{ title: string; c: number }>;
    const legacySelfLogs = (
      db
        .prepare(
          `SELECT count(*) c FROM observations
           WHERE deleted_at IS NULL AND project = ?
             AND (title LIKE 'Auto-compact%' OR title LIKE '"Auto-compact%')`,
        )
        .get(project) as { c: number }
    ).c;
    return {
      liveObservations: live,
      duplicateTitleGroups: groups.length,
      redundantRows: groups.reduce((sum, g) => sum + (g.c - 1), 0),
      legacySelfLogs,
      topGroups: groups.slice(0, 5).map((g) => ({ title: g.title, count: g.c })),
    };
  } finally {
    db.close();
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const project = args.includes('--project')
    ? args[args.indexOf('--project') + 1]
    : 'gentle-vanguard';
  const quiet = args.includes('--quiet');
  const asJson = args.includes('--json');
  const say = (m: string) => {
    if (!quiet && !asJson) console.log(m);
  };

  say(`[INFO] Engram diagnostics for project: ${project}`);
  const dbPath = resolveEngramDbPath();
  say(`[INFO] Store: ${dbPath}${existsSync(dbPath) ? '' : ' (NOT FOUND)'}`);

  const doctor = readDoctor();
  if (!doctor) {
    say('[WARN] engram doctor unavailable (CLI missing or unparseable output)');
  } else {
    const { ok = 0, warnings = 0, blocked = 0, errors = 0 } = doctor.summary;
    say(
      `[${errors + blocked > 0 ? 'ERR' : 'OK'}] doctor: ${doctor.status} (ok=${ok}, warnings=${warnings}, blocked=${blocked}, errors=${errors})`,
    );
    for (const p of doctor.problems) {
      say(`  · ${p.check_id} [${p.result}]: ${p.message}`);
      if (p.safe_next_step && p.safe_next_step !== 'No action required.') {
        say(`    next: ${p.safe_next_step}`);
      }
    }
  }

  const conflicts = readConflictStats(project);
  if (!conflicts) say('[WARN] conflicts stats unavailable');
  else {
    const { pending = 0, judged = 0, deferred = 0 } = conflicts;
    say(
      `[${pending > 0 ? 'WARN' : 'OK'}] conflicts: ${pending} pendientes de juicio, ${judged} juzgados, ${deferred} diferidos`,
    );
    if (pending > 0) {
      say('  next: revisar con `engram conflicts list --status pending` o MCP mem_judge');
    }
  }

  const duplicates = readDuplicates(dbPath, project);
  if (!duplicates) say('[WARN] duplicate scan unavailable (store not readable)');
  else {
    say(
      `[INFO] observaciones vivas: ${duplicates.liveObservations}; títulos repetidos: ${duplicates.duplicateTitleGroups} grupos (${duplicates.redundantRows} filas adicionales con el mismo título; coincidir el título no implica contenido idéntico)`,
    );
    for (const g of duplicates.topGroups) {
      say(`  · "${g.title}" ×${g.count}`);
    }
    if (duplicates.legacySelfLogs > 0) {
      say(
        `[WARN] ${duplicates.legacySelfLogs} self-logs heredados del compact anterior ("Auto-compact run"/"Auto-compact") — legado, no se crean más`,
      );
    }
  }

  const fail = (doctor?.summary?.errors ?? 0) + (doctor?.summary?.blocked ?? 0) > 0;
  const report = {
    timestamp: new Date().toISOString(),
    project,
    store: dbPath,
    doctor,
    conflicts,
    duplicates,
    mutations: 'none (diagnóstico read-only; dedupe y juicios son decisión del owner)',
  };

  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2), 'utf-8');
  } catch {
    /* telemetría */
  }

  if (asJson) console.log(JSON.stringify(report, null, 2));
  say(
    fail
      ? '[ERR] doctor reporta blocked/errors: intervención necesaria'
      : '[OK] Diagnóstico completa — sin mutaciones; ver .runtime/engram-compact-last.json',
  );
  return fail ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
