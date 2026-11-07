import { execFile } from 'node:child_process';
import os from 'node:os';

export interface ProcessMetrics {
  status: 'available' | 'unavailable';
  memoryMb: number | null;
  cpuPercent: number | null;
  sampledAt: string;
  history: ProcessMetricPoint[];
}

export interface ProcessMetricPoint {
  sampledAt: string;
  memoryMb: number;
  cpuPercent: number | null;
}

interface Sample {
  cpuSeconds: number;
  sampledAt: number;
}

const samples = new Map<number, Sample>();
const cache = new Map<number, { expiresAt: number; value: ProcessMetrics }>();
const histories = new Map<number, ProcessMetricPoint[]>();
const pending = new Map<number, Promise<ProcessMetrics>>();
const CACHE_MS = 4500;
const HISTORY_LIMIT = 60;

function unavailable(): ProcessMetrics {
  return {
    status: 'unavailable',
    memoryMb: null,
    cpuPercent: null,
    sampledAt: new Date().toISOString(),
    history: [],
  };
}

function appendHistory(pid: number, point: ProcessMetricPoint): ProcessMetricPoint[] {
  const history = histories.get(pid) ?? [];
  history.push(point);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  histories.set(pid, history);
  return history.slice();
}

function runProcessCommand(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', windowsHide: true, timeout: 1500 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

/* Snapshot de TODOS los procesos en UNA llamada de PowerShell, con TTL e
   inflight-dedupe. Antes: 1 spawn de powershell.exe POR PID en cache-miss —
   con ~15 procesos vivos del tablero eran 15 spawns concurrentes cada pocos
   segundos, saturando Windows y degradando cada list() de Command Center
   (medición 2026-11-06: picos de 1-4s por tick). */
interface WinProcSample {
  cpuSeconds: number;
  memoryMb: number;
}
let winSnapshot: { at: number; map: Map<number, WinProcSample> } | null = null;
let winSnapshotInflight: Promise<Map<number, WinProcSample>> | null = null;
const WIN_SNAPSHOT_TTL_MS = 4000;

async function parseWindowsAll(): Promise<Map<number, WinProcSample>> {
  if (winSnapshot && Date.now() - winSnapshot.at < WIN_SNAPSHOT_TTL_MS) return winSnapshot.map;
  if (winSnapshotInflight) return winSnapshotInflight;
  winSnapshotInflight = (async () => {
    const stdout = await runProcessCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-Process | Select-Object Id,CPU,WorkingSet64 | ConvertTo-Json -Compress -Depth 2",
    ]);
    const map = new Map<number, WinProcSample>();
    try {
      const rows = JSON.parse(stdout ?? '[]') as Array<{ Id?: number; CPU?: number; WorkingSet64?: number }>;
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        if (!row || !Number.isFinite(row.Id)) continue;
        map.set(Number(row.Id), {
          cpuSeconds: Number.isFinite(row.CPU) ? Number(row.CPU) : 0,
          memoryMb: Number.isFinite(row.WorkingSet64) ? Math.round(Number(row.WorkingSet64) / 1024 / 1024) : 0,
        });
      }
    } catch {
      /* snapshot vacío: los pids quedan unavailable en esta pasada */
    }
    winSnapshot = { at: Date.now(), map };
    return map;
  })();
  try {
    return await winSnapshotInflight;
  } finally {
    winSnapshotInflight = null;
  }
}

async function parseWindows(pid: number): Promise<{ cpuSeconds: number; memoryMb: number } | null> {
  const snapshot = await parseWindowsAll();
  const sample = snapshot.get(pid);
  if (!sample) return null;
  return { cpuSeconds: sample.cpuSeconds, memoryMb: sample.memoryMb };
}

async function parsePosix(pid: number): Promise<{ cpuPercent: number; memoryMb: number } | null> {
  const stdout = await runProcessCommand('ps', ['-p', String(pid), '-o', '%cpu=,rss=']);
  if (!stdout?.trim()) return null;
  const [cpu, rss] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(cpu) || !Number.isFinite(rss)) return null;
  return { cpuPercent: Math.max(0, cpu), memoryMb: Math.round(rss / 1024) };
}

export async function readProcessMetrics(pid: number, now = Date.now()): Promise<ProcessMetrics> {
  if (!Number.isInteger(pid) || pid <= 0) return unavailable();
  const cached = cache.get(pid);
  if (cached && cached.expiresAt > now) {
    return { ...cached.value, history: (histories.get(pid) ?? []).slice() };
  }
  const inProgress = pending.get(pid);
  if (inProgress) {
    const value = await inProgress;
    return { ...value, history: (histories.get(pid) ?? []).slice() };
  }

  const operation = (async (): Promise<ProcessMetrics> => {
    let value: ProcessMetrics;
    if (process.platform === 'win32') {
      const parsed = await parseWindows(pid);
      if (!parsed) value = unavailable();
      else {
        const previous = samples.get(pid);
        const elapsedSeconds = previous ? Math.max(0.001, (now - previous.sampledAt) / 1000) : 0;
        const cpuPercent = previous
          ? Math.min(
              os.cpus().length * 100,
              Math.max(0, ((parsed.cpuSeconds - previous.cpuSeconds) / elapsedSeconds) * 100),
            )
          : null;
        samples.set(pid, { cpuSeconds: parsed.cpuSeconds, sampledAt: now });
        const sampledAt = new Date(now).toISOString();
        value = {
          status: 'available',
          memoryMb: parsed.memoryMb,
          cpuPercent,
          sampledAt,
          history: appendHistory(pid, { sampledAt, memoryMb: parsed.memoryMb, cpuPercent }),
        };
      }
    } else {
      const parsed = await parsePosix(pid);
      value = parsed
        ? (() => {
            const sampledAt = new Date(now).toISOString();
            return {
              status: 'available' as const,
              memoryMb: parsed.memoryMb,
              cpuPercent: parsed.cpuPercent,
              sampledAt,
              history: appendHistory(pid, {
                sampledAt,
                memoryMb: parsed.memoryMb,
                cpuPercent: parsed.cpuPercent,
              }),
            };
          })()
        : unavailable();
    }
    cache.set(pid, { expiresAt: now + CACHE_MS, value });
    return value;
  })();
  pending.set(pid, operation);
  try {
    return await operation;
  } finally {
    pending.delete(pid);
  }
}

export function readProcessMetricsHistory(pid: number, limit = HISTORY_LIMIT): ProcessMetricPoint[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  return (histories.get(pid) ?? []).slice(-Math.max(1, Math.min(limit, HISTORY_LIMIT)));
}
