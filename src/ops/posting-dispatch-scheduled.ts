#!/usr/bin/env node
/**
 * posting-dispatch-scheduled.ts — Wrapper silencioso para la tarea programada
 * de Windows (Gentle-Vanguard-Posting-Dispatch, cada 15 min).
 *
 * Drena un round de la cola post_queue del ContentOS contra el registry de
 * providers de producción. Hoy el registry está VACÍO (sin credenciales de
 * redes): imprime {claimed: 0} y sale 0 — fail-safe. Cuando el owner cargue
 * credenciales + OAuth (providers-cli.ts), la cola se drena sola sin
 * intervención: el dispatch ya hace claim selectivo + backoff + DLQ.
 *
 * Run (manual): npx tsx src/ops/posting-dispatch-scheduled.ts
 * Run (tarea):  node.exe --import tsx src/ops/posting-dispatch-scheduled.ts
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const LOG = join(ROOT, '.runtime', 'posting-dispatch-scheduled.log');
const LOG_MAX_BYTES = 256 * 1024;

/**
 * Keeps the scheduled-task log bounded. This task runs every 15 minutes with no
 * rotation, so without a cap the log grows without limit. When it crosses the
 * limit the file is rotated once: the previous content is deleted rather than
 * kept, because a 15-minute dispatch log has no value beyond its most recent
 * window. Rotation is best-effort — a failure here must not fail the dispatch.
 */
function rotateIfOversized(): void {
  try {
    if (!existsSync(LOG)) return;
    if (statSync(LOG).size < LOG_MAX_BYTES) return;
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    const rotated = `${LOG}.1`;
    if (existsSync(rotated)) unlinkSync(rotated);
    renameSync(LOG, rotated);
  } catch {
    /* best-effort: never fail the dispatch because of log rotation */
  }
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    rotateIfOversized();
    appendFileSync(LOG, line);
  } catch {
    /* best-effort */
  }
  console.log(msg);
}

async function main(): Promise<void> {
  // Import directo del CLI one-shot (mismo proceso, sin nieto de tsx CLI).
  const { getContentDb } = await import('../../apps/content-cms/server/db');
  const { createPostQueueDb } = await import('../../apps/content-cms/server/posting/sqlite-adapter');
  const { createProviderRegistry, dispatchOnce } = await import(
    '../../apps/content-cms/server/posting/dispatch'
  );

  const db = getContentDb();
  const queueDb = createPostQueueDb(db.database);
  // Registry de producción: SIN estrategias hasta credenciales del owner.
  const registry = createProviderRegistry([]);
  const summary = await dispatchOnce(
    queueDb,
    { nowIso: () => new Date().toISOString() },
    {
      warn: (msg: string) => log(`WARN ${msg}`),
      error: (msg: string) => log(`ERROR ${msg}`),
    },
    registry,
  );
  log(`dispatch: ${JSON.stringify(summary)}`);
}

try {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(0); // fail-safe: la tarea programada no reporta error al scheduler
    });
} catch (err) {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0);
}
