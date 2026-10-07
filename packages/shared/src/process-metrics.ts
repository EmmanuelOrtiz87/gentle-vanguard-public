import { spawnSync } from 'node:child_process';
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
const CACHE_MS = 4500;
const HISTORY_LIMIT = 60;

function unavailable(): ProcessMetrics {
  return { status: 'unavailable', memoryMb: null, cpuPercent: null, sampledAt: new Date().toISOString(), history: [] };
}

function appendHistory(pid: number, point: ProcessMetricPoint): ProcessMetricPoint[] {
  const history = histories.get(pid) ?? [];
  history.push(point);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  histories.set(pid, history);
  return history.slice();
}

function parseWindows(pid: number): { cpuSeconds: number; memoryMb: number } | null {
  const command = `$p=Get-Process -Id ${pid} -ErrorAction Stop; [PSCustomObject]@{cpu=$p.CPU;memory=$p.WorkingSet64}|ConvertTo-Json -Compress`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1500,
  });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { cpu?: number; memory?: number };
    if (!Number.isFinite(parsed.cpu) || !Number.isFinite(parsed.memory)) return null;
    return { cpuSeconds: Number(parsed.cpu), memoryMb: Math.round(Number(parsed.memory) / 1024 / 1024) };
  } catch {
    return null;
  }
}

function parsePosix(pid: number): { cpuPercent: number; memoryMb: number } | null {
  const result = spawnSync('ps', ['-p', String(pid), '-o', '%cpu=,rss='], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1500,
  });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  const [cpu, rss] = result.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(cpu) || !Number.isFinite(rss)) return null;
  return { cpuPercent: Math.max(0, cpu), memoryMb: Math.round(rss / 1024) };
}

export function readProcessMetrics(pid: number, now = Date.now()): ProcessMetrics {
  if (!Number.isInteger(pid) || pid <= 0) return unavailable();
  const cached = cache.get(pid);
  if (cached && cached.expiresAt > now) return { ...cached.value, history: (histories.get(pid) ?? []).slice() };

  let value: ProcessMetrics;
  if (process.platform === 'win32') {
    const parsed = parseWindows(pid);
    if (!parsed) value = unavailable();
    else {
      const previous = samples.get(pid);
      const elapsedSeconds = previous ? Math.max(0.001, (now - previous.sampledAt) / 1000) : 0;
      const cpuPercent = previous
        ? Math.min(os.cpus().length * 100, Math.max(0, ((parsed.cpuSeconds - previous.cpuSeconds) / elapsedSeconds) * 100))
        : null;
      samples.set(pid, { cpuSeconds: parsed.cpuSeconds, sampledAt: now });
      const sampledAt = new Date(now).toISOString();
      value = { status: 'available', memoryMb: parsed.memoryMb, cpuPercent, sampledAt, history: appendHistory(pid, { sampledAt, memoryMb: parsed.memoryMb, cpuPercent }) };
    }
  } else {
    const parsed = parsePosix(pid);
    value = parsed
      ? (() => {
          const sampledAt = new Date(now).toISOString();
          return { status: 'available' as const, memoryMb: parsed.memoryMb, cpuPercent: parsed.cpuPercent, sampledAt, history: appendHistory(pid, { sampledAt, memoryMb: parsed.memoryMb, cpuPercent: parsed.cpuPercent }) };
        })()
      : unavailable();
  }
  cache.set(pid, { expiresAt: now + CACHE_MS, value });
  return value;
}

export function readProcessMetricsHistory(pid: number, limit = HISTORY_LIMIT): ProcessMetricPoint[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  return (histories.get(pid) ?? []).slice(-Math.max(1, Math.min(limit, HISTORY_LIMIT)));
}
