/**
 * app-launcher.ts — Módulo compartido para scripts start/stop por app.
 *
 * Reutiliza `createAppsController` del Command Center como única fuente de
 * verdad para la lógica de procesos. No duplica definiciones de puertos ni
 * PIDs — todo viene del registry del CC.
 *
 * Reglas procesos-ocultos: spawn usa node --import tsx directamente, nunca
 * npx tsx, para evitar el proceso-nieto con ventana visible en Windows.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// apps/ está desacoplada (gitignored — ver NORMATIVA-DESIGN-SYSTEM / apps-desacopladas):
// el import del server del Command Center debe ser OPCIONAL para que tsc/CI pasen sin apps/.
// Specifier no-literal => TS no lo resuelve estáticamente; se resuelve en runtime.
const CC_SERVER_MODULE = '../../apps/command-center/server.js';

export type AppId = string;
export interface AppProcessInfo {
  name: string;
  port: number;
  pid: number | null;
  alive: boolean;
}
export interface AppInfo {
  id: AppId;
  name: string;
  url: string;
  status: string;
  processes: AppProcessInfo[];
}
interface AppsController {
  list(): Promise<AppInfo[]>;
  start(id: AppId): Promise<{ status: number; body: unknown }>;
  stop(id: AppId): Promise<{ status: number; body: unknown }>;
}

async function loadController(root: string): Promise<AppsController> {
  try {
    const mod = (await import(CC_SERVER_MODULE)) as {
      createAppsController: (opts: { root: string }) => AppsController;
    };
    return mod.createAppsController({ root });
  } catch {
    throw new Error(
      'Command Center no disponible (apps/command-center/server.ts no encontrado). ' +
        'apps/ está desacoplada del repo — clona/verifica la carpeta apps/ para operar apps.',
    );
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
export const ROOT = resolve(import.meta.dirname, '..', '..'); // gentle-vanguard/

// ---------------------------------------------------------------------------
// Browser open (cross-platform, sin ventana cmd en Windows)
// ---------------------------------------------------------------------------
export function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/d', '/c', 'start', '""', url], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// launchApp — start de una app por ID
// ---------------------------------------------------------------------------
export async function launchApp(id: AppId, opts: { browser?: boolean } = {}): Promise<void> {
  const controller = await loadController(ROOT);
  const browser = opts.browser ?? true;

  console.log(`\n[GV] ▶  Iniciando ${id}…`);

  const result = await controller.start(id);
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    console.error(`[GV] ✗  Error al iniciar ${id}: ${body.error ?? 'desconocido'}`);
    process.exit(1);
  }

  const info = result.body as AppInfo;

  // Si retornó running directamente, estaba ya corriendo o recién levantó.
  // Hacemos un wait extra para asegurar readiness del puerto.
  if (info.status !== 'running') {
    // Volvemos a inspeccionar hasta que esté running o timeout
    const controller2 = await loadController(ROOT);
    let latest = info;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const check = await controller2.start(id);
      latest = check.body as AppInfo;
      if (latest.status === 'running') break;
      await new Promise((r) => setTimeout(r, 600));
    }

    if (latest.status !== 'running') {
      console.warn(`[GV] ⚠  ${id} arrancó pero no todos los procesos respondieron:`);
      for (const p of latest.processes) {
        console.warn(`       ${p.name} :${p.port}  ${p.alive ? '✓' : '✗'}`);
      }
    }
  }

  // Estado final
  const finalController = await loadController(ROOT);
  const finalList = await finalController.list();
  const finalApp = finalList.find((a) => a.id === id) ?? info;

  console.log(`\n[GV] Estado final — ${finalApp.name}:`);
  for (const p of finalApp.processes) {
    const icon = p.alive ? '✓' : '✗';
    console.log(`     ${icon} ${p.name.padEnd(8)} :${p.port}${p.pid ? `  (PID ${p.pid})` : ''}`);
  }

  if (finalApp.status === 'running' || finalApp.status === 'partial') {
    console.log(`\n[GV] 🌐 URL: ${finalApp.url}`);
    if (browser && (finalApp.status === 'running' || finalApp.processes.some((p) => p.alive))) {
      // Pequeña pausa para que Vite termine de inicializar el HMR antes de abrir
      await new Promise((r) => setTimeout(r, 1200));
      openBrowser(finalApp.url);
      console.log(`[GV] ✓  Navegador abierto en ${finalApp.url}`);
    }
  } else {
    console.error(`[GV] ✗  ${id} no pudo iniciarse. Verificá los logs.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// stopApp — stop de una app por ID
// ---------------------------------------------------------------------------
export async function stopApp(id: AppId): Promise<void> {
  const controller = await loadController(ROOT);

  console.log(`\n[GV] ■  Deteniendo ${id}…`);

  // Inspección previa
  const list = await controller.list();
  const before = list.find((a) => a.id === id);
  if (!before || before.status === 'stopped') {
    console.log(`[GV] ✓  ${id} ya estaba detenido.`);
    return;
  }

  const result = await controller.stop(id);
  if (result.status >= 400) {
    const body = result.body as { error?: string };
    console.error(`[GV] ✗  Error al detener ${id}: ${body.error ?? 'desconocido'}`);
    process.exit(1);
  }

  const after = result.body as AppInfo;

  console.log(`\n[GV] Estado final — ${after.name}:`);
  for (const p of after.processes) {
    const icon = p.alive ? '⚠' : '✓';
    console.log(
      `     ${icon} ${p.name.padEnd(8)} :${p.port}  ${p.alive ? 'aún activo' : 'detenido'}`,
    );
  }

  if (after.status === 'stopped') {
    console.log(`\n[GV] ✓  ${id} detenido correctamente.`);
  } else {
    console.warn(`\n[GV] ⚠  Algunos procesos de ${id} siguen activos. Podés re-ejecutar stop.`);
  }
}
