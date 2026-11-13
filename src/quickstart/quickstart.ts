#!/usr/bin/env node
/**
 * quickstart.ts — Onboarding con plan firmado (patrón rsc-harness, GB-2026-11-12).
 *
 * Uso:
 *   npx tsx src/quickstart/quickstart.ts                  # survey + plan visible (no escribe)
 *   npx tsx src/quickstart/quickstart.ts --accept-plan <sha12>  # aplica el plan vigente
 *   npx tsx src/quickstart/quickstart.ts --json           # plan como JSON
 *
 * Contrato (rsc verbatim): "Genera un plan visible (componentes Selected/Deferred/Excluded)
 * con un SHA-256 como id; no escribe nada hasta que aceptas con --accept-plan <id>".
 *
 * Side effects declarados por componente; solo `selected` con `safe-write` se aplican y solo
 * tras validar el fingerprint del plan VIGENTE (si el survey cambió, el token stale se rechaza).
 * Nada destructivo: no borra, no toca credenciales, no fuerza servicios runtime.
 */

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runSync } from '../../adapters/command-runner.js';

export type Tier = 'selected' | 'deferred' | 'excluded';
export type SideEffect = 'none' | 'safe-write';
export type ComponentState = 'present' | 'missing' | 'unknown';

export interface SurveyResult {
  node: string | null;
  npm: string | null;
  git: string | null;
  nodeModules: ComponentState;
  nexusDb: ComponentState;
  qualityGatesConfig: ComponentState;
  stackTasks: string[];
}

export interface PlanComponent {
  id: string;
  title: string;
  tier: Tier;
  sideEffect: SideEffect;
  state: ComponentState;
  reason: string;
}

export interface QuickstartPlan {
  survey: SurveyResult;
  components: PlanComponent[];
  fingerprint: string;
}

interface ApplyRunner {
  /** Ejecuta una acción declarada safe-write. Devuelve salida corta para el reporte. */
  (componentId: string): string;
}

const TASK_PATTERN = /gentle|codegraph|session/i;

/** Lee versiones de node/npm/git sin fallar (devuelven null si no están). */
function probeTool(name: 'node' | 'npm' | 'git'): string | null {
  try {
    const r = runSync(name, ['--version'], { timeout: 10000 });
    const out = (r.stdout ?? '').toString().trim();
    return r.status === 0 && out ? out.split('\n')[0] : null;
  } catch {
    return null;
  }
}

/** Lista tareas programadas del stack visibles para el usuario actual (solo lectura). */
function probeStackTasks(): string[] {
  try {
    const r = runSync('schtasks.exe', ['/query', '/fo', 'csv', '/nh'], { timeout: 15000 });
    if (r.status !== 0) return [];
    const out = (r.stdout ?? '').toString();
    const names: string[] = [];
    for (const line of out.split('\n')) {
      const first = line.split(',')[0]?.replace(/^"|"$/g, '').trim() ?? '';
      if (first && TASK_PATTERN.test(first)) names.push(first);
    }
    return names;
  } catch {
    return [];
  }
}

/** Survey de solo lectura del entorno. Nunca escribe. */
export function surveyEnvironment(root: string, now: Date = new Date()): SurveyResult {
  void now; // reservado para reportes de frescura; el survey no depende del reloj
  const nodeModules = existsSync(join(root, 'node_modules')) ? 'present' : 'missing';
  const nexusDb = existsSync(join(root, '.runtime', 'gentle-vanguard.db')) ? 'present' : 'missing';
  const qualityGatesConfig = existsSync(join(root, 'config', 'quality-gates.json'))
    ? 'present'
    : 'missing';
  return {
    node: probeTool('node'),
    npm: probeTool('npm'),
    git: probeTool('git'),
    nodeModules,
    nexusDb,
    qualityGatesConfig,
    stackTasks: probeStackTasks(),
  };
}

/**
 * Construye el plan a partir del survey. Regla rsc: el survey con todo presente produce
 * cero componentes selected con safe-write (nada que hacer, nada que aceptar).
 */
export function buildPlan(survey: SurveyResult): QuickstartPlan {
  const components: PlanComponent[] = [];
  const tasksPresent = survey.stackTasks.length > 0;

  components.push({
    id: 'install-deps',
    title: 'Instalar dependencias (npm install)',
    tier: survey.nodeModules === 'missing' ? 'selected' : 'excluded',
    sideEffect: 'safe-write',
    state: survey.nodeModules,
    reason:
      survey.nodeModules === 'missing'
        ? 'node_modules ausente: el stack no arranca sin dependencias'
        : 'node_modules presente: nada que instalar',
  });

  components.push({
    id: 'session-pipeline',
    title: 'Inicializar pipeline de sesión (session-autostart, idempotente)',
    tier: tasksPresent ? 'deferred' : 'selected',
    sideEffect: 'safe-write',
    state: tasksPresent ? 'present' : 'missing',
    reason: tasksPresent
      ? `tareas detectadas (${survey.stackTasks.length}): el pipeline corre en cada sesión`
      : 'sin tareas del stack registradas: inicializa session ID, engram, watchtower, Nexus',
  });

  components.push({
    id: 'verify-gates',
    title: 'Verificar quality gates (npm run gates:verify)',
    tier: 'selected',
    sideEffect: 'none',
    state: survey.qualityGatesConfig,
    reason:
      'chequeo de solo lectura: confirma que los gates declarados existen y apuntan a código real',
  });

  components.push({
    id: 'nexus-db',
    title: 'Nexus DB operacional',
    tier: 'deferred',
    sideEffect: 'none',
    state: survey.nexusDb,
    reason:
      survey.nexusDb === 'present'
        ? 'base presente; prune/optimize son mantenimiento explícito (gv optimize)'
        : 'se crea lazy en el primer uso; no se fuerza aquí',
  });

  components.push({
    id: 'runtime-services',
    title: 'Servicios runtime (dashboard, command-center)',
    tier: 'deferred',
    sideEffect: 'none',
    state: 'unknown',
    reason: 'servicios de larga vida: el owner decide cuándo levantarlos (gv dashboard start)',
  });

  components.push({
    id: 'credentials',
    title: 'Credenciales y secretos (engram/vault)',
    tier: 'excluded',
    sideEffect: 'none',
    state: 'unknown',
    reason: 'el quickstart jamás toca credenciales; gestión explícita por el owner',
  });

  return { survey, components, fingerprint: planFingerprint(components) };
}

/**
 * Fingerprint determinista (SHA-256) sobre la parte contractual del plan:
 * id + tier + sideEffect de cada componente, en orden. Excluye estados y timestamps
 * para que el token de aceptación solo cambie si cambia LO QUE SE HARÍA.
 */
export function planFingerprint(components: PlanComponent[]): string {
  const canonical = JSON.stringify(
    components.map((c) => ({ id: c.id, tier: c.tier, sideEffect: c.sideEffect })),
  );
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

/** Valida el token de aceptación contra el plan vigente. */
export function validateAccept(plan: QuickstartPlan, token: string): boolean {
  return plan.fingerprint === token.trim().toLowerCase();
}

export function formatPlan(plan: QuickstartPlan): string {
  const { survey, components } = plan;
  const lines: string[] = [];
  lines.push('Quickstart Gentle-Vanguard — plan propuesto');
  lines.push('');
  lines.push('Entorno (solo lectura):');
  lines.push(
    `  node ${survey.node ?? 'AUSENTE'} · npm ${survey.npm ?? 'AUSENTE'} · git ${survey.git ?? 'AUSENTE'}`,
  );
  lines.push(
    `  node_modules: ${survey.nodeModules} · nexus db: ${survey.nexusDb} · quality-gates: ${survey.qualityGatesConfig}`,
  );
  lines.push(
    survey.stackTasks.length
      ? `  tareas programadas del stack: ${survey.stackTasks.join(', ')}`
      : '  tareas programadas del stack: ninguna detectada',
  );
  lines.push('');
  lines.push('Componentes:');
  for (const c of components) {
    const mark =
      c.tier === 'selected' ? '[SELECTED]' : c.tier === 'deferred' ? '[deferred]' : '[excluded]';
    const effect = c.sideEffect === 'safe-write' ? 'escribe' : 'solo lectura';
    lines.push(`  ${mark} ${c.id} — ${c.title}`);
    lines.push(`      estado: ${c.state} · efecto: ${effect} · ${c.reason}`);
  }
  lines.push('');
  lines.push(`Plan id (SHA-256 truncado): ${plan.fingerprint}`);
  lines.push('');
  const work = components.filter((c) => c.tier === 'selected');
  if (work.length === 0) {
    lines.push('Nada por hacer: el stack ya está operativo. No se requiere aceptación.');
  } else {
    lines.push(`Nada se ha escrito. Para aplicar los ${work.length} componente(s) selected:`);
    lines.push(`  npx tsx src/quickstart/quickstart.ts --accept-plan ${plan.fingerprint}`);
  }
  return lines.join('\n');
}

/**
 * Aplica SOLO los componentes selected con acción disponible. Exige token válido del plan
 * vigente (nunca aplica un plan stale). Los runners inyectables permiten test sin side effects.
 */
export function applyPlan(
  plan: QuickstartPlan,
  root: string,
  token: string,
  runners: Record<string, ApplyRunner> = defaultRunners(root),
): { applied: { id: string; output: string }[]; refused: string[] } {
  if (!validateAccept(plan, token)) {
    throw new Error(
      `token de aceptación inválido para el plan vigente (${plan.fingerprint}); ` +
        're-ejecutar sin --accept-plan para ver el plan actual',
    );
  }
  const applied: { id: string; output: string }[] = [];
  const refused: string[] = [];
  for (const c of plan.components) {
    if (c.tier !== 'selected') continue;
    const runner = runners[c.id];
    if (!runner) {
      refused.push(c.id);
      continue;
    }
    applied.push({ id: c.id, output: runner(c.id) });
  }
  emitAppliedEvent(plan.fingerprint, applied, refused);
  return { applied, refused };
}

/**
 * Registra el apply en Nexus (events) para que dashboard/eval observen el onboarding.
 * Best-effort: Nexus ausente o fallido NUNCA hace fallar el quickstart.
 */
function emitAppliedEvent(
  planId: string,
  applied: { id: string; output: string }[],
  refused: string[],
): void {
  try {
    const dbPath = join(process.cwd(), '.runtime', 'gentle-vanguard.db');
    if (!existsSync(dbPath)) return;
    const db = new Database(dbPath);
    try {
      db.prepare(
        "INSERT INTO events (tenant_id, type, payload, created_at) VALUES ('gentle-vanguard', 'quickstart.applied', ?, datetime('now'))",
      ).run(JSON.stringify({ planId, applied: applied.map((a) => a.id), refused }));
    } finally {
      db.close();
    }
  } catch {
    // telemetría best-effort: sin Nexus no hay quickstart roto
  }
}

const defaultRunners = (root: string): Record<string, ApplyRunner> => ({
  'install-deps': () => {
    const r = runSync('npm', ['install', '--no-fund', '--no-audit'], {
      timeout: 300000,
      cwd: root,
    });
    return r.status === 0 ? 'npm install OK' : `npm install falló (exit ${r.status})`;
  },
  'session-pipeline': () => {
    // Alternativa bloqueante documentada en AGENTS.md; idempotente, no pide permiso.
    const r = runSync('npx', ['tsx', 'src/session/session-autostart.ts'], {
      timeout: 300000,
      cwd: root,
    });
    return r.status === 0 ? 'session pipeline inicializado' : `autostart falló (exit ${r.status})`;
  },
  'verify-gates': () => {
    const r = runSync('npm', ['run', 'gates:verify'], { timeout: 120000, cwd: root });
    const out = (r.stdout ?? '').toString().trim().split('\n').slice(-3).join(' | ');
    return r.status === 0 ? `gates OK (${out})` : `gates FALLARON: ${out}`;
  },
});

function showHelp(): void {
  console.log(`Uso: npx tsx src/quickstart/quickstart.ts [opciones]

Onboarding con plan firmado: survey de solo lectura, plan visible
(selected/deferred/excluded) y fingerprint SHA-256. Nada se escribe sin
--accept-plan con el token del plan VIGENTE.

Opciones:
  --accept-plan <sha12>   Aplica los componentes selected del plan vigente
  --json                  Salida JSON (plan o resultado del apply)
  --help                  Esta ayuda`);
}

async function main(argv: string[]): Promise<void> {
  const root = process.cwd();
  const wantJson = argv.includes('--json');
  const acceptIdx = argv.indexOf('--accept-plan');
  const token = acceptIdx >= 0 ? (argv[acceptIdx + 1] ?? '') : null;

  if (argv.includes('--help')) {
    showHelp();
    return;
  }

  const plan = buildPlan(surveyEnvironment(root));

  if (!token) {
    if (wantJson) {
      console.log(
        JSON.stringify(
          {
            ...plan,
            acceptCommand: `npx tsx src/quickstart/quickstart.ts --accept-plan ${plan.fingerprint}`,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(formatPlan(plan));
    }
    return;
  }

  try {
    const result = applyPlan(plan, root, token);
    if (wantJson) {
      console.log(JSON.stringify({ planId: plan.fingerprint, ...result }, null, 2));
    } else {
      console.log(`Plan ${plan.fingerprint} aceptado — aplicando:\n`);
      for (const a of result.applied) console.log(`  [OK] ${a.id}: ${a.output}`);
      for (const id of result.refused) console.log(`  [SKIP] ${id}: sin acción registrada`);
      console.log('\nQuickstart completo.');
    }
    if (result.refused.length > 0) process.exitCode = 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (wantJson) console.log(JSON.stringify({ error: msg }, null, 2));
    else console.error(`[quickstart] ${msg}`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && /quickstart(\.ts)?$/i.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('[quickstart] error no manejado:', err);
    process.exit(1);
  });
}
