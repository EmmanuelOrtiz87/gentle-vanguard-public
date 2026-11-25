#!/usr/bin/env node

/**
 * runtime-retention-notify.ts — avisa al owner cuando la retención de
 * `.runtime` necesita una decisión SUYA.
 *
 * POR QUÉ EXISTE (2026-11-11)
 * -------------------------------------------------------------------------
 * El owner pidió la política de retención (14 días de backups, 7 de logs) con
 * una condición explícita: _"si esto genera problemas, notificar para que la
 * decisión la tome él"_. Con la política sola eso NO ocurre: el gate del
 * pre-push imprime escalaciones, pero el owner no hace push todos los días y
 * las escalaciones se leen como ruido. Este módulo las convierte en un aviso
 * con dedupe:
 *
 *   1. Corre la auditoría (simulación por defecto).
 *   2. Compara el conjunto de escalaciones con el del estado anterior
 *      (`.runtime/retention-escalations.json`).
 *   3. AVISA sólo si HAY CAMBIO: aparecen escalaciones nuevas o se resolvieron
 *      todas. Si el set es idéntico, no vuelve a molestar (un aviso diario
 *      por lo mismo es ruido, y ruido es lo contrario de notificar).
 *   4. El aviso sale por MCAS (file + dashboard + CLI, y los canales externos
 *      si hay credenciales).
 *
 * La PODA la decide la política, no este módulo: `autoApply: false` en
 * `config/runtime-retention.json` significa que el barrido diario sólo
 * simula y avisa. Con `autoApply: true` el mismo barrido aplica lo declarado.
 *
 * USO
 *   node --import tsx src/ops/runtime-retention-notify.ts            # simula y avisa
 *   node --import tsx src/ops/runtime-retention-notify.ts --json
 *   node --import tsx src/ops/runtime-retention-notify.ts --apply    # aplica la política
 *   node --import tsx src/ops/runtime-retention-notify.ts --if-due   # barrido diario (autostart)
 *   node --import tsx src/ops/runtime-retention-notify.ts --fresh    # ignora el escaneo persistido
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dispatchAlert, type DispatchAlertOptions } from '../monitor/alert-dispatcher.js';
import { auditRetention, loadPolicy, type RetentionReport } from './runtime-retention.js';

export interface EscalationState {
  /** Hash del conjunto de escalaciones (orden-independent). */
  fingerprint: string;
  escalations: string[];
  notifiedAt: string;
}

export type EscalationReason = 'new' | 'changed' | 'resolved' | 'unchanged';

export interface EscalationDecision {
  /** ¿Hay que avisar al owner? */
  notify: boolean;
  reason: EscalationReason;
  severity: 'info' | 'warning' | 'critical';
  escalations: string[];
}

export interface RetentionNotifyOptions {
  root?: string;
  /** Forzar la poda (por defecto decide la política: `autoApply`). */
  apply?: boolean;
  now?: number;
  /** Inyectable para tests: no toca MCAS. */
  dispatch?: (opts: DispatchAlertOptions) => void;
  /** Inyectable para tests: dónde vive el estado. */
  statePath?: string;
  /** Inyectable para tests: desactiva el reuso del escaneo persistido. */
  useCache?: boolean;
  /** Edad máxima del escaneo reusado (por defecto SCAN_TTL_MS). */
  scanTtlMs?: number;
}

export interface RetentionNotifyResult {
  notified: boolean;
  reason: EscalationReason;
  severity: 'info' | 'warning' | 'critical';
  escalations: string[];
  applied: boolean;
  statePath: string;
  /** El informe sale del escaneo persistido, no de un recorrido nuevo. */
  cacheHit: boolean;
  report: RetentionReport;
}

/**
 * Clave ESTABLE de una escalación: qué directorio y qué clase de problema.
 *
 * NO se usa el texto completo porque lleva el tamaño medido ("quedaría en 1263
 * MB"): ese número se mueve con cada backup nuevo y el aviso volvería a saltar
 * aunque la situación sea la misma. Un aviso que se repite porque un número se
 * movió un MB es ruido.
 */
export function escalationKey(escalation: string): string {
  const head = escalation.split(':')[0]?.trim() ?? escalation.trim();
  const kind = escalation.includes('sin política') ? 'sin-politica' : 'tope';
  return `${head}|${kind}`;
}

/** Hash del conjunto de escalaciones (por clave estable, no por texto). */
export function escalationFingerprint(escalations: string[]): string {
  const keys = [...new Set(escalations.map(escalationKey))].sort();
  return createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Decide si hay que avisar.
 *
 * - Hay escalaciones y no había estado  → `new`     (avisar).
 * - Hay escalaciones y el set cambió    → `changed` (avisar).
 * - Hay escalaciones y el set es igual   → `unchanged` (NO avisar).
 * - No hay escalaciones y las había     → `resolved` (avisar: se resolvió).
 * - No hay escalaciones y nunca las hubo  → `unchanged` (NO avisar).
 */
export function decideNotification(
  previous: EscalationState | null,
  current: string[],
): EscalationDecision {
  const escalations = [...current];
  if (escalations.length === 0) {
    const had = previous !== null && previous.escalations.length > 0;
    return {
      notify: had,
      reason: had ? 'resolved' : 'unchanged',
      severity: 'info',
      escalations,
    };
  }
  if (previous === null) {
    return { notify: true, reason: 'new', severity: 'warning', escalations };
  }
  if (previous.fingerprint === escalationFingerprint(escalations)) {
    return { notify: false, reason: 'unchanged', severity: 'warning', escalations };
  }
  return { notify: true, reason: 'changed', severity: 'warning', escalations };
}

export function statePathFor(root: string): string {
  return join(root, '.runtime', 'retention-escalations.json');
}

export function readState(path: string): EscalationState | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as EscalationState;
    if (typeof parsed?.fingerprint !== 'string' || !Array.isArray(parsed.escalations)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeState(path: string, state: EscalationState): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    /* best effort: el aviso ya salió */
  }
}

/**
 * Reuso del escaneo (2026-11-25).
 *
 * La auditoría recorre todo `.runtime` (medido 2026-11-25: ~190k archivos; 3 s
 * con el disco libre y 4,5 min bajo contención — user CPU 0,4 s, todo espera de
 * I/O). Corría completa en CADA push y bajo la carga concurrente del pre-push
 * superó su timeout de 300 s — un gate bloqueó el push por una medición que no
 * cambió. El escaneo se persiste y se reusa mientras (a) el conjunto de
 * directorios top-level de `.runtime` no cambió — agregar o quitar un
 * directorio invalida al instante — y (b) el informe tiene menos de
 * SCAN_TTL_MS. El TTL (24 h) coincide con el barrido diario del autostart, que
 * es quien refresca: la decisión que importa (escalaciones por nombre) sólo
 * cambia con el conjunto de directorios o la política, y la política entra en
 * el fingerprint. `--apply` NUNCA reusa: borra sobre medición fresca.
 */
const SCAN_TTL_MS = 86_400_000;

interface ScanCache {
  version: 1;
  createdAt: number;
  fingerprint: string;
  report: RetentionReport;
}

export function scanCachePathFor(root: string): string {
  return join(root, '.runtime', 'retention-scan-cache.json');
}

/** Cambia cuando aparece/desaparece un directorio de `.runtime` o cambia la política. */
export function runtimeFingerprint(root: string): string {
  const runtime = join(root, '.runtime');
  let dirs: string[] = [];
  try {
    dirs = readdirSync(runtime, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return 'no-runtime';
  }
  let policy = '';
  try {
    policy = readFileSync(join(root, 'config', 'runtime-retention.json'), 'utf8');
  } catch {
    /* sin política: loadPolicy ya falla aparte */
  }
  return createHash('sha256').update(dirs.join('\n')).update(policy).digest('hex').slice(0, 16);
}

export function readScanCache(
  path: string,
  fingerprint: string,
  now: number,
  ttlMs: number,
): RetentionReport | null {
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as ScanCache;
    if (cached?.version !== 1 || cached.fingerprint !== fingerprint) return null;
    if (!Number.isFinite(cached.createdAt)) return null;
    const age = now - cached.createdAt;
    if (age < 0 || age > ttlMs) return null;
    if (!cached.report || !Array.isArray(cached.report.escalations)) return null;
    return { ...cached.report, applied: false };
  } catch {
    return null;
  }
}

export function writeScanCache(
  path: string,
  fingerprint: string,
  report: RetentionReport,
  now: number,
): void {
  try {
    writeFileSync(
      path,
      JSON.stringify(
        { version: 1, createdAt: now, fingerprint, report } satisfies ScanCache,
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    /* best effort: el próximo ciclo vuelve a escanear */
  }
}

const SWEEP_MARKER = 'retention-last-sweep.json';

export function sweepMarkerPathFor(root: string): string {
  return join(root, '.runtime', SWEEP_MARKER);
}

/** `--if-due`: el barrido diario declarado se salta si ya corrió en las últimas 24 h. */
export function isSweepDue(markerPath: string, now: number, intervalMs = 86_400_000): boolean {
  if (!existsSync(markerPath)) return true;
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { ranAt?: string };
    const ts = Date.parse(marker.ranAt ?? '');
    return !Number.isFinite(ts) || now - ts >= intervalMs;
  } catch {
    return true;
  }
}

function writeSweepMarker(markerPath: string, now: number): void {
  try {
    writeFileSync(
      markerPath,
      JSON.stringify({ ranAt: new Date(now).toISOString() }, null, 2),
      'utf8',
    );
  } catch {
    /* best effort */
  }
}

function buildMessage(
  decision: EscalationDecision,
  report: RetentionReport,
): { message: string; details: string; recommendation: string } {
  if (decision.reason === 'resolved') {
    return {
      message:
        'Retención de .runtime: las escalaciones se resolvieron (sin directorios sin política).',
      details: `Ciclo verificado sobre ${report.totalMb} MB.`,
      recommendation: 'Nada que decidir. El próximo ciclo sólo avisa si aparece algo nuevo.',
    };
  }
  const top = decision.escalations.slice(0, 5).join('\n');
  const more =
    decision.escalations.length > 5 ? `\n… y ${decision.escalations.length - 5} más` : '';
  return {
    message: `Retención de .runtime: ${decision.escalations.length} escalaciones requieren decisión.`,
    details: `${top}${more}`,
    recommendation:
      'Ajustá config/runtime-retention.json (subir el tope o bajar keepNewest) o declará lo que se conserva. ' +
      'El stack no borra lo que no está declarado.',
  };
}

/**
 * Corre el ciclo completo: audita, decide, avisa (sólo si hay cambio) y
 * persiste el estado para el próximo ciclo.
 */
export function runRetentionNotification(
  options: RetentionNotifyOptions = {},
): RetentionNotifyResult {
  const root = options.root ?? resolve(import.meta.dirname, '..', '..');
  const policy = loadPolicy(root);
  const apply = options.apply ?? policy.autoApply === true;
  const now = options.now ?? Date.now();
  // Solo la simulación reusa el escaneo: con reloj inyectado (tests) el
  // resultado tiene que corresponder a ESE instante, no a uno anterior.
  const useCache = !apply && options.now === undefined && options.useCache !== false;
  const cachePath = scanCachePathFor(root);
  let cacheHit = false;
  let report: RetentionReport | null = null;
  if (useCache) {
    const fingerprint = runtimeFingerprint(root);
    report = readScanCache(cachePath, fingerprint, now, options.scanTtlMs ?? SCAN_TTL_MS);
    if (report) {
      cacheHit = true;
    } else {
      report = auditRetention({ root, apply, now: options.now });
      writeScanCache(cachePath, fingerprint, report, now);
    }
  } else {
    report = auditRetention({ root, apply, now: options.now });
  }
  const statePath = options.statePath ?? statePathFor(root);
  const previous = readState(statePath);
  const decision = decideNotification(previous, report.escalations);

  const dispatch = options.dispatch ?? dispatchAlert;
  if (decision.notify) {
    const { message, details, recommendation } = buildMessage(decision, report);
    dispatch({
      severity: decision.severity,
      category: 'runtime-retention',
      message,
      details,
      recommendation,
      // TTL largo: el dedupe vive en el estado, no en el dispatcher.
      dedupeTtlMs: 0,
      dedupeKey: `retention:${decision.reason}`,
      metrics: {
        totalMb: report.totalMb,
        escalations: report.escalations.length,
        unclassified: report.unclassified.length,
        pruned: report.pruned.length,
        freedMb: report.freedMb,
      },
    });
  }

  // El estado se persiste cuando hay aviso (o cuando ya no queda nada por
  // avisar): el próximo ciclo compara contra esto y no repite el aviso.
  if (decision.notify || report.escalations.length === 0) {
    writeState(statePath, {
      fingerprint: escalationFingerprint(report.escalations),
      escalations: report.escalations,
      notifiedAt: new Date(options.now ?? Date.now()).toISOString(),
    });
  }

  return {
    notified: decision.notify,
    reason: decision.reason,
    severity: decision.severity,
    escalations: report.escalations,
    applied: apply,
    statePath,
    cacheHit,
    report,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const asJson = argv.includes('--json');
  const root = resolve(import.meta.dirname, '..', '..');
  const markerPath = sweepMarkerPathFor(root);
  if (argv.includes('--if-due') && !isSweepDue(markerPath, Date.now())) {
    if (asJson) console.log(JSON.stringify({ skipped: true, reason: 'ran within 24h' }));
    else console.log('[runtime-retention-notify] barrido omitido: ya corrió en las últimas 24 h');
    return;
  }
  const result = runRetentionNotification({ apply, useCache: !argv.includes('--fresh') });
  writeSweepMarker(markerPath, Date.now());
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `[runtime-retention-notify] ${result.applied ? 'APLICADO' : 'SIMULACIÓN'} · ` +
      `escalaciones: ${result.escalations.length} · aviso: ${result.notified ? result.reason : 'no (sin cambios)'}` +
      `${result.cacheHit ? ' · escaneo reusado' : ''}`,
  );
  for (const e of result.escalations.slice(0, 10)) console.log(`  ESCALACIÓN: ${e}`);
  if (result.escalations.length > 10) {
    console.log(`  … y ${result.escalations.length - 10} más`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
