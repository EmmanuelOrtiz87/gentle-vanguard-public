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
const FLASH_IMAGES = [
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'conhost.exe',
  'WindowsTerminal.exe',
  'OpenConsole.exe',
];

/**
 * Imagenes que se sondearon (pid/padre/ventana). `conhost` queda afuera: es el
 * host de consola y aparece por cada sonda propia — sondearlo realimentaba el
 * lazo (233 PowerShell + 1035 conhost medidos en 150 s, 2026-11-26). La ventana
 * visible de una consola la reporta WindowsTerminal/OpenConsole o el propio app.
 */
const PROBE_IMAGES = new Set([
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'windowsterminal.exe',
  'openconsole.exe',
]);

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
  const clean = (cell: string | undefined): string => (cell ?? '').replace(/^"+|"+$/g, '').trim();
  for (const line of csv.split('\n')) {
    const cells = line.split('","').map(clean);
    if (cells.length < 9 || !/^\d+$/.test(cells[1])) continue;
    // POR QUE (2026-11-26): cells[8] conservaba la comilla de cierre (`N/D"`) y
    // NO_WINDOW_TITLES no matcheaba — toda consola oculta se registraba como
    // ventana visible. Limpiar la celda es lo que separa flash real de ruido.
    const title = clean(cells[8]);
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

interface FlashProcess {
  image: string;
  pid: number;
}

function listFlashProcesses(): { rows: FlashProcess[]; ok: boolean; detail: string } {
  // `tasklist /v` (que trae el título de ventana) se cuelga por completo en
  // esta máquina (medido 2026-11-26: >15 s y ETIMEDOUT cada poll). Eso dejó los
  // archivos del incidente de las 10:38 vacíos, indistinguibles de "sin
  // flashes". Por eso el listado usa la variante simple (~1 s) y la ventana se
  // sondea aparte, solo para los PIDs nuevos.
  const r = spawnSync('tasklist', ['/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  const raw = r.stdout ?? '';
  const ok = !r.error && raw.trim().length > 0;
  const detail = r.error ? String(r.error.message) : (r.signal ?? '');
  const flash = new Set(FLASH_IMAGES.map((i) => i.toLowerCase()));
  const rows: FlashProcess[] = [];
  for (const line of raw.split('\n')) {
    const cells = line.split('","').map((c) => c.replace(/^"+|"+$/g, '').trim());
    if (cells.length < 2 || !/^\d+$/.test(cells[1])) continue;
    const image = cells[0].toLowerCase();
    if (flash.has(image)) rows.push({ image, pid: Number(cells[1]) });
  }
  return { rows, ok, detail };
}

interface ProbeResult {
  ppid: number | null;
  parentName: string | null;
  commandLine: string | null;
  windowTitle: string | null;
  visible: boolean;
}

/**
 * Sondea en UNA invocación de PowerShell todos los pids nuevos. Antes se
 * lanzaban 3 PowerShell por proceso, cada uno con su consola: esas consolas
 * aparecían como "nuevas" en el poll siguiente y el watcher se sondeaba a sí
 * mismo sin fin. Una invocación por lote y sin sondear `conhost` rompe el lazo.
 */
function probeBatch(pids: number[]): Map<number, ProbeResult> {
  const out = new Map<number, ProbeResult>();
  if (pids.length === 0) return out;
  const filter = pids.map((p) => `ProcessId=${p}`).join(' or ');
  const script =
    `$ps = Get-CimInstance Win32_Process -Filter "${filter}" -ErrorAction SilentlyContinue; ` +
    `$pp = @($ps.ParentProcessId | Sort-Object -Unique); ` +
    `$par = if ($pp.Count -gt 0) { Get-CimInstance Win32_Process -Filter (($pp | ForEach-Object { "ProcessId=$_" }) -join ' or ') -ErrorAction SilentlyContinue } else { @() }; ` +
    `foreach ($p in $ps) { $g = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; ` +
    `$h = 0; $t = ''; if ($g) { $h = [int64]$g.MainWindowHandle; $t = [string]$g.MainWindowTitle } ` +
    `$t = $t -replace '[\\r\\n]+', ' '; ` +
    `$pn = ($par | Where-Object { $_.ProcessId -eq $p.ParentProcessId }).Name | Select-Object -First 1; ` +
    `[pscustomobject]@{ pid = $p.ProcessId; ppid = $p.ParentProcessId; parentName = [string]$pn; ` +
    `cmd = [string]$p.CommandLine; hwnd = $h; title = $t } | ConvertTo-Json -Compress }`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  });
  for (const line of (r.stdout ?? '').split('\n')) {
    const raw = line.trim();
    if (!raw.startsWith('{')) continue;
    try {
      const o = JSON.parse(raw) as {
        pid: number;
        ppid: number;
        parentName: string;
        cmd: string;
        hwnd: number;
        title: string;
      };
      out.set(Number(o.pid), {
        ppid: Number(o.ppid) > 0 ? Number(o.ppid) : null,
        parentName: o.parentName || null,
        commandLine: o.cmd || null,
        windowTitle: o.title || null,
        visible: Number(o.hwnd) !== 0,
      });
    } catch {
      /* línea corrupta: la evidencia vale menos que el watcher vivo */
    }
  }
  return out;
}

export function runWatcher(
  durationSec: number,
  outFile?: string,
): { file: string; events: FlashEvent[]; conhostSightings: number; probeCalls: number } {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = outFile ?? resolve(RUNTIME_DIR, `console-flash-${stamp}.jsonl`);
  writeFileSync(file, '', 'utf8');
  const self = selfPidTree();
  const seen = new Set<number>(self);
  const events: FlashEvent[] = [];
  const pending: FlashProcess[] = [];
  let conhostSightings = 0;
  // Auto-aserción de ruido: cuántas invocaciones propias lanzó el observador.
  // Un observador que abre consolas contamina lo que mide (tormenta 2026-11-26:
  // 233 PowerShell en 150 s); este número tiene que quedar cerca de cero.
  let probeCalls = 0;
  const deadline = Date.now() + durationSec * 1_000;
  let pollFailed = false;
  while (Date.now() < deadline) {
    const poll = listFlashProcesses();
    if (!poll.ok && !pollFailed) {
      pollFailed = true;
      appendFileSync(
        file,
        JSON.stringify({
          ts: new Date().toISOString(),
          error: 'tasklist-failed',
          detail: poll.detail,
        }) + '\n',
        'utf8',
      );
    } else if (poll.ok) {
      pollFailed = false;
    }
    for (const row of poll.rows) {
      if (seen.has(row.pid)) continue;
      seen.add(row.pid);
      if (!PROBE_IMAGES.has(row.image)) {
        // conhost: host de consola que aparece por cada consola propia. Se
        // cuenta como ruido de fondo, no se registra ni se sondea.
        conhostSightings++;
        continue;
      }
      pending.push(row);
    }
    if (pending.length > 0) {
      probeCalls++;
      const probed = probeBatch(pending.map((r) => r.pid));
      for (const row of pending) {
        const d = probed.get(row.pid);
        // Los PowerShell de la sonda son hijos directos de este watcher: si se
        // registraran, el observador se observaría a sí mismo.
        if (d && d.ppid === process.pid) continue;
        const ev: FlashEvent = {
          ts: new Date().toISOString(),
          image: row.image,
          pid: row.pid,
          ppid: d?.ppid ?? null,
          parentName: d?.parentName ?? null,
          commandLine: d?.commandLine ?? null,
          windowTitle: d?.windowTitle ?? null,
          visible: d?.visible ?? false,
        };
        events.push(ev);
        appendFileSync(file, JSON.stringify(ev) + '\n', 'utf8');
      }
      pending.length = 0;
    }
    const wait = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    if (wait === 'timed-out') continue;
    break;
  }
  return { file, events, conhostSightings, probeCalls };
}

function main(argv: string[]): number {
  const idx = argv.indexOf('--duration');
  const duration = idx >= 0 ? Number(argv[idx + 1]) || 150 : 150;
  const includeHidden = argv.includes('--all');
  const { file, events, conhostSightings, probeCalls } = runWatcher(duration);
  const visible = events.filter((e) => e.visible);
  const hidden = events.length - visible.length;
  const shown = includeHidden ? events : visible;
  process.stdout.write(
    `console-flash-watch: ${visible.length} ventana(s) VISIBLE(S) + ${hidden} proceso(s) de consola registrado(s) + ${conhostSightings} conhost de ruido + ${probeCalls} sondas propias en ${duration}s → ${file}\n` +
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
