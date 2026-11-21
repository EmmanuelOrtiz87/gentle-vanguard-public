#!/usr/bin/env node
/**
 * stack-apps-audit-scheduled.ts — barrido COMPLETO de apps, en la cadencia.
 *
 * POR QUE (2026-11-18)
 * -------------------------------------------------------------------------
 * Decision del owner: "stack-audit-apps deberia ser a demanda, no parte del
 * cierre ... no podemos poner en juego la velocidad del stack para los cierres
 * o los analisis de otras cosas".
 *
 * El barrido completo es O(catalogo de apps): hoy son 31 apps y cada app nueva
 * lo alarga. Como gate de push pagaba ~20 minutos por push (y en 2026-11-18
 * termino en timeout). Pero el barrido tiene un valor real: es el UNICO lugar
 * donde se ve el estado del catalogo completo.
 *
 * REPARTO (declarado, no improvisado):
 *   - PUSH   : valida el CAMBIO. Solo barre las apps tocadas por el diff
 *              (alcance 'apps'), que es barato y de senal alta. Si el diff toca
 *              superficie compartida, el push NO barre el catalogo: lo declara.
 *   - CADENCIA: este wrapper. Barre TODAS las apps, sin bloquear a nadie, y
 *              deja recibo + log. Es mantenimiento, no es velocidad.
 *   - A DEMANDA: `--audit-apps` en el gate de push, o este script a mano.
 *
 * COMO SE REGISTRA (Windows Task Scheduler, tarea diaria):
 *   Program:    node.exe
 *   Argumentos: --import tsx <repo>/src/ops/stack-apps-audit-scheduled.ts
 *   Inicio:     <repo>
 *   (el wrapper no abre ventana: escribe el log a .runtime/)
 *
 * Run (manual): node --import tsx src/ops/stack-apps-audit-scheduled.ts
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const LOG = join(ROOT, '.runtime', 'stack-apps-audit.log');
const REPORT_DIR = join(ROOT, '.runtime', 'stack-apps-audit');

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    appendFileSync(LOG, line);
  } catch {
    /* best-effort */
  }
  console.log(msg);
}

export function runScheduledAppAudit(
  root = ROOT,
  runner: typeof runSync = runSync,
  writeLog: (message: string) => void = log,
): number {
  const script = join(root, 'src', 'ops', 'stack-audit-apps.ts');
  writeLog('--- barrido completo de apps (cadencia) ---');
  try {
    const result = runner(process.execPath, ['--import', 'tsx', script, '--json'], {
      cwd: root,
      timeout: 45 * 60 * 1000,
    });
    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    const summary = summarize(stdout);
    const reportPath = persistReport(stdout);
    const reportNote = reportPath ? ` · reporte: ${reportPath}` : '';
    if (result.status === 0) {
      writeLog(summary ? `barrido completo: OK — ${summary}${reportNote}` : 'barrido completo: OK');
      return 0;
    }
    writeLog(
      `barrido completo: FAIL (exit ${result.status ?? 'unknown'}) ` +
        `${summary ? `${summary} · ` : ''}${stderr.slice(-500) || stdout.slice(-500)}${reportNote}`,
    );
    return 1;
  } catch (error) {
    writeLog(`barrido completo: FAIL ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * Guarda el reporte JSON del barrido como evidencia de la cadencia (un archivo
 * por corrida). Sin esto, la cadencia deja un log de una linea y ningun detalle
 * de que app fallo o quedo en WARN.
 */
export function persistReport(stdout: string, dir = REPORT_DIR): string | null {
  try {
    JSON.parse(stdout);
  } catch {
    return null;
  }
  try {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `apps-audit-${stamp}.json`);
    writeFileSync(file, stdout);
    return file;
  } catch {
    return null;
  }
}

/** Resumen legible del reporte JSON del barrido (apps PASS/WARN/FAIL). */
export function summarize(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as {
      audits?: Array<{ app?: string; status?: string }>;
      passed?: number;
      warned?: number;
      failed?: number;
    };
    const audits = Array.isArray(parsed.audits) ? parsed.audits : [];
    const failedApps = audits
      .filter((a) => a.status === 'FAIL')
      .map((a) => a.app)
      .filter((a): a is string => Boolean(a));
    const base = `${audits.length} apps · ${parsed.passed ?? 0} PASS / ${parsed.warned ?? 0} WARN / ${parsed.failed ?? 0} FAIL`;
    return failedApps.length ? `${base} · fallan: ${failedApps.join(', ')}` : base;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runScheduledAppAudit();
}
