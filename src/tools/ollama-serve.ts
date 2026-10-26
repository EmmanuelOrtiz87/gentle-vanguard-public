/**
 * ollama-serve — levanta el servidor de Ollama con el runtime optimizado
 * medido para esta maquina (bitacora §4.16/§4.17):
 *
 *   OLLAMA_IGPU_ENABLE=1          — sin esto corre en CPU (8x mas lento)
 *   OLLAMA_MAX_LOADED_MODELS=2    — 7b y 14b calientes sin recargarse
 *   OLLAMA_KEEP_ALIVE=2h          — no descarga modelos entre llamadas
 *
 * Idempotente: si el servidor ya responde, no toca nada. Procesos-ocultos:
 * spawn directo del binario con windowsHide + detached + unref (cero ventanas).
 *
 *   npm run ollama:serve
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const OLLAMA_URL = 'http://127.0.0.1:11434';

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findOllamaExe(): string {
  const candidates = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    process.env.USERPROFILE && join(process.env.USERPROFILE, 'scoop', 'shims', 'ollama.exe'),
  ].filter((p): p is string => Boolean(p && existsSync(p)));
  if (candidates.length === 0) return '';
  return candidates[0];
}

/**
 * Idempotente: si el servidor ya responde, no toca nada; si no, lo levanta
 * oculto con el runtime optimizado y espera hasta 30s. Devuelve el estado.
 */
export async function ensureOllamaUp(): Promise<{ up: boolean; started: boolean }> {
  if (await serverUp()) return { up: true, started: false };
  const exe = findOllamaExe();
  if (!exe) return { up: false, started: false };
  const child = spawn(exe, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_IGPU_ENABLE: '1',
      OLLAMA_MAX_LOADED_MODELS: '2',
      OLLAMA_KEEP_ALIVE: '2h',
    },
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await serverUp()) return { up: true, started: true };
  }
  return { up: false, started: true };
}

async function main(): Promise<number> {
  const { up, started } = await ensureOllamaUp();
  if (up) {
    process.stdout.write(
      started
        ? 'ollama-serve: servidor arriba con IGPU + 2 modelos calientes + keep-alive 2h.\n'
        : 'ollama-serve: el servidor ya responde en 127.0.0.1:11434 (nada que hacer).\n'
    );
    return 0;
  }
  process.stderr.write('ollama-serve: el servidor no respondio en 30s.\n');
  return 1;
}

// Solo como CLI directo: al importarlo (harness-weekly), no arranca el server
// ni mata el proceso.
const invoked = ['ollama-serve.ts', 'ollama-serve.js'].includes(process.argv[1]?.split(/[\\/]/).pop() ?? '');
if (invoked) {
  process.exit(await main());
}
