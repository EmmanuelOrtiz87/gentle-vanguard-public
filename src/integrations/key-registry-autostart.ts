#!/usr/bin/env node
/**
 * Key Registry Autostart — lanza el servicio local de keys como daemon oculto.
 *
 * Contrato (procesos-ocultos, AGENTS.md): spawn con `node --import tsx` (nunca
 * el CLI de tsx), `windowsHide: true`, `detached: true`, `stdio: 'ignore'` y
 * `child.unref()`. El PID es el del proceso REAL (sin nieto).
 *
 * Idempotente: si /health ya responde en el puerto, no hace nada.
 *
 * Uso: node --import tsx src/integrations/key-registry-autostart.ts [--port 3045]
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');
const PID_FILE = join(RUNTIME_DIR, 'key-registry.pid');
const SERVER_SCRIPT = join(ROOT, 'src', 'integrations', 'key-registry-server.ts');

function readPort(): number {
  const argIndex = process.argv.indexOf('--port');
  const fromArg = argIndex >= 0 ? Number(process.argv[argIndex + 1]) : NaN;
  const fromEnv = Number(process.env.GV_KEY_REGISTRY_PORT ?? NaN);
  return Number.isFinite(fromArg) && fromArg > 0 ? fromArg : Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 3045;
}

function health(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const req = request({ host: '127.0.0.1', port, path: '/health', timeout: 2500 }, (res) => {
      resolvePromise(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolvePromise(false));
    req.on('timeout', () => {
      req.destroy();
      resolvePromise(false);
    });
    // Sin `end()` la request nunca se envía: el socket queda abierto esperando
    // y el health check miente ("NOlevantó") aunque el servicio esté arriba.
    req.end();
  });
}

const port = readPort();

if (await health(port)) {
  console.log(`[key-registry] yaHealthy en 127.0.0.1:${port} — no se hace nada`);
  process.exit(0);
}

if (!existsSync(SERVER_SCRIPT)) {
  console.error(`[key-registry] no existe ${SERVER_SCRIPT}`);
  process.exit(1);
}

mkdirSync(RUNTIME_DIR, { recursive: true });

// Log a archivo (no consola): el daemon es invisible, pero su salida queda
// disponible para diagnosticar. Una degradación sin rastro es invisible.
const LOG_FILE = join(RUNTIME_DIR, 'key-registry.log');
const logFd = openSync(LOG_FILE, 'a');
const child = spawn(process.execPath, ['--import', 'tsx', SERVER_SCRIPT, '--port', String(port)], {
  cwd: ROOT,
  stdio: ['ignore', logFd, logFd],
  detached: true,
  windowsHide: true,
});
child.unref();
closeSync(logFd);
writeFileSync(PID_FILE, String(child.pid), 'utf-8');

let ok = false;
for (let attempt = 0; attempt < 12 && !ok; attempt += 1) {
  await new Promise((r) => setTimeout(r, 500));
  ok = await health(port);
}

console.log(ok
  ? `[key-registry] arriba en 127.0.0.1:${port} (pid ${child.pid})`
  : `[key-registry] NO levantó en 127.0.0.1:${port} (pid ${child.pid}) — log: ${LOG_FILE}`);
process.exit(ok ? 0 : 1);
