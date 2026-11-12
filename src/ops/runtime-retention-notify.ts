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
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
}

export interface RetentionNotifyResult {
  notified: boolean;
  reason: EscalationReason;
  severity: 'info' | 'warning' | 'critical';
  escalations: string[];
  applied: boolean;
  statePath: string;
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
  const report = auditRetention({ root, apply, now: options.now });
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
    report,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const asJson = argv.includes('--json');
  const result = runRetentionNotification({ apply });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `[runtime-retention-notify] ${result.applied ? 'APLICADO' : 'SIMULACIÓN'} · ` +
      `escalaciones: ${result.escalations.length} · aviso: ${result.notified ? result.reason : 'no (sin cambios)'}`,
  );
  for (const e of result.escalations.slice(0, 10)) console.log(`  ESCALACIÓN: ${e}`);
  if (result.escalations.length > 10) {
    console.log(`  … y ${result.escalations.length - 10} más`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
