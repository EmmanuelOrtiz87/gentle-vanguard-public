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

function listFlashPids(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const image of FLASH_IMAGES) {
    const r = spawnSync('tasklist', ['/fo', 'csv', '/fi', `IMAGENAME eq ${image}`], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8_000,
    });
    out.set(image.toLowerCase(), parseTasklist(r.stdout ?? ''));
  }
  return out;
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
    for (const [image, pids] of listFlashPids()) {
      for (const pid of pids) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const d = probeDetails(pid);
        const ev: FlashEvent = {
          ts: new Date().toISOString(),
          image,
          pid,
          ppid: d.ppid,
          parentName: d.parentName,
          commandLine: d.commandLine,
        };
        events.push(ev);
        appendFileSync(file, JSON.stringify(ev) + '\n', 'utf8');
      }
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
  const { file, events } = runWatcher(duration);
  process.stdout.write(
    `console-flash-watch: ${events.length} aparicion(es) registradas en ${duration}s → ${file}\n` +
      (events.length === 0
        ? 'sin flashes: la ventana de observación pasó limpia\n'
        : events
            .map(
              (e) =>
                `  ${e.ts} ${e.image} pid=${e.pid} padre=${e.parentName ?? '?'}(${e.ppid ?? '?'}) cmd=${(e.commandLine ?? '').slice(0, 90)}`,
            )
            .join('\n') + '\n'),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
