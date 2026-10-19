/**
 * Ejecuta el refresh online de GV Knowledge Ops desde la tarea programada diaria.
 * Solo agrega evidencia/propuestas; no aplica cambios de contenido.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(ROOT, 'apps', 'gv-knowledge-ops');
const LOG = join(APP, '.runtime', 'refresh-scheduled.log');
const OFFLINE = process.argv.includes('--offline') || process.env.GV_KNOWLEDGE_REFRESH_OFFLINE === '1';

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    mkdirSync(join(APP, '.runtime'), { recursive: true });
    appendFileSync(LOG, line);
  } catch {
    // Logging is best-effort; scheduled maintenance must remain fail-safe.
  }
}

try {
  const args = [join(APP, 'scripts', 'refresh.mjs'), ...(OFFLINE ? ['--offline'] : [])];
  const result = runSync(process.execPath, args, {
    cwd: APP,
    windowsHide: true,
  });
  if (result.status === 0) log(`refresh: OK (${OFFLINE ? 'offline review/proposals' : 'sources, review, proposals'})`);
  else log(`refresh: FAIL (exit ${result.status}) ${String(result.stderr).slice(-500)}`);
} catch (error) {
  log(`refresh: FATAL ${error instanceof Error ? error.message : String(error)}`);
}

process.exit(0);
