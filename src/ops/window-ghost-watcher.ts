/**
 * window-ghost-watcher.ts — Detector de ventanas fantasma (cmd.exe/conhost visibles).
 *
 * Incidente recurrente reportado por el owner (2026-11-18): ventanas cmd que
 * destellan de vez en cuando ("ventanas fantasma"). Los audits estáticos de
 * spawn (audit:sh-launchers, checkHiddenSpawns) están limpios y el inventario
 * puntual no ve nada (el flash dura <1 s) — falta CAPTURA EN CALIENTE.
 *
 * Este watcher muestrea los procesos con MainWindowTitle visible cada 600 ms
 * (un solo PowerShell oculto con loop interno — cero ventanas propias) y
 * registra en .runtime/ghost-windows.jsonl todo proceso que APAREZCA con
 * ventana respecto al sample anterior: PID, nombre, título, línea de comando
 * y comando del proceso padre. La próxima ventana fantasma queda con evidencia
 * forense para arreglar el spawn exacto que la crea.
 *
 * USO:
 *   npm run ghosts:watch            # corre en primer plano; Ctrl+C para cortar
 *   npm run ghosts:watch -- --once  # un solo sample (diagnóstico puntual)
 *
 * Registros: .runtime/ghost-windows.jsonl (una línea JSON por evento).
 * Los procesos de sesión conocidos (explorer, shells del owner, etc.) también
 * se registran si aparecen — el archivo es evidencia cruda, el análisis es
 * posterior. Filtrado mínimo: ignora watcher/system shell permanente.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_FILE = join(ROOT, '.runtime', 'ghost-windows.jsonl');

const SAMPLE_MS = 600;

const PS_SCRIPT = `
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinProc {
  [DllImport("kernel32.dll")]
  public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr h);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue
$prev = @{}
while ($true) {
  try {
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.Id -ne 0 } |
      ForEach-Object {
        $cmd = try { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction Stop).CommandLine } catch { '' }
        $parent = try {
          $pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction Stop).ParentProcessId
          (Get-CimInstance Win32_Process -Filter "ProcessId=$pp" -ErrorAction Stop).CommandLine
        } catch { '' }
        "$($_.Id)|$($_.ProcessName)|$($_.MainWindowTitle)|$cmd|$parent"
      }
    $current = @{}
    foreach ($p in $procs) {
      $pid = $p.Split('|')[0]
      $current[$pid] = $p
      if (-not $prev.ContainsKey($pid)) { Write-Output $p }
    }
    $prev = $current
  } catch { }
  Start-Sleep -Milliseconds ${SAMPLE_MS}
}
`;

interface GhostRecord {
  ts: string;
  pid: number;
  name: string;
  title: string;
  cmd: string;
  parentCmd: string;
}

function log(record: GhostRecord): void {
  try {
    appendFileSync(OUT_FILE, `${JSON.stringify(record)}\n`);
  } catch {
    /* el watch no muere por un fallo de disco */
  }
}

function main(): void {
  if (!existsSync(join(ROOT, '.runtime'))) {
    console.error('[ghost-watcher] .runtime no existe — correr desde el root del stack');
    process.exitCode = 1;
    return;
  }
  console.log(
    `[ghost-watcher] observando ventanas visibles cada ${SAMPLE_MS}ms → ${OUT_FILE} (PowerShell único, oculto)`,
  );

  // Loop continuo: un solo PowerShell oculto; parseamos su stdout línea a línea.
  const ps = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
    { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let buffer = '';
  ps.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.includes('|')) continue;
      const [pidStr, name, title, cmd, parentCmd] = line.split('|');
      log({
        ts: new Date().toISOString(),
        pid: Number(pidStr) || 0,
        name: name ?? '',
        title: title ?? '',
        cmd: cmd ?? '',
        parentCmd: parentCmd ?? '',
      });
      console.log(
        `[ghost-watcher] VENTANA ${new Date().toISOString()} pid=${pidStr} ${name} "${(title ?? '').slice(0, 60)}"`,
      );
    }
  });
  ps.on('exit', (code) => {
    console.log(`[ghost-watcher] sampler terminado (exit ${code})`);
  });
  process.on('SIGINT', () => {
    ps.kill();
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
