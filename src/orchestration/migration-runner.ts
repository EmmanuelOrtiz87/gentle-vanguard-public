/**
 * migration-runner.ts — ejecuta la migración documental de Censor desde el stack.
 *
 * POR QUÉ (2026-11-20)
 * ---------------------------------------------------------------------------
 * El enrutador (`route-and-delegate.ts`) resuelve el destino de una migración
 * documental en lenguaje natural (área → cliente → sistema) y devuelve la
 * pregunta que falta. Cuando el destino está completo, el trabajo NO lo hace
 * el agente editorial (que redacta texto): lo hace Censor, que resuelve el nodo
 * raíz por nombre, migra su contenido al estándar A/B y prepara la publicación
 * gobernada.
 *
 * `apps/censor` es JS plano (sin tsx) y el stack es TypeScript: el CLI de
 * Censor se invoca como subproceso con `node` (mismo patrón que
 * `scripts/khorall/publish-governed.ts` — NORM-TS-001). El runner es
 * inyectable para poder testearlo sin red ni Confluence.
 *
 * El CLI encadena tres pasos: ESTRUCTURA (Censor migra al estándar A/B),
 * NARRATIVA (el agente de narración reescribe la prosa; ACTIVADA por defecto y
 * validada) y PUBLICACIÓN (el publicador gobernado). Si la raíz canónica no
 * existe, el CLI planifica su CREACIÓN (título canónico, padre del área y
 * espacio numérico).
 *
 * La publicación es SIEMPRE dry-run desde este runner: escribir en la wiki
 * exige una confirmación explícita y se hace con `--apply`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationDestination } from './migration-intent.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** Raíz del repo (src/orchestration → raíz). */
export const REPO_ROOT = resolve(MODULE_DIR, '..', '..');

/** CLI de Censor que resuelve la raíz, migra al estándar y arma el plan. */
export const MIGRATE_CLI = resolve(REPO_ROOT, 'apps', 'censor', 'scripts', 'migrate-page.mjs');

export interface MigrationRunnerIO {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MigrationRunOptions {
  /** `true` = publica; por defecto dry-run (nada se escribe en Confluence). */
  apply?: boolean;
  /** Página destino (id, enlace o título). Si falta, se busca por título canónico. */
  destination?: string;
  /** Estándar destino (A por defecto). */
  standard?: string;
  /**
   * Narrativa (agente de narración) tras la migración estructural.
   * `false` → `--no-narrative`; por defecto la narrativa va ACTIVADA.
   */
  narrative?: boolean;
  /** Padre explícito para la creación de la raíz (`--parent-id`). */
  parentId?: string;
  /** Área del catálogo (`digital` | `it`): define espacio y padre del destino. */
  area?: string;
  /** Runner inyectable (tests). */
  run?: (options: { args: string[]; cwd: string; timeoutMs?: number }) => MigrationRunnerIO;
}

export interface MigrationRunResult {
  ok: boolean;
  mode: 'dry-run' | 'apply';
  source?: { id?: string; title?: string; space?: string };
  destination?: {
    id?: string | null;
    title?: string;
    create?: boolean;
    parentId?: string | null;
    spaceId?: string | null;
    spaceKey?: string | null;
  };
  title?: string;
  standard?: string;
  sections?: number;
  planPath?: string;
  diff?: unknown;
  /** Veredicto de la narrativa: se aplicó o no, y por qué. */
  narrative?: { applied: boolean; reason?: string; chunks?: unknown };
  verification?: string | null;
  claimState?: string | null;
  semanticState?: string | null;
  consolidated?: unknown;
  error?: { code?: string; message: string };
}

/** Padre explícito: el que viene en las opciones o el que define el destino. */
function parentIdOf(
  destination: MigrationDestination,
  options: MigrationRunOptions,
): string | undefined {
  const explicit = String(options.parentId || '').trim();
  if (explicit) return explicit;
  const fromDestination = String(
    (destination as { parentPageId?: string | null }).parentPageId || '',
  ).trim();
  return fromDestination || undefined;
}

/** Argumentos del CLI de Censor para un destino ya resuelto. */
export function buildMigrateArgs(
  destination: MigrationDestination,
  options: MigrationRunOptions = {},
): string[] {
  const args = [
    MIGRATE_CLI,
    '--root',
    destination.system || destination.rootTitle,
    '--scope',
    destination.client || '',
    '--system',
    destination.system || destination.rootTitle,
    '--standard',
    options.standard || destination.standard || 'A',
  ];
  // El área define el espacio y el padre de la raíz (dato versionado del stack).
  const area = String(options.area || destination.area || '').trim();
  if (area) args.push('--area', area);
  const parentId = parentIdOf(destination, options);
  if (parentId) args.push('--parent-id', parentId);
  // Narrativa: activada por defecto; `--no-narrative` la desactiva.
  args.push(options.narrative === false ? '--no-narrative' : '--narrative');
  if (options.destination) args.push('--destination', options.destination);
  if (options.apply === true) args.push('--apply');
  return args;
}

function defaultRun({
  args,
  cwd,
  timeoutMs,
}: {
  args: string[];
  cwd: string;
  timeoutMs?: number;
}): MigrationRunnerIO {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs ?? migrationTimeoutMs(),
    env: process.env,
    windowsHide: true,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/**
 * Presupuesto del runner (2026-11-20).
 *
 * La migración encadena estructura → narrativa → publicación, y la NARRATIVA
 * llama al modelo por trozos: con la narrativa activada el CLI puede tardar
 * varios minutos (una llamada al agente por sección, con su revisión de
 * afirmaciones). Un cap de 180 s cortaba la migración EN MEDIO de la
 * narrativa y se leía como "no Narrativa aplicada" — un fallo inventado.
 *
 * Sin narrativa el CLI resuelve y arma el plan en segundos: alcanza con 3 min.
 */
export function migrationTimeoutMs(narrative = true): number {
  const envOverride = Number(process.env.MIGRATION_RUN_TIMEOUT_MS);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;
  return narrative ? 2_700_000 : 180_000;
}

/** Interpreta la salida del CLI (JSON en stdout). */
function parseOutput(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.indexOf('{');
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Ejecuta la migración de Censor con el destino resuelto.
 * Nunca escribe en Confluence salvo `apply: true`.
 */
export async function runMigration(
  destination: MigrationDestination,
  options: MigrationRunOptions = {},
): Promise<MigrationRunResult> {
  const doApply = options.apply === true;
  const mode: MigrationRunResult['mode'] = doApply ? 'apply' : 'dry-run';

  if (!destination?.system && !destination?.rootTitle) {
    return {
      ok: false,
      mode,
      error: { code: 'destination_incomplete', message: 'El destino no tiene sistema a migrar.' },
    };
  }

  const args = buildMigrateArgs(destination, options);
  let outcome: MigrationRunnerIO;
  try {
    outcome = (options.run ?? defaultRun)({
      args,
      cwd: REPO_ROOT,
      timeoutMs: migrationTimeoutMs(options.narrative !== false),
    });
  } catch (error) {
    return {
      ok: false,
      mode,
      error: { code: 'runner_failed', message: String((error as Error)?.message || error) },
    };
  }

  const parsed = parseOutput(outcome.stdout);
  if (parsed) {
    const error = parsed.error as { code?: string; message?: string } | undefined;
    const narrative = parsed.narrative as
      { applied?: boolean; reason?: string; chunks?: unknown } | undefined;
    return {
      ok: parsed.ok === true,
      mode,
      source: parsed.source as MigrationRunResult['source'],
      destination: parsed.destination as MigrationRunResult['destination'],
      title: parsed.title as string | undefined,
      standard: parsed.standard as string | undefined,
      sections: parsed.sections as number | undefined,
      planPath: parsed.planPath as string | undefined,
      diff: parsed.diff,
      narrative: narrative
        ? {
            applied: narrative.applied === true,
            reason: narrative.reason,
            chunks: narrative.chunks,
          }
        : undefined,
      verification: (parsed.verification as string | null) ?? null,
      claimState: (parsed.claimState as string | null) ?? null,
      semanticState: (parsed.semanticState as string | null) ?? null,
      consolidated: parsed.consolidated,
      error: error
        ? { code: error.code, message: error.message ?? 'Error de migración.' }
        : undefined,
    };
  }

  return {
    ok: false,
    mode,
    error: {
      code: 'unparsable_output',
      message: (outcome.stderr || outcome.stdout || 'Censor no devolvió salida interpretable.')
        .trim()
        .slice(0, 400),
    },
  };
}
