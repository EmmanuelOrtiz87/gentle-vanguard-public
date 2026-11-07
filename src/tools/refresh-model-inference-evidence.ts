#!/usr/bin/env node
/**
 * refresh-model-inference-evidence — refresca la evidencia de inferencia del
 * modelo ACTIVO fuera de las sesiones.
 *
 * GAP: el probe corre en fase 0 del autostart (por sesión). Entre sesiones la
 * evidencia vence (TTL 900s) y el watchtower reporta `active model: WARN —
 * no fresh successful probe` aunque el modelo siga sirviendo. La tarea
 * programada `Gentle-Vanguard-Model-Inference-Refresh` (cada 30 min,
 * bootstrap step 4b8) llama este wrapper: una inferencia real del modelo
 * activo (max_tokens 1) — para ollama es una llamada local barata; NO usa
 * --registry (los candidatos remotos con cuota agotada no aportan nada aquí
 * y evitamos 48 req/día de ruido).
 *
 * Salida exit 0/1/2 según el veredicto (PASS/FAIL/UNKNOWN) — la tarea
 * programada ignora el código; el veredicto queda en la evidencia que lee el
 * watchtower.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main as runProbe } from './model-inference-probe.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const LOG = join(ROOT, '.runtime', 'model-inference-refresh.log');
function log(line: string): void {
  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    appendFileSync(LOG, `[${new Date().toISOString()}] ${line}
`, 'utf-8');
  } catch {
    /* best-effort */
  }
}

// El cwd heredado de una tarea programada es System32: anclar el repo para
// que ROOT (cwd) del probe resuelva siempre al workspace.
process.chdir(ROOT);

const code = await runProbe(['--local-timeout', '90000']);
log(`veredicto exit=${code}`);
process.exitCode = code;
