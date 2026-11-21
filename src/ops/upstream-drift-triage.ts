/**
 * Upstream drift triage — reminder de seguimiento (BL-2026-11-16).
 *
 * El gap detectado en la absorción 2026-11-16: `upstream-watch` DETECTA los
 * drifts mecánicamente, pero la absorción conceptual era manual y se
 * atrasó semanas (drifts desde 2026-10-21 sin procesar hasta el 11-16).
 * Este paso (lazy en autostart) hace el follow-through visible: si la
 * última corrida del watcher reportó drifts posteriores al último triage,
 * lo recuerda. NO bloquea: es un recordatorio, no un gate.
 *
 * Uso:
 *   npx tsx src/ops/upstream-drift-triage.ts           # recordatorio
 *   npx tsx src/ops/upstream-drift-triage.ts --mark    # registra triage hecho
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface TriageDecision {
  remind: boolean;
  reason: string;
}

const WATCH_DIR = join(resolve(process.cwd()), '.runtime', 'upstream-watch');
const LAST_RUN = join(WATCH_DIR, 'last-run.json');
const LAST_TRIAGE = join(WATCH_DIR, 'last-triage.json');

/** Decisión pura: recordar si hay drifts de una corrida posterior al último triage. */
export function decideReminder(
  lastRun: { checkedAt?: string; drifts?: number } | null,
  lastTriage: { processedThrough?: string } | null,
): TriageDecision {
  if (!lastRun || !lastRun.checkedAt) return { remind: false, reason: 'sin corrida del watcher' };
  if (!lastRun.drifts) return { remind: false, reason: 'sin drifts en la última corrida' };
  const checkedAt = lastRun.checkedAt;
  if (lastTriage?.processedThrough && lastTriage.processedThrough >= checkedAt) {
    return { remind: false, reason: 'drifts ya procesados (triage posterior a la corrida)' };
  }
  return {
    remind: true,
    reason: `${lastRun.drifts} drift(s) de ${checkedAt} sin triage — fetch + diff conceptual + decidir absorción (ver docs/reference/ABSORPTION-2026-11-16-UPSTREAM-SWEEP.md como método)`,
  };
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes('--mark')) {
    const lastRun = readJson(LAST_RUN) as { checkedAt?: string } | null;
    writeFileSync(
      LAST_TRIAGE,
      JSON.stringify({ processedThrough: lastRun?.checkedAt ?? new Date().toISOString(), markedAt: new Date().toISOString() }, null, 2),
    );
    console.log('[UPSTREAM-TRIAGE] triage registrado');
    return 0;
  }
  const lastRun = readJson(LAST_RUN) as { checkedAt?: string; drifts?: number } | null;
  const lastTriage = existsSync(LAST_TRIAGE)
    ? (readJson(LAST_TRIAGE) as { processedThrough?: string } | null)
    : null;
  const decision = decideReminder(lastRun, lastTriage);
  if (decision.remind) {
    console.log(`[UPSTREAM-TRIAGE] ${decision.reason}`);
  }
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1])
) {
  main();
}
