#!/usr/bin/env node
/**
 * bootstrap.ts — Instalación de Gentle-Vanguard desde cero (slice 2, GB-2026-11-12).
 *
 * Uso (desde cualquier directorio):
 *   npx tsx <ruta-al-repo>/src/quickstart/bootstrap.ts [--target <dir>] [--repo <owner/name>]
 *   npx tsx <ruta-al-repo>/src/quickstart/bootstrap.ts --accept-plan <sha12>
 *
 * Contrato (mismo patrón rsc que quickstart.ts): survey de solo lectura → plan visible
 * (selected/deferred/excluded) → fingerprint SHA-256 → nada se escribe sin --accept-plan
 * del plan VIGENTE. El plan del bootstrap cubre CLONAR + dependencias; el plan operativo
 * del repo clonado lo emite quickstart.ts dentro del clon (dos aceptaciones, dos planes,
 * nunca un plan que cubra todo a ciegas).
 *
 * Por defecto NO clona sobre un directorio existente ni toca el repo de origen.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { runSync } from '../../adapters/command-runner.js';

export interface BootstrapSurvey {
  node: string | null;
  npm: string | null;
  git: string | null;
  gh: string | null;
  ghAuthed: 'present' | 'missing' | 'unknown';
  target: string;
  targetFree: boolean;
  repo: string;
}

export interface BootstrapComponent {
  id: string;
  title: string;
  tier: 'selected' | 'deferred' | 'excluded';
  sideEffect: 'none' | 'safe-write';
  state: string;
  reason: string;
}

export interface BootstrapPlan {
  survey: BootstrapSurvey;
  components: BootstrapComponent[];
  fingerprint: string;
}

const DEFAULT_REPO = 'emmanuelortiz87/gentle-vanguard';

function probe(name: 'node' | 'npm' | 'git' | 'gh', args: string[] = ['--version']): string | null {
  try {
    const r = runSync(name, args, { timeout: 10000 });
    const out = (r.stdout ?? '').toString().trim();
    return r.status === 0 && out ? out.split('\n')[0] : null;
  } catch {
    return null;
  }
}

/** Survey de solo lectura del entorno de destino. Nunca escribe. */
export function surveyBootstrap(target: string, repo: string = DEFAULT_REPO): BootstrapSurvey {
  const ghVersion = probe('gh');
  let ghAuthed: BootstrapSurvey['ghAuthed'] = 'unknown';
  if (ghVersion) {
    try {
      const r = runSync('gh', ['auth', 'status'], { timeout: 15000 });
      ghAuthed = r.status === 0 ? 'present' : 'missing';
    } catch {
      ghAuthed = 'unknown';
    }
  }
  return {
    node: probe('node'),
    npm: probe('npm'),
    git: probe('git'),
    gh: ghVersion,
    ghAuthed,
    target,
    targetFree: !existsSync(target),
    repo,
  };
}

export function buildBootstrapPlan(survey: BootstrapSurvey): BootstrapPlan {
  const components: BootstrapComponent[] = [];
  const toolsOk = survey.node && survey.npm && survey.git;

  components.push({
    id: 'clone-repo',
    title: `Clonar ${survey.repo} en ${survey.target}`,
    tier: toolsOk && survey.ghAuthed === 'present' && survey.targetFree ? 'selected' : 'excluded',
    sideEffect: 'safe-write',
    state: survey.targetFree ? 'missing' : 'occupied',
    reason: !survey.targetFree
      ? 'el directorio destino ya existe: el bootstrap nunca clona sobre algo existente'
      : survey.ghAuthed !== 'present'
        ? 'sin `gh auth status` OK el clon privado fallaría; autenticar primero (gh auth login)'
        : !toolsOk
          ? 'faltan prerequisitos (node/npm/git)'
          : 'clon vía gh (autenticación del usuario, sin embeber credenciales)',
  });

  components.push({
    id: 'install-deps',
    title: 'npm install en el clon',
    tier: 'selected',
    sideEffect: 'safe-write',
    state: 'pending-clone',
    reason: 'requiere clone-repo; corre solo dentro del directorio recién clonado',
  });

  components.push({
    id: 'operative-plan',
    title: 'Plan operativo dentro del clon (quickstart.ts)',
    tier: 'deferred',
    sideEffect: 'none',
    state: 'after-clone',
    reason:
      'terminado el bootstrap, ejecutar `npx tsx src/quickstart/quickstart.ts` DENTRO del clon: ' +
      'emite su propio plan firmado y requiere su propia aceptación',
  });

  components.push({
    id: 'credentials',
    title: 'Credenciales y secretos',
    tier: 'excluded',
    sideEffect: 'none',
    state: 'unknown',
    reason: 'el bootstrap jamás toca credenciales; gh usa la sesión del usuario',
  });

  const canonical = JSON.stringify(
    components.map((c) => ({ id: c.id, tier: c.tier, sideEffect: c.sideEffect })),
  );
  return {
    survey,
    components,
    fingerprint: createHash('sha256').update(canonical).digest('hex').slice(0, 12),
  };
}

export function formatBootstrapPlan(plan: BootstrapPlan): string {
  const lines: string[] = [];
  lines.push('Bootstrap Gentle-Vanguard — instalación desde cero');
  lines.push('');
  lines.push('Entorno (solo lectura):');
  lines.push(
    `  node ${plan.survey.node ?? 'AUSENTE'} · npm ${plan.survey.npm ?? 'AUSENTE'} · git ${plan.survey.git ?? 'AUSENTE'} · gh ${plan.survey.gh ?? 'AUSENTE'} (auth: ${plan.survey.ghAuthed})`,
  );
  lines.push(`  destino: ${plan.survey.target} (${plan.survey.targetFree ? 'libre' : 'OCUPADO'})`);
  lines.push('');
  for (const c of plan.components) {
    const mark =
      c.tier === 'selected' ? '[SELECTED]' : c.tier === 'deferred' ? '[deferred]' : '[excluded]';
    lines.push(`  ${mark} ${c.id} — ${c.title}`);
    lines.push(`      estado: ${c.state} · ${c.reason}`);
  }
  lines.push('');
  lines.push(`Plan id (SHA-256 truncado): ${plan.fingerprint}`);
  const canClone = plan.components.some((c) => c.id === 'clone-repo' && c.tier === 'selected');
  if (!canClone) {
    lines.push('No se puede clonar en este estado: resolver los prerequisitos y re-ejecutar.');
  } else {
    lines.push('Nada se ha escrito. Para clonar e instalar dependencias:');
    lines.push(
      `  npx tsx src/quickstart/bootstrap.ts --target ${plan.survey.target} --accept-plan ${plan.fingerprint}`,
    );
  }
  return lines.join('\n');
}

export interface BootstrapResult {
  clonedTo?: string;
  depsInstalled: boolean;
  nextStep: string;
}

/** Aplica el plan con token válido. Runners inyectables para test sin side effects. */
export function applyBootstrapPlan(
  plan: BootstrapPlan,
  token: string,
  runners: Record<string, (id: string) => string> = {},
): BootstrapResult {
  if (plan.fingerprint !== token.trim().toLowerCase()) {
    throw new Error(
      `token de aceptación inválido para el plan vigente (${plan.fingerprint}); re-ejecutar sin --accept-plan`,
    );
  }
  const result: BootstrapResult = { depsInstalled: false, nextStep: '' };
  for (const c of plan.components) {
    if (c.tier !== 'selected') continue;
    const runner = runners[c.id];
    if (!runner) continue;
    const out = runner(c.id);
    if (c.id === 'clone-repo') result.clonedTo = out;
    if (c.id === 'install-deps') result.depsInstalled = out === 'ok';
  }
  result.nextStep =
    'cd ' +
    (result.clonedTo ?? plan.survey.target) +
    ' && npx tsx src/quickstart/quickstart.ts   (plan operativo del clon, requiere su propia aceptación)';
  return result;
}

/**
 * True si dir (o cualquier ancestro) contiene .git — evita clonar dentro de un repo
 * existente (precedente: clone fantasma que shadoweaba git; norma AGENTS.md).
 */
export function insideGitRepo(dir: string): boolean {
  let cur = resolve(dir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(cur, '.git'))) return true;
    const parent = resolve(cur, '..');
    if (parent === cur) return false;
    cur = parent;
  }
}

function showHelp(): void {
  console.log(`Uso: npx tsx src/quickstart/bootstrap.ts [opciones]

Instalación de GV desde cero en una máquina con node/npm/git/gh.
Mismo contrato que quickstart: survey de solo lectura, plan visible,
fingerprint SHA-256, nada se escribe sin --accept-plan del plan vigente.

Opciones:
  --target <dir>      Directorio destino (default: <cwd>/gentle-vanguard si está libre)
  --repo <owner/name> Repo a clonar (default: ${DEFAULT_REPO})
  --accept-plan <sha12> Aplica clone + npm install (solo si el token coincide con el plan vigente)
  --json              Salida JSON
  --help              Esta ayuda`);
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help')) {
    showHelp();
    return;
  }
  const getOpt = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const repo = getOpt('--repo') ?? DEFAULT_REPO;
  let target = getOpt('--target');
  if (!target) {
    const candidate = join(resolve(process.cwd()), 'gentle-vanguard');
    target = existsSync(candidate) ? null : candidate;
    if (!target) {
      console.error(
        '[bootstrap] <cwd>/gentle-vanguard existe; pasar --target <dir> explícito (nunca se clona sobre algo existente).',
      );
      process.exitCode = 1;
      return;
    }
  }
  target = isAbsolute(target) ? target : resolve(process.cwd(), target);

  if (insideGitRepo(target)) {
    console.error(
      '[bootstrap] el destino está dentro de un repo git existente: NUNCA se clona anidado ' +
        '(norma AGENTS.md). Ejecutar el bootstrap desde fuera del repo o pasar --target aparte.',
    );
    process.exitCode = 1;
    return;
  }

  const survey = surveyBootstrap(target, repo);
  const plan = buildBootstrapPlan(survey);
  const wantJson = argv.includes('--json');
  const token = getOpt('--accept-plan');

  if (!token) {
    console.log(wantJson ? JSON.stringify(plan, null, 2) : formatBootstrapPlan(plan));
    return;
  }

  try {
    const cloneRunner = (): string => {
      const r = runSync('gh', ['repo', 'clone', survey.repo, target!, '--', '--depth', '1'], {
        timeout: 600000,
      });
      if (r.status !== 0) throw new Error(`gh repo clone falló (exit ${r.status})`);
      return target!;
    };
    const depsRunner = (): string => {
      const r = runSync('npm', ['install', '--no-fund', '--no-audit'], {
        timeout: 600000,
        cwd: target!,
      });
      if (r.status !== 0) throw new Error(`npm install falló (exit ${r.status})`);
      return 'ok';
    };
    const result = applyBootstrapPlan(plan, token, {
      'clone-repo': cloneRunner,
      'install-deps': depsRunner,
    });
    if (wantJson) console.log(JSON.stringify({ planId: plan.fingerprint, ...result }, null, 2));
    else {
      console.log(`Plan ${plan.fingerprint} aceptado — aplicando:\n`);
      if (result.clonedTo) console.log(`  [OK] clone-repo → ${result.clonedTo}`);
      if (result.depsInstalled) console.log('  [OK] install-deps: npm install OK');
      console.log(`\nSiguiente paso: ${result.nextStep}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (wantJson) console.log(JSON.stringify({ error: msg }, null, 2));
    else console.error(`[bootstrap] ${msg}`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && /bootstrap(\.ts)?$/i.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('[bootstrap] error no manejado:', err);
    process.exit(1);
  });
}
