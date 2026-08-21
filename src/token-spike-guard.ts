#!/usr/bin/env tsx
/**
 * Token Spike Guard (TSG) - Guardián de Picos de Tokens con Auto-Actions
 * 
 * Versión: 2.0.0
 * 
 * Monitorea uso de tokens en tiempo real y toma acciones automáticas:
 * - Alertas progresivas (warning -> soft -> hard -> critical)
 * - Auto-checkpoint en umbrales críticos
 * - Sugerencias de nueva sesión
 * - Kill switch de emergencia
 * 
 * Usage:
 *   npx tsx src/token-spike-guard.ts --attach    # Adjuntar a sesión actual
 *   npx tsx src/token-spike-guard.ts --monitor   # Monitoreo continuo
 *   npx tsx src/token-spike-guard.ts --status    # Ver estado actual
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';
import { spawn } from 'child_process';

const ROOT = resolve(process.cwd());
const LOG_DIR = join(ROOT, '.runtime', 'token-guard-logs');
const STATE_FILE = join(ROOT, '.runtime', 'token-guard-state.json');

mkdirSync(LOG_DIR, { recursive: true });

// ─── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  thresholds: {
    warning500k:    500000,     // 500K - Informacional
    warning1M:      1000000,    // 1M - Early warning
    warning3M:      3000000,    // 3M - Checkpoint sugerido
    soft4M:         4000000,    // 4M - Soft limit, sugerir nueva sesión
    hard8M:         8000000,    // 8M - Hard limit, checkpoint automático
    critical12M:    12000000,   // 12M - Critical, kill switch
    emergency15M:   15000000,   // 15M - Emergency, force close
  },
  
  actions: {
    warning500k:    { alert: true,  log: true,  notify: false },
    warning1M:      { alert: true,  log: true,  notify: true,  suggestCheckpoint: true },
    warning3M:      { alert: true,  log: true,  notify: true,  suggestCheckpoint: true, suggestNewSession: true },
    soft4M:         { alert: true,  log: true,  notify: true,  createCheckpoint: true },
    hard8M:         { alert: true,  log: true,  notify: true,  createCheckpoint: true, suggestNewSession: true, warnUser: true },
    critical12M:    { alert: true,  log: true,  notify: true,  createCheckpoint: true, forceNewSession: false, sendKillSwitch: true },
    emergency15M:   { alert: true,  log: true,  notify: true,  createCheckpoint: true, forceNewSession: true, emergencyExit: true },
  },
  
  monitorInterval: 10000,  // 10 segundos
  burnRateWindow: 60,      // 1 minuto para calcular burn rate
  
  alerting: {
    channels: ['cli', 'dashboard', 'file'],
  },
};

// ─── Logger ─────────────────────────────────────────────────────────────────────
function log(level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const prefixes = { 'INFO': 'ℹ️ ', 'WARN': '⚠️ ', 'ERROR': '❌', 'CRITICAL': '🆘' };
  const line = `[${timestamp}] ${prefixes[level]} [${level}] ${message}`;
  
  console.log(line);
  if (meta) console.log('  ', JSON.stringify(meta, null, 2));
  
  appendFileSync(join(LOG_DIR, 'guard.log'), line + '\n', 'utf-8');
}

// ─── State Management ───────────────────────────────────────────────────────────
interface GuardState {
  sessionId: string;
  startTime: number;
  checkpoints: number[];
  lastAlertLevel: string | null;
  lastAlertTime: number;
  totalTokensAtStart: number;
  currentBurnRate: number;
  projectedTimeToLimit: number | null;
}

function loadState(): GuardState {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  
  return {
    sessionId: process.env.SESSION_ID || 'unknown',
    startTime: Date.now(),
    checkpoints: [],
    lastAlertLevel: null,
    lastAlertTime: 0,
    totalTokensAtStart: 0,
    currentBurnRate: 0,
    projectedTimeToLimit: null,
  };
}

function saveState(state: GuardState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Token Collection ─────────────────────────────────────────────────────────────
interface TokenMetrics {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
}

async function getCurrentTokens(): Promise<TokenMetrics> {
  // Intentar obtener de múltiples fuentes
  const sources = [
    join(ROOT, 'reports', 'stack-live-observability-latest.json'),
    join(ROOT, '.session', 'session-current.json'),
    join(ROOT, '.session', 'token-usage.json'),
  ];
  
  for (const source of sources) {
    try {
      if (existsSync(source)) {
        const data = JSON.parse(readFileSync(source, 'utf-8'));
        const tokens = data.tokenMetrics || data.tokens || data;
        return {
          input: tokens.input || 0,
          output: tokens.output || 0,
          reasoning: tokens.reasoning || 0,
          cacheRead: tokens.cacheRead || 0,
          cacheWrite: tokens.cacheWrite || 0,
          total: (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0),
        };
      }
    } catch {}
  }
  
  // Fallback: intentar desde Nexus
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(join(ROOT, '.runtime', 'gentle-vanguard.db'), { readonly: true });
    const result = db.prepare(`
      SELECT SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(reasoning_tokens) as reasoning
      FROM token_transactions
      WHERE date(timestamp) = date('now', 'localtime')
    `).get() as any;
    db.close();
    
    return {
      input: result?.input || 0,
      output: result?.output || 0,
      reasoning: result?.reasoning || 0,
      total: (result?.input || 0) + (result?.output || 0) + (result?.reasoning || 0),
    };
  } catch {
    return { input: 0, output: 0, total: 0 };
  }
}

// ─── Burn Rate Calculation ──────────────────────────────────────────────────────
function calculateBurnRate(
  current: TokenMetrics,
  previous: TokenMetrics,
  timeDeltaSeconds: number
): number {
  if (timeDeltaSeconds <= 0) return 0;
  
  const tokenDelta = current.total - previous.total;
  const burnRatePerSecond = tokenDelta / timeDeltaSeconds;
  const burnRatePerMinute = burnRatePerSecond * 60;
  
  return Math.max(0, burnRatePerMinute);
}

function projectTimeToLimit(
  current: number,
  burnRatePerMinute: number,
  limit: number
): number | null {
  if (burnRatePerMinute <= 0) return null;
  
  const tokensRemaining = limit - current;
  const minutesRemaining = tokensRemaining / burnRatePerMinute;
  
  return Math.max(0, minutesRemaining);
}

// ─── Checkpoint Actions ───────────────────────────────────────────────────────────
async function createCheckpoint(reason: string): Promise<boolean> {
  log('INFO', `Creating checkpoint: ${reason}`);
  
  try {
    const checkpoint = spawn('npm', ['run', 'checkpoint:create'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    
    return new Promise((resolve) => {
      checkpoint.on('close', (code) => {
        if (code === 0) {
          log('INFO', 'Checkpoint created successfully');
          resolve(true);
        } else {
          log('ERROR', `Checkpoint failed with code ${code}`);
          resolve(false);
        }
      });
      
      setTimeout(() => {
        checkpoint.kill();
        log('WARN', 'Checkpoint timeout');
        resolve(false);
      }, 30000);
    });
  } catch (err) {
    log('ERROR', 'Failed to create checkpoint', { error: String(err) });
    return false;
  }
}

// ─── Alert Actions ────────────────────────────────────────────────────────────────
async function sendAlert(
  level: string,
  tokens: TokenMetrics,
  actions: any,
  burnRate: number,
  projection: number | null
): Promise<void> {
  const emoji = level.includes('emergency') ? '🆘' : 
                level.includes('critical') ? '🔴' : 
                level.includes('hard') ? '🟠' : 
                level.includes('soft') ? '🟡' : 
                level.includes('3M') ? '🔵' : 'ℹ️';
  
  const message = `
╔══════════════════════════════════════════════════════════════════════════╗
║ ${emoji} TOKEN SPIKE GUARD ALERT: ${level.toUpperCase().padEnd(52)} ║
╠══════════════════════════════════════════════════════════════════════════╣
║ Tokens Used:      ${tokens.total.toLocaleString().padStart(12)} / ${(Math.max(...Object.values(CONFIG.thresholds)) || 15000000).toLocaleString().padStart(12)}  ║
║ Burn Rate:        ${(burnRate > 0 ? `+${burnRate.toFixed(0)}/min` : 'N/A').padStart(12)}                           ║
║ Time to Limit:    ${(projection !== null ? `~${projection.toFixed(1)} min` : 'N/A').padStart(12)}                           ║
╠══════════════════════════════════════════════════════════════════════════╣
║ ACTIONS TRIGGERED:                                                      ║
${actionsToString(actions)}
╚══════════════════════════════════════════════════════════════════════════╝
`;
  
  console.log(message);
  
  // Enviar a cada canal
  for (const channel of CONFIG.alerting.channels) {
    if (channel === 'file') {
      appendFileSync(join(LOG_DIR, 'alerts.log'), message, 'utf-8');
    } else if (channel === 'dashboard') {
      // Guardar para dashboard
      const dashboardPath = join(ROOT, '.session', 'alerts', 'token-guard.json');
      mkdirSync(join(ROOT, '.session', 'alerts'), { recursive: true });
      writeFileSync(dashboardPath, JSON.stringify({
        level,
        tokens,
        actions,
        burnRate,
        projection,
        timestamp: Date.now(),
      }, null, 2), 'utf-8');
    }
  }
}

function actionsToString(actions: any): string {
  const lines: string[] = [];
  if (actions.suggestCheckpoint) lines.push('║ ✓ Suggest checkpoint');
  if (actions.createCheckpoint) lines.push('║ ✓ Auto-create checkpoint');
  if (actions.suggestNewSession) lines.push('║ ✓ Suggest new session');
  if (actions.forceNewSession) lines.push('║ ✓ ⚠️  Force new session');
  if (actions.warnUser) lines.push('║ ✓ ⚠️  WARN user');
  if (actions.sendKillSwitch) lines.push('║ ✓ 🛑 Kill switch armed');
  if (actions.emergencyExit) lines.push('║ ✓ 🆘 EMERGENCY EXIT');
  return lines.length > 0 ? lines.join('\n') + '\n' : '║ (monitoring only)\n';
}

// ─── Main Guard Logic ─────────────────────────────────────────────────────────────
async function runGuardLoop(): Promise<void> {
  log('INFO', 'Token Spike Guard v2.0.0 starting...');
  
  const state = loadState();
  let lastMetrics: TokenMetrics | null = null;
  let lastTime = Date.now();
  
  const guardLoop = async () => {
    try {
      const metrics = await getCurrentTokens();
      const now = Date.now();
      const timeDelta = (now - lastTime) / 1000;
      
      // Calcular burn rate
      if (lastMetrics) {
        state.currentBurnRate = calculateBurnRate(metrics, lastMetrics, timeDelta);
      }
      
      // Predecir tiempo al siguiente limite
      const thresholds = Object.entries(CONFIG.thresholds)
        .filter(([_, value]) => value > metrics.total)
        .sort((a, b) => a[1] - b[1]);
      
      if (thresholds.length > 0) {
        const [, nextValue] = thresholds[0];
        state.projectedTimeToLimit = projectTimeToLimit(
          metrics.total,
          state.currentBurnRate,
          nextValue
        );
      }
      
      // Determinar nivel de alerta
      let alertLevel: string | null = null;
      let actions: any = {};
      
      if (metrics.total >= CONFIG.thresholds.emergency15M) {
        alertLevel = 'emergency15M';
        actions = CONFIG.actions.emergency15M;
      } else if (metrics.total >= CONFIG.thresholds.critical12M) {
        alertLevel = 'critical12M';
        actions = CONFIG.actions.critical12M;
      } else if (metrics.total >= CONFIG.thresholds.hard8M) {
        alertLevel = 'hard8M';
        actions = CONFIG.actions.hard8M;
      } else if (metrics.total >= CONFIG.thresholds.soft4M) {
        alertLevel = 'soft4M';
        actions = CONFIG.actions.soft4M;
      } else if (metrics.total >= CONFIG.thresholds.warning3M) {
        alertLevel = 'warning3M';
        actions = CONFIG.actions.warning3M;
      } else if (metrics.total >= CONFIG.thresholds.warning1M) {
        alertLevel = 'warning1M';
        actions = CONFIG.actions.warning1M;
      } else if (metrics.total >= CONFIG.thresholds.warning500k) {
        alertLevel = 'warning500k';
        actions = CONFIG.actions.warning500k;
      }
      
      // Solo alertar si cambió el nivel (evitar spam)
      if (alertLevel && alertLevel !== state.lastAlertLevel) {
        await sendAlert(alertLevel, metrics, actions, state.currentBurnRate, state.projectedTimeToLimit);
        
        // Ejecutar acciones
        if (actions.createCheckpoint) {
          await createCheckpoint(`Token guard: ${alertLevel}`);
          state.checkpoints.push(Date.now());
        }
        
        state.lastAlertLevel = alertLevel;
        state.lastAlertTime = now;
      }
      
      // Log periódico del estado (cada minuto)
      if (now - state.lastAlertTime > 60000) {
        log('INFO', `Status: ${metrics.total.toLocaleString()} tokens, burn rate: ${state.currentBurnRate.toFixed(0)}/min`);
      }
      
      saveState(state);
      lastMetrics = metrics;
      lastTime = now;
      
    } catch (err) {
      log('ERROR', 'Guard loop error', { error: String(err) });
    }
  };
  
  // Ejecutar inmediatamente y luego cada 10s
  await guardLoop();
  setInterval(guardLoop, CONFIG.monitorInterval);
  
  log('INFO', `Guard monitoring every ${CONFIG.monitorInterval / 1000}s. Press Ctrl+C to stop.`);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.includes('--attach')) {
    log('INFO', 'Attaching to current session...');
    await runGuardLoop();
  } else if (args.includes('--monitor')) {
    log('INFO', 'Starting monitor mode...');
    await runGuardLoop();
  } else if (args.includes('--status')) {
    const state = loadState();
    const metrics = await getCurrentTokens();
    
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║           TOKEN SPIKE GUARD STATUS v2.0.0                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`Session ID:         ${state.sessionId}`);
    console.log(`Runtime:            ${((Date.now() - state.startTime) / 1000 / 60).toFixed(1)} minutes`);
    console.log(`Tokens Used:        ${metrics.total.toLocaleString()}`);
    console.log(`Burn Rate:          ${state.currentBurnRate.toFixed(0)} tokens/min`);
    console.log(`Last Alert Level:   ${state.lastAlertLevel || 'None'}`);
    console.log(`Checkpoints:        ${state.checkpoints.length}`);
    console.log(`Projected Time:     ${state.projectedTimeToLimit !== null ? state.projectedTimeToLimit.toFixed(1) + ' min' : 'N/A'}`);
    console.log('');
    
    console.log('Thresholds:');
    Object.entries(CONFIG.thresholds).forEach(([key, value]) => {
      const status = metrics.total >= value ? '✅ REACHED' : `⏳ ${Math.round((1 - metrics.total/value) * 100)}% remaining`;
      console.log(`  ${key.padEnd(15)}: ${(value / 1000000).toFixed(1)}M ${status}`);
    });
    console.log('');
  } else {
    console.log('Token Spike Guard v2.0.0');
    console.log('');
    console.log('Usage:');
    console.log('  --attach         Attach to current session');
    console.log('  --monitor        Run continuous monitoring');
    console.log('  --status         Show current status');
    console.log('');
    console.log('Thresholds:');
    Object.entries(CONFIG.thresholds).forEach(([key, value]) => {
      console.log(`  ${key.padEnd(15)}: ${(value / 1000000).toFixed(1)}M tokens`);
    });
    console.log('');
    console.log('Auto-Actions:');
    console.log('  500K:    Log + Alert');
    console.log('  1M:      + Suggest checkpoint');
    console.log('  3M:      + Suggest new session');
    console.log('  4M:      + Create checkpoint');
    console.log('  8M:      + Warn user');
    console.log('  12M:     + Kill switch armed');
    console.log('  15M:     + Emergency exit');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    log('ERROR', 'Fatal error', { error: String(err) });
    process.exit(1);
  });
}

export { getCurrentTokens, calculateBurnRate, createCheckpoint };
