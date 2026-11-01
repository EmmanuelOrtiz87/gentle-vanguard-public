#!/usr/bin/env node
/**
 * RTK Gain Collector — integra el ahorro de tokens de rtk al tracking del stack.
 *
 * rtk (Apache-2.0, absorbido 2026-10-30) comprime la salida de comandos
 * frecuentes antes de que entre al contexto del LLM. Este colector:
 *   1. consulta `rtk gain --format json` (contadores CUMULATIVOS globales),
 *   2. calcula el delta contra el último snapshot,
 *   3. persiste el historial diario en .session/metrics/rtk-gain.json.
 *
 * Uso:
 *   npx tsx src/tokens/rtk-gain.ts            # snapshot + resumen
 *   npx tsx src/tokens/rtk-gain.ts --json     # salida JSON
 *   npx tsx src/tokens/rtk-gain.ts --reset    # re-basa el snapshot en el valor actual
 *
 * Nota: rtk NO se usa como hook global (norma AGENTS.md, procesos-ocultos):
 * el ahorro refleja solo los comandos corridos vía `rtk <cmd>` explícito.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'node:module';
import { runSync } from '../core/run-command.js';
import { getLocalDayKey } from './local-day.js';

const ROOT = path.resolve(process.cwd());
const STORE = path.join(ROOT, '.session', 'metrics', 'rtk-gain.json');

interface RtkSummary {
  total_commands: number;
  total_input: number;
  total_output: number;
  total_saved: number;
  avg_savings_pct: number;
  total_time_ms: number;
  avg_time_ms?: number;
  oversized_excluded: number;
}

interface GainEntry {
  day: string;
  commands: number;
  savedTokens: number;
  savingsPct: number;
  recordedAt: string;
}

interface GainStore {
  version: 1;
  baseline: { commands: number; saved: number };
  dayBaseline?: { day: string; commands: number; saved: number };
  history: GainEntry[];
}

function loadStore(): GainStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, 'utf-8')) as GainStore;
    if (parsed?.version === 1 && parsed.baseline) return parsed;
  } catch { /* primera corrida */ }
  return { version: 1, baseline: { commands: 0, saved: 0 }, history: [] };
}

function collectRtkSummary(): RtkSummary | null {
  const res = runSync('rtk', ['gain', '--format', 'json'], { timeout: 15_000 });
  if (res.status !== 0 || !res.stdout.trim()) {
    console.error('[rtk-gain] rtk no disponible o sin datos:', res.stderr.trim() || res.error?.message || `exit ${res.status}`);
    return null;
  }
  try {
    const parsed = JSON.parse(res.stdout.trim()) as { summary?: RtkSummary };
    return parsed.summary ?? null;
  } catch (err) {
    console.error('[rtk-gain] salida no-JSON de rtk gain:', err instanceof Error ? err.message : err);
    return null;
  }
}

function main(): void {
  const json = process.argv.includes('--json');
  const reset = process.argv.includes('--reset');
  const summary = collectRtkSummary();
  if (!summary) process.exit(1);

  const store = loadStore();
  const today = getLocalDayKey();

  if (reset) {
    store.baseline = { commands: summary.total_commands, saved: summary.total_saved };
    store.dayBaseline = { day: today, commands: summary.total_commands, saved: summary.total_saved };
  }

  // Delta contra el baseline del día (rtk gain es cumulativo global).
  const dayBase = store.dayBaseline?.day === today
    ? store.dayBaseline
    : { day: today, commands: summary.total_commands, saved: summary.total_saved };
  const deltaCommands = Math.max(0, summary.total_commands - dayBase.commands);
  const deltaSaved = Math.max(0, summary.total_saved - dayBase.saved);
  const pct = summary.total_input > 0
    ? Math.round((summary.total_saved / summary.total_input) * 1000) / 10
    : 0;

  if (deltaCommands > 0 || deltaSaved > 0) {
    const entry: GainEntry = {
      day: today,
      commands: deltaCommands,
      savedTokens: deltaSaved,
      savingsPct: pct,
      recordedAt: new Date().toISOString(),
    };
    const last = store.history[store.history.length - 1];
    if (last && last.day === today) Object.assign(last, entry);
    else store.history.push(entry);
    if (store.history.length > 180) store.history = store.history.slice(-180);
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');
  }
  store.dayBaseline = { day: today, commands: summary.total_commands, saved: summary.total_saved };
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');

  // Ingesta en Nexus (token_savings, tenant gentle-vanguard): la métrica queda
  // disponible para token:efficiency y el dashboard de observabilidad.
  if (deltaSaved > 0) {
    try {
      const Database = createRequire(import.meta.url)('better-sqlite3');
      const nexus = new Database(path.join(ROOT, '.runtime', 'gentle-vanguard.db'));
      nexus.prepare(
        `INSERT INTO token_savings (message_id, session_id, category, saved_tokens, source, created_at, tenant_id)
         VALUES (?, NULL, 'tool-compression', ?, 'rtk', ?, 'gentle-vanguard')`,
      ).run(`rtk-${today}-${summary.total_commands}`, deltaSaved, new Date().toISOString());
      nexus.close();
      if (!json) console.log(`  nexus: +${deltaSaved} tokens (tool-compression/rtk)`);
    } catch (err) {
      if (!json) console.log(`  nexus: ingesta omitida (${err instanceof Error ? err.message.slice(0, 60) : err})`);
    }
  }

  const payload = {
    snapshot: { commands: summary.total_commands, savedTokens: summary.total_saved, savingsPct: pct, avgTimeMs: summary.avg_time_ms ?? Math.round(summary.total_time_ms / Math.max(1, summary.total_commands)) },
    today: store.history.find((h) => h.day === today) ?? null,
    historyDays: store.history.length,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('[rtk-gain] snapshot rtk guardado en .session/metrics/rtk-gain.json');
    console.log(`  comandos rtk: ${summary.total_commands} · tokens ahorrados (cumulativo): ${summary.total_saved} · ahorro: ${pct}%`);
  }
}

main();
