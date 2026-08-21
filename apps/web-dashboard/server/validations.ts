import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { ROOT, readJson } from './shared.ts';
import { getProcessExecutionTimeouts } from '@gentle-vanguard/core/timeout-config';
import { runSync } from '@gentle-vanguard/core/run-command';

const TOKEN_PATH = join(ROOT, '.runtime', 'metrics', 'token.json');
const SESSIONS_PATH = join(ROOT, '.runtime', 'metrics', 'sessions.json');
const SESSIONS_HISTORY_PATH = join(ROOT, '.event-bus', 'sessions-history.json');
function execGit(args: string): string {
  try {
    const result = runSync('git', args.split(' '), {
      cwd: ROOT,
      timeout: getProcessExecutionTimeouts().git_operation_ms ?? 3000,
    });
    return result.stdout?.trim() ?? '';
  } catch {
    return '';
  }
}

export interface Validation {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  value?: string | number;
}

export function runValidations(
  bridgeReady: boolean,
  bridgeTools: number,
  wsClients: number,
): Validation[] {
  const results: Validation[] = [];

  // MCP Bridge
  results.push({
    name: 'MCP Bridge',
    status: bridgeReady ? 'ok' : 'error',
    message: bridgeReady ? `${bridgeTools} tools disponibles` : 'Bridge desconectado',
    value: bridgeTools,
  });

  // Token Budget
  const tokenFile = readJson<{ usedToday?: number; budget?: number; pct?: number }>(TOKEN_PATH);
  if (tokenFile && tokenFile.budget && tokenFile.budget > 0) {
    const pct = tokenFile.pct ?? ((tokenFile.usedToday ?? 0) / tokenFile.budget) * 100;
    const status = pct > 80 ? 'warn' : 'ok';
    results.push({
      name: 'Token Budget',
      status: pct > 90 ? 'error' : status,
      message: `${pct.toFixed(1)}% usado (${(tokenFile.usedToday ?? 0).toLocaleString()} / ${tokenFile.budget.toLocaleString()})`,
      value: Math.round(pct),
    });
  } else {
    results.push({ name: 'Token Budget', status: 'warn', message: 'Sin datos de budget' });
  }

  // Sesiones colgadas
  try {
    const sessionsFile = readJson<{ active?: number; latestStatus?: string }>(SESSIONS_PATH);
    const sessionsHistory =
      readJson<Array<{ id: string; status: string; updatedAt: string }>>(SESSIONS_HISTORY_PATH) ||
      [];
    const staleSessions = sessionsHistory.filter((s) => {
      if (s.status !== 'active' && s.status !== 'awaiting_input') return false;
      const updated = new Date(s.updatedAt).getTime();
      return Date.now() - updated > 7200000;
    });
    results.push({
      name: 'Sesiones',
      status: staleSessions.length > 0 ? 'warn' : 'ok',
      message:
        staleSessions.length > 0
          ? `${staleSessions.length} colgada(s) (>2h)`
          : `${sessionsFile?.active ?? 0} activa(s), sin colgadas`,
      value: sessionsFile?.active ?? 0,
    });
  } catch {
    results.push({ name: 'Sesiones', status: 'warn', message: 'Sin datos' });
  }

  // Git status
  try {
    const porcelain = execGit('status --porcelain');
    const unpushed = execGit('cherry -v');
    const unpushedCount = unpushed ? unpushed.split('\n').filter(Boolean).length : 0;
    const hasUncommitted = porcelain ? porcelain.split('\n').filter(Boolean).length > 0 : false;
    if (unpushedCount > 0 || hasUncommitted) {
      results.push({
        name: 'Git',
        status: 'warn',
        message: [
          hasUncommitted ? 'archivos sin commit' : '',
          unpushedCount > 0 ? `${unpushedCount} commit(s) sin pushear` : '',
        ]
          .filter(Boolean)
          .join(', '),
        value: unpushedCount,
      });
    } else {
      results.push({ name: 'Git', status: 'ok', message: 'Working tree limpio' });
    }
  } catch {
    results.push({ name: 'Git', status: 'warn', message: 'No es repo git' });
  }

  // Data freshness
  try {
    if (existsSync(TOKEN_PATH)) {
      const mtime = statSync(TOKEN_PATH).mtimeMs;
      const minutesAgo = Math.round((Date.now() - mtime) / 60000);
      results.push({
        name: 'Data Freshness',
        status: minutesAgo < 60 ? 'ok' : minutesAgo < 1440 ? 'warn' : 'error',
        message: `token.json actualizado hace ${minutesAgo} min`,
      });
    } else {
      results.push({ name: 'Data Freshness', status: 'warn', message: 'token.json no encontrado' });
    }
  } catch {
    results.push({ name: 'Data Freshness', status: 'error', message: 'Error leyendo timestamp' });
  }

  // WebSocket clients
  results.push({
    name: 'WebSocket',
    status: wsClients > 0 ? 'ok' : 'warn',
    message: `${wsClients} cliente(s) conectado(s)`,
    value: wsClients,
  });

  return results;
}
