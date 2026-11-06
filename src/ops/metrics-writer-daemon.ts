#!/usr/bin/env node
/**
 * Metrics Writer daemon — snapshot de métricas a Nexus SIN depender del dashboard.
 *
 * Antes MetricsWriter solo se instanciaba desde apps/web-dashboard/server/otel-pipeline.ts:
 * si el dashboard no corría, no había metric_snapshots ni sync de sesiones a Nexus.
 * Este daemon levanta el MISMO MetricsWriter canónico (src/database/nexus) como proceso
 * propio gestionado por process-hygiene (id: metrics-writer-daemon), arrancado por el
 * step lazy `metrics-writer-init` del autostart de sesión.
 *
 * Uso:
 *   npx tsx src/ops/metrics-writer-daemon.ts --watch [secs]   # default 30s
 *   npx tsx src/ops/metrics-writer-daemon.ts --once           # un snapshot y sale
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MetricsWriter } from '../database/nexus/metrics-writer.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const RUNTIME_DIR = join(ROOT, '.runtime');

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const watchIdx = argv.indexOf('--watch');
  const once = argv.includes('--once');

  if (once) {
    new MetricsWriter().writeSnapshot();
    console.log('[MW-daemon] snapshot único escrito');
    return;
  }

  const intervalSec = watchIdx >= 0 ? parseInt(argv[watchIdx + 1] || '30', 10) : 30;
  const intervalMs = (Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 30) * 1000;

  // Contrato pidfile de process-hygiene (igual que token-ingest): el daemon escribe
  // su pid y lo limpia al salir; la dedupe de respaldo funciona vía scan de procesos.
  const pidFile = join(RUNTIME_DIR, 'metrics-writer.pid');
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

  const writer = new MetricsWriter();
  writer.start(intervalMs);
  console.log(`[MW-daemon] corriendo cada ${intervalMs / 1000}s (PID ${process.pid})`);

  const shutdown = (): void => {
    writer.stop();
    removePidFile();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', removePidFile);

  // Keep-alive: el intervalo de MetricsWriter ya sostiene el event loop.
  await new Promise<void>(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[MW-daemon] error fatal:', err);
    process.exit(1);
  });
}
