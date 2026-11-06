#!/usr/bin/env node
/**
 * Token Spike Guard daemon — monitoreo continuo de burn rate de tokens.
 *
 * GAP cerrado: el lazy step `token-spike-guard` del autostart apuntaba al CLI
 * del guard, que SIN args imprime usage y muere → el step estaba muerto y el
 * spike guard era opt-in manual (--attach/--monitor).
 *
 * Patrón metrics-writer-daemon: pidfile de process-hygiene, windowsHide,
 * graceful shutdown. El loop real (`runGuardLoop`) corre cada 10s (config
 * del guard) y al alcanzar umbrales hace checkpoint + notifica por MCAS
 * (ver alert-dispatcher wiring en token-spike-guard.ts).
 *
 * Uso:
 *   npx tsx src/tokens/token-spike-guard-daemon.ts            # corre hasta kill
 *   npx tsx src/tokens/token-spike-guard-daemon.ts --once     # un check y sale
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runGuardLoop, getCurrentTokens } from '../tokens/token-spike-guard.js';

const ROOT = resolve(process.cwd());
const RUNTIME_DIR = join(ROOT, '.runtime');

async function main(): Promise<void> {
  const once = process.argv.includes('--once');

  if (once) {
    const metrics = await getCurrentTokens();
    console.log(`[spike-guard-daemon] check único: ${metrics.total.toLocaleString()} tokens`);
    return;
  }

  // Contrato pidfile de process-hygiene (igual que metrics-writer-daemon).
  const pidFile = join(RUNTIME_DIR, 'spike-guard.pid');
  const removePidFile = (): void => {
    try {
      if (existsSync(pidFile)) unlinkSync(pidFile);
    } catch {
      /* best-effort */
    }
  };
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(pidFile, String(process.pid), 'utf-8');
  } catch {
    /* best-effort */
  }

  const shutdown = (): void => {
    removePidFile();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[spike-guard-daemon] corriendo (PID ${process.pid}, pidfile ${pidFile})`);
  await runGuardLoop();
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('[spike-guard-daemon] fatal:', String(err));
    process.exit(1);
  });
}
