/**
 * console-flash-watch — observador pasivo de flashes de consola (procesos-ocultos).
 *
 * Incidente 2026-11-21 (owner): al iniciar sesión en ZCode se abrieron ventanas
 * cmd transitorias. La auditoría estática de TODA la cadena de autostart (135
 * scripts, 12 spawns detached, binarios externos, delegación, probe MCP) muestra
 * windowsHide:true en todos los call sites, y `hidden-spawns` del watchtower da
 * PASS — el flash viene de un nieto FUERA del alcance auditable (host ZCode,
 * shims .cmd, hijos internos de ollama). No se arregla lo que no se atribuye:
 * este observador captura la EVIDENCIA (pid, padre, commandLine) de cada
 * cmd.exe/conhost.exe/WindowsTerminal.exe que aparezca mientras corre.
 *
 * Pasivo: escribe `.runtime/console-flash-<ts>.jsonl` y se auto-exita tras la
 * duración. NUNCA mata ni modifica procesos (solo observa — la clase del
 * incidente uncommitted-actor-inventory: clasificar, no actuar).
 *
 * Uso:
 *   node --import tsx src/ops/console-flash-watch.ts [--duration 150]
 *   npm run windows:flash-watch -- [--duration 150]
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RUNTIME_DIR = resolve(ROOT, '.runtime');

/** Imagenes cuya aparición transitoria es un flash de consola. */
const FLASH_IMAGES = ['cmd.exe', 'conhost.exe', 'WindowsTerminal.exe'];

export interface FlashEvent {
  ts: string;
  image: string;
  pid: number;
  ppid: number | null;
  parentName: string | null;
  commandLine: string | null;
  /** Título de ventana reportado por `tasklist /v` ("N/D" = consola oculta). */
  windowTitle: string | null;
  /** true solo si hay ventana de consola con título: lo que el owner VE. */
  visible: boolean;
}

/** Parsea la salida CSV de tasklist → lista de pids por imagen. (Puro.) */
export function parseTasklist(csv: string): number[] {
  const pids: number[] = [];
  for (const line of csv.split('\n')) {
    const cells = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
    if (cells.length >= 2 && /^\d+$/.test(cells[1])) pids.push(Number(cells[1]));
  }
  return pids;
}

/**
 * Parsea `tasklist /v /fo csv` → imagen, pid y título de ventana. (Puro.)
 *
 * POR QUE (2026-11-24): la corrida anterior registraba TODO conhost/cmd del
 * sistema (114 eventos en 150s) y no distinguía una ventana visible de una
 * consola oculta (CREATE_NO_WINDOW / conhost headless). El owner ve flashes,
 * no procesos: la columna "Título de ventana" de tasklist /v marca "N/D"
 * (N/A en inglés) para consolas sin ventana y el título real para las visibles.
 */
export interface TasklistRow {
  image: string;
  pid: number;
  windowTitle: string | null;
  visible: boolean;
}

const NO_WINDOW_TITLES = new Set(['n/d', 'n/a', '']);

export function parseTasklistVerbose(csv: string): TasklistRow[] {
  const rows: TasklistRow[] = [];
  for (const line of csv.split('\n')) {
    const cells = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
    if (cells.length < 9 || !/^\d+$/.test(cells[1])) continue;
    const title = cells[8]?.trim() ?? '';
    rows.push({
      image: cells[0]?.toLowerCase() ?? '',
      pid: Number(cells[1]),
      windowTitle: title || null,
      visible: !NO_WINDOW_TITLES.has(title.toLowerCase()),
    });
  }
  return rows;
}

/** El pid que se auto-excluye: este watcher y su cadena no son flash. */
export function selfPidTree(): Set<number> {
  const tree = new Set<number>();
  let pid: number | null = process.pid;
  while (pid !== null && !tree.has(pid)) {
    tree.add(pid);
    const r: import('node:child_process').SpawnSyncReturns<string> = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 5_000 },
    );
    const p: number = Number(r.stdout?.trim());
    pid = Number.isFinite(p) && p > 0 ? p : null;
  }
  return tree;
}

function listFlashWindows(): TasklistRow[] {
  const r = spawnSync('tasklist', ['/v', '/fo', 'csv'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  });
  const flash = new Set(FLASH_IMAGES.map((i) => i.toLowerCase()));
  return parseTasklistVerbose(r.stdout ?? '').filter((row) => flash.has(row.image));
}

function probeDetails(pid: number): {
  ppid: number | null;
  parentName: string | null;
  commandLine: string | null;
} {
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; ` +
        `if ($p) { "$($p.ParentProcessId)|$($p.CommandLine)" }`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 8_000 },
  );
  const line = (r.stdout ?? '').trim();
  const sep = line.indexOf('|');
  if (sep < 0) return { ppid: null, parentName: null, commandLine: line || null };
  const ppid = Number(line.slice(0, sep));
  const commandLine = line.slice(sep + 1);
  let parentName: string | null = null;
  if (Number.isFinite(ppid) && ppid > 0) {
    const pr = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${ppid}"; if ($p) { $p.Name }`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8_000 },
    );
    parentName = (pr.stdout ?? '').trim() || null;
  }
  return {
    ppid: Number.isFinite(ppid) && ppid > 0 ? ppid : null,
    parentName,
    commandLine: commandLine || null,
  };
}

export function runWatcher(
  durationSec: number,
  outFile?: string,
): { file: string; events: FlashEvent[] } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = outFile ?? resolve(RUNTIME_DIR, `console-flash-${stamp}.jsonl`);
  writeFileSync(file, '', 'utf8');
  const self = selfPidTree();
  const seen = new Set<number>(self);
  const events: FlashEvent[] = [];
  const deadline = Date.now() + durationSec * 1_000;
  while (Date.now() < deadline) {
    for (const row of listFlashWindows()) {
      if (seen.has(row.pid)) continue;
      seen.add(row.pid);
      const d = probeDetails(row.pid);
      const ev: FlashEvent = {
        ts: new Date().toISOString(),
        image: row.image,
        pid: row.pid,
        ppid: d.ppid,
        parentName: d.parentName,
        commandLine: d.commandLine,
        windowTitle: row.windowTitle,
        visible: row.visible,
      };
      events.push(ev);
      appendFileSync(file, JSON.stringify(ev) + '\n', 'utf8');
    }
    const wait = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    if (wait === 'timed-out') continue;
    break;
  }
  return { file, events };
}

function main(argv: string[]): number {
  const idx = argv.indexOf('--duration');
  const duration = idx >= 0 ? Number(argv[idx + 1]) || 150 : 150;
  const includeHidden = argv.includes('--all');
  const { file, events } = runWatcher(duration);
  const visible = events.filter((e) => e.visible);
  const hidden = events.length - visible.length;
  const shown = includeHidden ? events : visible;
  process.stdout.write(
    `console-flash-watch: ${visible.length} ventana(s) VISIBLE(S) + ${hidden} consola(s) oculta(s) en ${duration}s → ${file}\n` +
      (visible.length === 0
        ? 'sin flashes visibles: la ventana de observación pasó limpia (consolas ocultas llevan --all)\n'
        : shown
            .map(
              (e) =>
                `  ${e.ts} ${e.image} pid=${e.pid} padre=${e.parentName ?? '?'}(${e.ppid ?? '?'}) titulo="${e.windowTitle ?? ''}" cmd=${(e.commandLine ?? '').slice(0, 90)}`,
            )
            .join('\n') + '\n'),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
