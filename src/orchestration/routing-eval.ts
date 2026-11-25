/**
 * routing-eval.ts — el que mira los recibos (GB-20261120, brecha 11).
 *
 * Los recibos de delegación fluyen a `.session/routing/hits.jsonl` pero nadie los
 * analizaba. Este evaluador:
 *  1. Resume rendimiento real por agente/dominio (éxitos, fallos, duración).
 *  2. Re-ejecuta el recomendador sobre cada recibo que SÍ trae el texto de la
 *     tarea y compara contra el agente que se eligió en producción (concordancia
 *     del routing). Los recibos editoriales omiten la tarea a propósito, así que
 *     la cobertura de replay se reporta honesta — no se inventa.
 *
 * Uso: npm run routing:eval [-- --hits <path>] [--json]
 * La verificación de 20 casos curados por el owner queda documentada en
 * docs/features/GB-20261120-orquestacion-ciclos-cerrados.md §Pendiente.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { recommend, registeredAgents } from './recommend-agent.js';

export interface RoutingHit {
  timestamp?: string;
  task?: string;
  domain?: string;
  agent?: string;
  confidence?: number;
  source?: string;
  success?: boolean;
  duration?: number;
  editorial?: { operation?: string; verification?: string; providerFailures?: unknown[] };
  [key: string]: unknown;
}

export interface EvalReport {
  total: number;
  ok: number;
  fail: number;
  byAgent: Array<{ agent: string; total: number; ok: number; rate: number; avgDurationMs: number }>;
  byDomain: Record<string, number>;
  /** Recibos cuyo target no es un agente registrado (dato histórico inválido). */
  nonAgentTargets: Array<{ agent: string; total: number }>;
  /** Fallos agrupados por causa, desde `error` del recibo (nuevos recibos). */
  failureClasses: Array<{ klass: string; count: number }>;
  replay: {
    replayable: number;
    agreed: number;
    disagreement: Array<{ task: string; expected: string; got: string }>;
  };
}

function classifyError(error: string): string {
  return error
    .replace(/[0-9a-f]{8,}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 90)
    .trim();
}

function loadHits(path: string): RoutingHit[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as RoutingHit;
      } catch {
        return null;
      }
    })
    .filter((h): h is RoutingHit => h !== null);
}

export function evaluateHits(hits: RoutingHit[]): EvalReport {
  const byAgent = new Map<string, { total: number; ok: number; durationSum: number }>();
  const byDomain: Record<string, number> = {};
  const canon = registeredAgents();
  const nonAgentTargets = new Map<string, number>();
  const failureClasses = new Map<string, number>();
  let ok = 0;
  let fail = 0;
  for (const hit of hits) {
    const agent = hit.agent ?? 'unknown';
    if (canon && !canon.has(agent)) {
      nonAgentTargets.set(agent, (nonAgentTargets.get(agent) ?? 0) + 1);
    }
    const entry = byAgent.get(agent) ?? { total: 0, ok: 0, durationSum: 0 };
    entry.total++;
    if (hit.success) {
      entry.ok++;
      ok++;
    } else {
      fail++;
      const error = typeof hit.error === 'string' ? hit.error.trim() : '';
      if (error) {
        const klass = classifyError(error);
        failureClasses.set(klass, (failureClasses.get(klass) ?? 0) + 1);
      }
    }
    entry.durationSum += Number(hit.duration) || 0;
    byAgent.set(agent, entry);
    const domain = hit.domain ?? 'unknown';
    byDomain[domain] = (byDomain[domain] ?? 0) + 1;
  }

  // Replay solo de recibos con texto de tarea (los editoriales lo omiten a
  // propósito) y cuyo target es un agente registrado: comparar contra un
  // nombre de skill histórico no mide el routing, mide un dato inválido.
  const replayable = hits.filter(
    (h) =>
      typeof h.task === 'string' &&
      h.task.trim().length > 0 &&
      (!canon || canon.has(String(h.agent))),
  );
  const disagreement: EvalReport['replay']['disagreement'] = [];
  let agreed = 0;
  for (const hit of replayable) {
    const rec = recommend(String(hit.task), '', 1) as { recommended?: string };
    if (rec.recommended === hit.agent) {
      agreed++;
    } else {
      disagreement.push({
        task: String(hit.task).slice(0, 120),
        expected: String(hit.agent),
        got: rec.recommended ?? 'unknown',
      });
    }
  }

  return {
    total: hits.length,
    ok,
    fail,
    byAgent: [...byAgent.entries()]
      .map(([agent, e]) => ({
        agent,
        total: e.total,
        ok: e.ok,
        rate: e.total > 0 ? e.ok / e.total : 0,
        avgDurationMs: e.total > 0 ? Math.round(e.durationSum / e.total) : 0,
      }))
      .sort((a, b) => b.total - a.total),
    byDomain,
    nonAgentTargets: [...nonAgentTargets.entries()]
      .map(([agent, total]) => ({ agent, total }))
      .sort((a, b) => b.total - a.total),
    failureClasses: [...failureClasses.entries()]
      .map(([klass, count]) => ({ klass, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    replay: { replayable: replayable.length, agreed, disagreement },
  };
}

function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(
    `[routing-eval] ${report.total} recibos · ${report.ok} ok / ${report.fail} fail ` +
      `(tasa global ${(report.total > 0 ? report.ok / report.total : 0).toFixed(2)})`,
  );
  for (const a of report.byAgent) {
    lines.push(
      `  ${a.agent}: ${a.total} delegaciones · ${a.ok} ok (${(a.rate * 100).toFixed(0)}%) · dur media ${a.avgDurationMs}ms`,
    );
  }
  lines.push(`  dominios: ${JSON.stringify(report.byDomain)}`);
  if (report.nonAgentTargets.length) {
    lines.push(
      `  targets no-agente (dato inválido, excluido del replay): ${report.nonAgentTargets
        .map((t) => `${t.agent}×${t.total}`)
        .join(', ')}`,
    );
  }
  if (report.failureClasses.length) {
    lines.push('  fallos por causa (recibos con error):');
    for (const f of report.failureClasses) lines.push(`    ${f.count}× ${f.klass}`);
  }
  lines.push(
    `  replay del recomendador: ${report.replay.agreed}/${report.replay.replayable} concordantes` +
      ` (los recibos editoriales omiten la tarea: no se re-ejecutan, no se inventa)`,
  );
  for (const d of report.replay.disagreement) {
    lines.push(`    ✖ "${d.task}" → esperado ${d.expected}, hoy daría ${d.got}`);
  }
  return lines.join('\n');
}

export interface EvalCase {
  id: string;
  task: string;
  expectedAgent: string;
  expectedDomain?: string;
}

/** Evalúa el dataset curado (config/routing-eval-cases.json) contra el router vivo. */
export function evaluateCases(cases: EvalCase[]): {
  total: number;
  pass: number;
  failures: Array<{ id: string; task: string; expected: string; got: string; domain: string }>;
} {
  const failures: Array<{
    id: string;
    task: string;
    expected: string;
    got: string;
    domain: string;
  }> = [];
  let pass = 0;
  for (const c of cases) {
    const rec = recommend(c.task, '', 1) as { recommended?: string; domain?: string };
    if (rec.recommended === c.expectedAgent) {
      pass++;
    } else {
      failures.push({
        id: c.id,
        task: c.task,
        expected: c.expectedAgent,
        got: rec.recommended ?? 'unknown',
        domain: rec.domain ?? 'unknown',
      });
    }
  }
  return { total: cases.length, pass, failures };
}

function loadCases(path: string): EvalCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { cases?: EvalCase[] };
  return raw.cases ?? [];
}

function main(): void {
  const args = process.argv.slice(2);
  const casesArg = args.indexOf('--cases');
  if (casesArg !== -1 && args[casesArg + 1]) {
    const cases = loadCases(resolve(args[casesArg + 1]));
    const report = evaluateCases(cases);
    console.log(
      `[routing-eval] dataset: ${report.pass}/${report.total} casos enrutan al agente canónico`,
    );
    for (const f of report.failures) {
      console.log(`  ✖ ${f.id}: "${f.task.slice(0, 80)}" → ${f.got} (esperado ${f.expected})`);
    }
    if (report.failures.length > 0) process.exitCode = 1;
    return;
  }
  const hitsArg = args.indexOf('--hits');
  const hitsPath =
    hitsArg !== -1 && args[hitsArg + 1]
      ? resolve(args[hitsArg + 1])
      : join(process.cwd(), '.session', 'routing', 'hits.jsonl');
  const report = evaluateHits(loadHits(hitsPath));
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
}

// Guard CLI por URL del módulo: los tests importan evaluateHits sin efectos.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
