#!/usr/bin/env node
/**
 * Token Budget Calibration — deriva los límites diario y por sesión del uso
 * real registrado en Nexus (últimos 14 días por defecto).
 *
 * Uso:
 *   npm run token:calibrate               # reporte read-only con recomendación
 *   npm run token:calibrate -- --json     # salida estructurada
 *   npm run token:calibrate -- --write    # aplica la recomendación al config
 *
 * El límite es un umbral de anomalía (pico observado + 10%), no un techo de
 * costo: los planes por suscripción no facturan por token.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { calibrate } from './token-budget-usage.js';

const CONFIG_PATH = join(process.cwd(), 'config', 'token-budget-guard.json');

const fmt = (n: number): string => n.toLocaleString('en-US');

function main(): void {
  const args = process.argv.slice(2);
  const windowDays = (() => {
    const i = args.indexOf('--days');
    const n = i >= 0 ? Number(args[i + 1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 14;
  })();
  const result = calibrate(windowDays);

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Uso de tokens en Nexus (ventana ${result.windowDays} días)`);
    console.log(`  días con actividad: ${result.daily.days}`);
    console.log(
      `  diario: mediana=${fmt(result.daily.median)} p90=${fmt(result.daily.p90)} p99=${fmt(result.daily.p99)} máximo=${fmt(result.daily.max)}`,
    );
    console.log(
      `  sesiones: n=${result.sessions.sessions} p90=${fmt(result.sessions.p90)} p99=${fmt(result.sessions.p99)} máximo=${fmt(result.sessions.max)}`,
    );
    console.log(
      `  recomendación: daily=${fmt(result.recommendedDaily)} perSession=${fmt(result.recommendedPerSession)}`,
    );
    console.log(
      result.daily.days === 0
        ? '  (sin datos: corré `npm run token:ingest` antes de calibrar)'
        : '  criterio: pico observado + 10%, redondeado a 10M',
    );
  }

  if (args.includes('--write')) {
    if (result.recommendedDaily <= 0 || result.recommendedPerSession <= 0) {
      console.error('No hay datos suficientes para escribir límites.');
      process.exitCode = 1;
      return;
    }
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    cfg.tokenBudget.limits.daily = result.recommendedDaily;
    cfg.tokenBudget.limits.perSession = result.recommendedPerSession;
    cfg.tokenBudget.calibration = {
      derived_from: 'nexus:token_transactions',
      window_days: result.windowDays,
      observed: {
        daily_median: result.daily.median,
        daily_p90: result.daily.p90,
        daily_p99: result.daily.p99,
        daily_max: result.daily.max,
        session_max: result.sessions.max,
      },
      rule: 'pico observado + 10% (umbral de anomalía, no techo de costo)',
      command: 'npm run token:calibrate -- --write',
      last_run: new Date().toISOString(),
    };
    cfg.last_updated = new Date().toISOString().slice(0, 10);
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    console.log(
      `Config actualizado: daily=${result.recommendedDaily} perSession=${result.recommendedPerSession}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
