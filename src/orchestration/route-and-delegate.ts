#!/usr/bin/env node
/**
 * Route & Delegate — unified natural-language entry point.
 *
 * Takes ANY human request, recommends the best native agent from the adaptive
 * routing table (or high-priority overrides, or static fallback), then
 * delegates to the native TypeScript agent. This is the "operate with all
 * tools" bridge: one command in → recommended agent out.
 *
 * Flow:
 *   1. recommend-agent.ts  → best agent + confidence + source
 *   2. agent-delegator.ts  → run the native agent with the task
 *   3. Persist routing hit to .session/routing/hits.jsonl (feedback loop)
 *
 * Migración documental (src/orchestration/migration-intent.ts):
 *   Si el pedido activa la migración documental y falta parte del destino
 *   (área → cliente → sistema), NO se delega: se devuelve el bloque `migration`
 *   con `nextQuestion` para que el orquestador pregunte al usuario. Con el
 *   destino completo, se delega la ruta editorial con espacio, prefijo de raíz
 *   y nombre del sistema ya resueltos.
 *
 * Usage:
 *   npx tsx src/orchestration/route-and-delegate.ts --task "build a revenue forecast"
 *   npx tsx src/orchestration/route-and-delegate.ts --task "audit gdpr compliance" --context "..." --topn 3
 *
 * Output (JSON):
 *   { task, domain, recommended, confidence, source, compression: {taskSaved, ...}, delegation: {success, ...} }
 *   `migration` es opcional: solo aparece cuando el pedido activó la migración.
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { recommend } from './recommend-agent.js';
import {
  delegateWithGuardrail,
  compressDelegationLossless,
  recordDelegationCompressionSaving,
} from './agent-delegator.js';
import { resolveAgentTier } from '../sdd/domain-tier.js';
import { editorialTimeoutMs } from '../agents/editorial-provider.js';
import { parseNativeResult } from './native-result.js';
import { cmdExtract } from '../tools/document-processor.js';
import { editorialIntent } from './editorial-intent.js';
import {
  migrationDestination,
  migrationIntent,
  nextMigrationQuestion,
} from './migration-intent.js';
import { runMigration } from './migration-runner.js';
import type {
  MigrationArea,
  MigrationClient,
  MigrationDestination,
  MigrationOperation,
  MigrationQuestion,
  MigrationQuestionKey,
} from './migration-intent.js';
import { transcribeEditorialAudio } from './editorial-audio.js';
import { assessAttachments } from '../agents/attachment-guard.js';
import type { AttachmentVerdict } from '../agents/attachment-guard.js';
import { DatabaseManager, DEFAULT_TENANT_ID } from '../database/nexus/manager.js';

const ROOT = resolve(process.cwd());
const HITS_FILE = join(ROOT, '.session', 'routing', 'hits.jsonl');

interface RouteArgs {
  task: string;
  context?: string;
  sourceFiles: string[];
  language?: string;
  ocr?: boolean;
  topN: number;
  tenantId: string;
}

interface RouteResult {
  task: string;
  domain: string;
  recommended: string;
  confidence: number;
  source: string;
  tier: {
    name: string;
    temperature: number;
    hallucinationGuard: string;
  };
  delegation: {
    editorial?: ReturnType<typeof parseNativeResult>['envelope'];
    success: boolean;
    duration: number;
    model: string;
    artifactDir?: string;
    error?: string;
  };
  /** Lossless compression applied to task/context before delegation. */
  compression: {
    taskSaved: number;
    contextSaved: number;
    taskRatio: number;
    contextRatio: number;
  };
  /**
   * Veredicto del guard de adjuntos sobre el cuerpo editorial: el markup de
   * imagen no viaja con el texto, así que queda pendiente hasta que el
   * publicador gobernado copie los adjuntos (`scripts/khorall/publish-governed.ts`).
   */
  attachments?: {
    status: AttachmentVerdict['status'];
    referenced: string[];
    pending: string[];
  };
  /**
   * Bloque de migración documental. Solo aparece cuando el pedido activó la
   * migración (`src/orchestration/migration-intent.ts`). Es OPCIONAL: los
   * consumidores que no lo conocen siguen funcionando igual.
   *
   * Cuando `missing` no está vacío, NO se delegó: el orquestador tiene que
   * preguntar (`nextQuestion`). Cuando está vacío, `destination` lleva el
   * destino ya resuelto (espacio + prefijo de raíz + nombre del sistema).
   */
  migration?: {
    operation: MigrationOperation;
    area?: MigrationArea;
    client?: MigrationClient;
    system?: string;
    missing: MigrationQuestionKey[];
    nextQuestion?: MigrationQuestion;
    destination?: MigrationDestination;
  };
}

function parseArgs(argv: string[]): RouteArgs {
  const args: RouteArgs = {
    task: '',
    sourceFiles: [],
    topN: 3,
    tenantId: process.env.GENTLE_VANGUARD_TENANT_ID ?? DEFAULT_TENANT_ID,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task' && argv[i + 1]) args.task = argv[++i];
    else if (argv[i] === '--context' && argv[i + 1]) args.context = argv[++i];
    else if (argv[i] === '--source-file' && argv[i + 1]) args.sourceFiles.push(argv[++i]);
    else if (argv[i] === '--language' && argv[i + 1]) args.language = argv[++i];
    else if (argv[i] === '--ocr') args.ocr = true;
    else if (argv[i] === '--topn' && argv[i + 1]) args.topN = Number(argv[++i]);
    else if (argv[i] === '--tenant' && argv[i + 1]) args.tenantId = argv[++i];
  }
  return args;
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function persistHit(hit: Record<string, unknown>): void {
  try {
    ensureDir(join(ROOT, '.session', 'routing'));
    appendFileSync(HITS_FILE, JSON.stringify(hit) + '\n', 'utf-8');
  } catch {
    // non-blocking
  }
}

async function main(): Promise<void> {
  const { task, context, sourceFiles, language, ocr, topN, tenantId } = parseArgs(process.argv);

  if (!task) {
    console.error('Usage: --task "description" [--context "..."] [--topn N]');
    process.exit(1);
  }

  // 1. Recommend the best agent
  const rec = recommend(task, '', topN, { tenantId }) as {
    domain: string;
    recommended: string;
    confidence: number;
    source: string;
  };

  // 1b. Resolve the M6 quality tier for the recommended agent
  const tier = resolveAgentTier(rec.recommended);

  // 1c. Lossless compression of task/context (mode 'input' protects model
  //     reasoning). Falls back to the original when too short / not improved.
  const isEditorial = rec.recommended === 'editorial-agent';
  const operation = editorialIntent(task);
  const sourceFile = sourceFiles[0];
  const synthesis =
    operation === 'synthesis' || (operation === 'summary' && sourceFiles.length > 1);
  if (
    sourceFiles.length &&
    (!isEditorial ||
      context !== undefined ||
      (sourceFiles.length > 1 && !synthesis) ||
      new Set(sourceFiles.map((file) => resolve(file).toLowerCase())).size !== sourceFiles.length)
  ) {
    console.log(
      JSON.stringify({
        success: false,
        error:
          'Usá archivos distintos, sin --context. Para varios archivos, pedí un resumen o una síntesis.',
      }),
    );
    process.exitCode = 1;
    return;
  }
  // Migración documental: si falta parte del destino NO se delega. Se devuelve
  // la pregunta para que el orquestador la haga al usuario y siga iterando
  // (área → cliente → sistema) sin volver a preguntar lo ya dicho.
  const migration = migrationIntent(task);
  if (migration && migration.missing.length > 0) {
    const askResult: RouteResult = {
      task,
      domain: rec.domain,
      recommended: rec.recommended,
      confidence: rec.confidence,
      source: rec.source,
      tier: {
        name: tier.tier,
        temperature: tier.temperature,
        hallucinationGuard: tier.hallucinationGuard,
      },
      compression: { taskSaved: 0, contextSaved: 0, taskRatio: 1, contextRatio: 1 },
      delegation: {
        success: false,
        duration: 0,
        model: '',
        error: 'migration_needs_input',
      },
      migration: {
        operation: migration.operation,
        area: migration.area,
        client: migration.client,
        system: migration.system,
        missing: migration.missing,
        nextQuestion: nextMigrationQuestion(migration),
      },
    };
    console.log(JSON.stringify(askResult, null, 2));
    return;
  }

  // Destino ya resuelto: la ruta editorial recibe espacio, prefijo de raíz y
  // nombre del sistema, para que la página raíz salga como "[PREFIJO] - Sistema".
  const destination = migration ? migrationDestination(migration) : undefined;

  // Migración documental con destino completo: la EJECUTA Censor (resuelve el
  // nodo raíz por nombre, migra al estándar y prepara la publicación
  // gobernada). No se delega al agente editorial: ese agente redacta texto y
  // no reconoce la operación de migración.
  if (migration && destination) {
    const execution = await runMigration(destination, {
      apply: process.env.GV_MIGRATION_APPLY === '1',
    });
    console.log(
      JSON.stringify(
        {
          task,
          domain: rec.domain,
          recommended: rec.recommended,
          confidence: rec.confidence,
          source: rec.source,
          delegation: {
            success: execution.ok,
            duration: 0,
            model: '',
            error: execution.ok ? '' : (execution.error?.message ?? 'migration_failed'),
          },
          compression: { taskSaved: 0, contextSaved: 0, taskRatio: 1, contextRatio: 1 },
          migration: {
            operation: migration.operation,
            area: migration.area,
            client: migration.client,
            system: migration.system,
            missing: migration.missing,
            destination,
            execution,
          },
        },
        null,
        2,
      ),
    );
    if (!execution.ok) process.exitCode = 1;
    return;
  }

  const delegatedTask = destination
    ? `${task}\n\nDestino de la migración documental: sitio ${destination.site}, espacio ${destination.space}${
        destination.spaceName ? ` (${destination.spaceName})` : ''
      }, cliente ${destination.client}, prefijo de raíz "${destination.prefix}", sistema "${destination.system}", estándar ${destination.standard}. Título de la página raíz: "${destination.rootTitle}". El prefijo va solo en la página raíz; las páginas hijas conservan su nombre.`
    : task;

  if (isEditorial && sourceFile && !context && editorialIntent(task) === 'transcription') {
    try {
      const output = await transcribeEditorialAudio(sourceFile, language ?? 'es');
      persistHit({
        timestamp: new Date().toISOString(),
        operation: 'transcription',
        source: rec.source,
        success: true,
        provider: output.provider,
        verification: output.verification,
      });
      console.log(
        JSON.stringify({ success: true, operation: 'transcription', ...output }, null, 2),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          success: false,
          operation: 'transcription',
          error:
            error instanceof Error ? error.message.split(': HTTP')[0] : 'No se pudo transcribir',
        }),
      );
      process.exitCode = 1;
    }
    return;
  }
  const extractions = await Promise.all(sourceFiles.map((file) => cmdExtract(file, { ocr })));
  const sourceWarnings = extractions.flatMap((result, index) =>
    (result.warnings ?? []).map((warning) => `F${index + 1}: ${warning}`),
  );
  if (
    (synthesis && sourceFiles.length < 2 && !context) ||
    extractions.some((result) => !result.success || !result.text?.trim())
  ) {
    console.log(
      JSON.stringify({
        success: false,
        error: 'Se requiere texto legible de cada archivo y al menos dos fuentes para sintetizar.',
        extractionErrors: extractions.flatMap((result, index) =>
          (result.errors ?? []).map((error) => `F${index + 1}: ${error}`),
        ),
        sourceWarnings,
      }),
    );
    process.exitCode = 1;
    return;
  }
  const extractedContext =
    synthesis && sourceFiles.length
      ? JSON.stringify(
          extractions.map((result, index) => ({
            id: `F${index + 1}`,
            name: basename(sourceFiles[index]),
            text: result.text,
          })),
        )
      : extractions[0]?.text;
  const taskC = isEditorial ? null : compressDelegationLossless(task);
  const contextC = !isEditorial && context ? compressDelegationLossless(context) : null;
  if (taskC)
    recordDelegationCompressionSaving(taskC, {
      label: 'task',
      source: `route-and-delegate:${rec.recommended}`,
    });
  recordDelegationCompressionSaving(contextC, {
    label: 'context',
    source: `route-and-delegate:${rec.recommended}`,
  });

  // 2. Delegate natively — pass the M6 tier temperature override so the
  //    agent actually runs with the domain quality tier (premium: low temp /
  //    hallucination guard; fastCheap: higher temp), not the hardcoded default.
  //    Uses delegateWithGuardrail() so failures are classified, recorded as
  //    incidents, and surfaced with corrective guidance instead of blind retry.
  //    GB-20261120 S3: la delegación editorial pide su propio timeout al
  //    delegador — generación + revisión encadenadas exceden el presupuesto de
  //    una sola generación bajo el default global (600 s).
  const result = await delegateWithGuardrail({
    agent: rec.recommended,
    task:
      synthesis && operation === 'summary'
        ? `Sintetiza las fuentes. Pedido original: ${task}`
        : taskC?.applied
          ? taskC.text
          : delegatedTask,
    context: extractedContext ?? (contextC?.applied ? contextC.text : context),
    temperature: tier.temperature,
    probe: process.env.GV_DELEGATION_PROBE === '1',
    ...(isEditorial
      ? { timeoutSeconds: editorialDelegationTimeoutSeconds(operation ?? 'draft') }
      : {}),
  });

  // El envelope del helper nativo se parsea una vez para todo el recibo (GB-20261120
  // S8): editorial lo consume como `editorial`; el tipo de evidencia (evidenceKind)
  // viaja en el recibo de cualquier agente que lo declare en su envelope.
  const nativeEnvelope = parseNativeResult(result.output ?? '').envelope as
    (Record<string, unknown> & { evidenceKind?: unknown }) | undefined;
  const editorial = isEditorial
    ? (nativeEnvelope as
        (NonNullable<RouteResult['delegation']['editorial']> & Record<string, unknown>) | undefined)
    : undefined;
  const evidenceKind =
    typeof nativeEnvelope?.evidenceKind === 'string'
      ? nativeEnvelope.evidenceKind
      : isEditorial
        ? 'editorial-envelope'
        : undefined;
  const effectiveModel = typeof editorial?.model === 'string' ? editorial.model : result.model;
  // Guard de adjuntos (incidente 2026-11-20): si el cuerpo editorial trae markup
  // de imagen, sus adjuntos no viajan con el texto. Queda declarado en el recibo;
  // el bloqueo real ocurre en el publicador gobernado, antes del PUT.
  const editorialText =
    editorial && typeof editorial.output === 'object' && editorial.output !== null
      ? String((editorial.output as { text?: unknown }).text ?? '')
      : '';
  const attachmentGuard = editorialText
    ? assessAttachments(editorialText, [], { strict: false })
    : undefined;
  const routeResult: RouteResult = {
    task,
    domain: rec.domain,
    recommended: rec.recommended,
    confidence: rec.confidence,
    source: rec.source,
    tier: {
      name: tier.tier,
      temperature: tier.temperature,
      hallucinationGuard: tier.hallucinationGuard,
    },
    compression: {
      taskSaved: taskC?.saved ?? 0,
      contextSaved: contextC?.saved ?? 0,
      taskRatio: taskC?.ratio ?? 1,
      contextRatio: contextC?.ratio ?? 1,
    },
    delegation: {
      editorial,
      success: result.success,
      duration: result.duration,
      model: effectiveModel,
      artifactDir: extractArtifactDir(result.output),
      error: result.error,
    },
  };
  if (sourceWarnings.length) {
    Object.assign(routeResult, { sourceWarnings });
  }
  if (migration) {
    routeResult.migration = {
      operation: migration.operation,
      area: migration.area,
      client: migration.client,
      system: migration.system,
      missing: migration.missing,
      nextQuestion: migration.nextQuestion,
      destination,
    };
  }
  if (attachmentGuard && attachmentGuard.referenced.length) {
    routeResult.attachments = {
      status: attachmentGuard.status,
      referenced: attachmentGuard.referenced,
      pending: attachmentGuard.missing,
    };
  }

  // 3. Feedback loop: persist routing hit for the adaptive router
  persistHit({
    timestamp: new Date().toISOString(),
    task: isEditorial ? undefined : task,
    domain: rec.domain,
    agent: rec.recommended,
    confidence: rec.confidence,
    source: rec.source,
    success: result.success,
    duration: result.duration,
    // Sin el error, un recibo fallido no se puede clasificar después (routing-eval
    // midió 21 fallos editoriales como 'sin_dato' por recibos sin causa).
    error: result.success ? undefined : (result.error ?? 'sin detalle').slice(0, 300),
    evidenceKind,
    editorial: isEditorial
      ? {
          operation: editorial?.operation,
          executionKind: editorial?.executionKind,
          llmCalled: editorial?.llmCalled,
          instructions: editorial?.instructions,
          sourceSha256: editorial?.sourceSha256,
          sourceCount: sourceFiles.length || undefined,
          verification: editorial?.verification,
          model: effectiveModel,
          attemptedModel: result.model,
          failedModels: editorial?.failedModels,
          providerFailures: editorial?.providerFailures,
          reasoningEffort: editorial?.reasoningEffort,
        }
      : undefined,
    attachments: routeResult.attachments
      ? {
          status: routeResult.attachments.status,
          referenced: routeResult.attachments.referenced,
        }
      : undefined,
  });
  recordRoutingOutcome(rec.domain, rec.recommended, result.success, tenantId);

  console.log(JSON.stringify(routeResult, null, 2));

  if (!result.success) {
    process.exitCode = 1;
  }
}

interface RoutingOutcomeSink {
  recordRoutingOutcome(pattern: string, target: string, success: boolean, tenantId: string): void;
}

function recordRoutingOutcome(
  pattern: string,
  target: string,
  success: boolean,
  tenantId = DEFAULT_TENANT_ID,
  sink?: RoutingOutcomeSink,
): void {
  try {
    (sink ?? DatabaseManager.getInstance()).recordRoutingOutcome(
      pattern,
      target,
      success,
      tenantId,
    );
  } catch {
    // Persistence must not change delegation behavior.
  }
}

function extractArtifactDir(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const m = output.match(/Artifacts persisted[\s\S]{0,40}?([A-Za-z]:\\[^\n]+)/);
  return m ? m[1].trim() : undefined;
}

/**
 * GB-20261120 S3 — presupuesto de delegación editorial para el delegador.
 * Cubre el PEOR caso de la ruta: generación + revisión encadenadas con el
 * presupuesto local (el más generoso); si el camino nube termina antes, el
 * timeout no cuesta nada. +30 s de margen para extracción/parseo.
 */
export function editorialDelegationTimeoutSeconds(operation: string): number {
  const worstCaseMs = 2 * editorialTimeoutMs(operation, 'ollama/local');
  return Math.ceil(worstCaseMs / 1000) + 30;
}

// Guard: only run as CLI; allow import as module
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

export { recommend, persistHit, extractArtifactDir, recordRoutingOutcome };
export type { RouteResult };
