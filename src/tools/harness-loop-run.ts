#!/usr/bin/env node
/**
 * harness-loop-run.ts — Operador del bucle de evolucion del harness.
 *
 * Corre el bucle Propose-Probe-Compose (src/core/harness-loop.ts) sobre un
 * dominio y una tarea, usando el substrate de opencode. Es el comando que
 * hace operable el metodo: sin el, el bucle seria una libreria que nadie
 * puede ejecutar.
 *
 * Uso:
 *   node --import tsx src/tools/harness-loop-run.ts --task-file <archivo> --domain <dominio> \
 *        --proposal-a <dir> --proposal-b <dir> [--k 1] [--dry-run] [--json]
 *
 *   --task-file   archivo con el texto de la tarea (o --task "texto")
 *   --domain      dominio de trabajo (kebab-case); agrupa la experiencia
 *   --proposal-a  directorio con la edicion INVARIANTE (se superpone al harness)
 *   --proposal-b  directorio con la edicion DE DOMINIO
 *   --k           k del bucle (default 1 -> 4 rollouts, 3 sesiones)
 *   --dry-run     muestra el plan y el ledger esperado sin llamar al modelo
 *   --no-adopt    corre el bucle pero no adopta ni escribe en la biblioteca
 *   --json        salida machine-readable
 *
 * El presupuesto es auditable: el ledger verifica R = 4k y P = 3k antes de
 * cerrar la corrida, y falla si una etapa se duplica.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { GV_SURFACE, readSurfaceTree } from '../core/harness-surface.js';
import {
  createModelSelector,
  createOpencodeSubstrate,
  proposalFromDirectory,
  proposalFromEdits,
  runHarnessLoop,
  type HarnessTree,
} from '../core/harness-loop.js';
import { nexusDbPath } from '../knowledge/experience-library.js';
import { createOllamaSubstrate, DEFAULT_OLLAMA_MODEL } from '../eval/ollama-substrate.js';
import { createOllamaAgentSubstrate } from '../eval/ollama-agent-substrate.js';
import { createCliAgentSubstrate } from '../eval/cli-agent-substrate.js';
import type { JudgeSpec } from '../eval/harness-judge.js';
import type { LedgerMode } from '../eval/harness-ledger.js';

const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');

/** Entry JS del CLI de codex instalado global (prefix de npm del usuario). */
function resolveCodexEntry(): string {
  const prefix = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming');
  const entry = join(prefix, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (!existsSync(entry)) {
    throw new Error(
      `codex CLI no encontrado en ${entry}. Instalarlo con: npm i -g @openai/codex`
    );
  }
  return entry;
}

/** Lee un flag con valor. */
function arg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function flag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function usage(): void {
  process.stdout.write(
    [
      'harness-loop-run — bucle Propose-Probe-Compose del harness',
      '',
      '  --task-file <archivo>   texto de la tarea',
      '  --task <texto>          texto de la tarea en linea',
      '  --domain <dominio>      dominio de trabajo (kebab-case)',
      '  --proposal-a <dir>      edicion invariante (superpuesta al harness)',
      '  --proposal-b <dir>      edicion de dominio (superpuesta al harness)',
      '  --k <n>                 k del bucle (default 1)',
      '  --mode <agg|seq>        agg: composiciones independientes (ancho) |',
      '                           seq: las composiciones acumulan (profundo)',
      '  --judge-file <json>      checks del juez, evaluados DESPUES de la seleccion',
      '  --semantic-judge        un modelo verifica el cumplimiento de cada regla',
      '  --propose auto          el proposer genera las reglas (no usan --proposal-a/b)',
      '  --substrate <tipo>      ollama | ollama-agent (con herramientas de lectura) | opencode | codex',
      '  --codex-model <modelo>  modelo de codex CLI (default gpt-6-luna)',
      '  --ollama-model <modelo> modelo local (default qwen2.5-coder:7b)',
      '  --ollama-url <url>      servidor Ollama (default http://127.0.0.1:11434)',
      '  --temperature <n>      temperatura de muestreo (0 = corrida reproducible)',
      '  --model <provider/model> modelo de opencode (por defecto, el del repo)',
      '  --dry-run               plan y ledger esperado, sin llamar al modelo',
      '  --no-adopt              no adopta ni escribe en la biblioteca',
      '  --json                  salida machine-readable',
      '',
    ].join('\n')
  );
}

async function main(): Promise<number> {
  if (flag('help') || process.argv.length <= 2) {
    usage();
    return 0;
  }

  const taskFile = arg('task-file');
  const taskInline = arg('task');
  const task = taskFile
    ? existsSync(resolve(ROOT, taskFile))
      ? readFileSync(resolve(ROOT, taskFile), 'utf-8')
      : ''
    : (taskInline ?? '');
  if (!task.trim()) {
    process.stderr.write('Falta la tarea: usa --task-file o --task.\n');
    usage();
    return 2;
  }

  const domain = arg('domain');
  if (!domain) {
    process.stderr.write('Falta --domain.\n');
    return 2;
  }

  const proposalA = arg('proposal-a');
  const proposalB = arg('proposal-b');
  const autoPropose = arg('propose') === 'auto';
  if (!autoPropose && (!proposalA || !proposalB)) {
    process.stderr.write(
      'Faltan --proposal-a y --proposal-b (invariante y de dominio), o usa --propose auto.\n'
    );
    return 2;
  }

  const k = Number(arg('k') ?? '1');
  if (!Number.isInteger(k) || k < 1) {
    process.stderr.write('--k debe ser un entero >= 1.\n');
    return 2;
  }

  const dryRun = flag('dry-run');
  const adopt = !flag('no-adopt');
  const asJson = flag('json');

  const baseTree: HarnessTree = readSurfaceTree(GV_SURFACE, ROOT);
  const basePrompt = baseTree['AGENTS.md'] ?? '';

  // Con `--propose auto` el proposer genera las reglas: las propuestas
  // externas son solo el plan B (si el proposer falla, se usan).
  const proposals = autoPropose
    ? [
        proposalFromEdits(
          'invariante',
          'invariant',
          'Propuesta transversal generada por el proposer automatico',
          {}
        ),
        proposalFromEdits(
          'dominio',
          'domain',
          'Propuesta de dominio generada por el proposer automatico',
          {}
        ),
      ]
    : [
        proposalFromDirectory(
          'invariante',
          'invariant',
          `Edicion invariante desde ${proposalA}`,
          resolve(ROOT, proposalA as string)
        ),
        proposalFromDirectory(
          'dominio',
          'domain',
          `Edicion de dominio desde ${proposalB}`,
          resolve(ROOT, proposalB as string)
        ),
      ];

  if (dryRun) {
    const plan = {
      taskId: `${domain}-${k}`,
      domain,
      k,
      modo: 'agg',
      rolloutsEsperados: 4 * k,
      sesionesEsperadas: 3 * k,
      poolEsperado: 3 * k,
      superficie: {
        archivos: Object.keys(baseTree).length,
        alwaysOnChars: basePrompt.length,
      },
      propuestas: proposals.map((p) => ({ label: p.label, kind: p.kind, descripcion: p.description })),
      nota: 'dry-run: no se llamo al modelo ni se escribio en la biblioteca.',
    };
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }

  const outDir = join(ROOT, '.runtime', 'harness-loop', `${domain}-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  const workDir = join(outDir, 'work');
  mkdirSync(workDir, { recursive: true });

  const dbPath = nexusDbPath(ROOT);
  const db = existsSync(dbPath) ? new Database(dbPath) : null;

  // Checks del juez: se evaluan DESPUES de la seleccion, nunca antes.
  const judgeFile = arg('judge-file');
  const judgeSpec: JudgeSpec | undefined = judgeFile
    ? (JSON.parse(readFileSync(resolve(ROOT, judgeFile), 'utf-8')) as JudgeSpec)
    : undefined;

  try {
  const model = arg('model');
  const substrateKind = arg('substrate') ?? (model ? 'opencode' : 'ollama');
  const substrate =
    substrateKind === 'ollama-agent'
      ? createOllamaAgentSubstrate({
          model: arg('ollama-model') ?? DEFAULT_OLLAMA_MODEL,
          baseUrl: arg('ollama-url'),
          temperature: arg('temperature') ? Number(arg('temperature')) : undefined,
          maxSteps: arg('max-steps') ? Number(arg('max-steps')) : undefined,
          root: ROOT,
        })
      : substrateKind === 'ollama'
        ? createOllamaSubstrate({
            model: arg('ollama-model') ?? DEFAULT_OLLAMA_MODEL,
            baseUrl: arg('ollama-url'),
            temperature: arg('temperature') ? Number(arg('temperature')) : undefined,
          })
      : substrateKind === 'codex'
        ? createCliAgentSubstrate({
            // CLI headless con eventos JSONL. read-only: la variante puede VER
            // el repo pero no modificarlo (control experimental). Sin config
            // de usuario: ni hooks ni autostart por rollout (costo y ruido).
            // El entry es el JS del paquete global via node: spawn directo de
            // `codex` falla (shim .cmd sin shell) y el .exe da EPERM.
            command: [
              process.execPath,
              resolveCodexEntry(),
              'exec', '--json', '--ignore-user-config',
              '--skip-git-repo-check', '-C', ROOT,
              '-m', arg('codex-model') ?? 'gpt-6-luna',
              '-s', 'read-only',
            ],
            root: ROOT,
          })
      : createOpencodeSubstrate({
          configPath: join(ROOT, 'opencode.json'),
          model,
          // El proyecto es la raiz del repo: opencode se cuelga al arrancar en
          // un directorio NUEVO (se queda en el bootstrap).
          projectDir: ROOT,
        });

    const result = await runHarnessLoop({
      taskId: `${domain}-${k}`,
      domain,
      task,
      k,
      mode: (arg('mode') as LedgerMode | undefined) ?? 'agg',
      baseTree,
      basePrompt,
      proposals,
      substrate,
      // Con modelo configurado, la comparacion la hace el modelo: sin el, el
      // selector es el fallback determinista (elige siempre la primera).
      selector: substrateKind === 'ollama' || substrateKind === 'codex' || model
        ? createModelSelector({
            substrate,
            variantName: `selector-${domain}-${k}`,
          })
        : undefined,
      judge: judgeSpec,
      semanticJudge: flag('semantic-judge')
        ? {
            // El juez usa un modelo DISTINTO del que ejecuta, y por defecto uno
            // mas capaz: se midio que el mismo 7b que ejecuta el entregable
            // da falsos negativos como juez (con la regla correcta en la
            // entrada, el 7b dijo NO CUMPLE de un entregable que si cumplia;
            // el 14b dijo CUMPLE). El rol de juez exige mas capacidad que el
            // rol de ejecutor.
            substrate: createOllamaSubstrate({
              model: arg('judge-model') ?? 'qwen2.5-coder:14b',
              baseUrl: arg('ollama-url'),
              temperature: 0,
            }),
            timeoutMs: 300_000,
          }
        : undefined,
      proposer: arg('propose') === 'auto'
        ? {
            substrate,
            domain,
            allowedPaths: ['rules/', 'skills/', 'AGENTS.md'],
            context: {
              'rules/NORMATIVAS-CODE-QUALITY.md': readFileSync(
                join(ROOT, 'rules', 'NORMATIVAS-CODE-QUALITY.md'),
                'utf-8'
              ),
            },
          }
        : undefined,
      workDir,
      outDir,
      repoRoot: ROOT,
      db: adopt && db ? db : undefined,
    });

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            runId: result.runId,
            domain: result.domain,
            k: result.k,
            ledger: result.ledger,
            pool: {
              candidatas: result.pool.candidates.map((c) => c.id),
              descartadas: result.pool.dropped,
              semilla: result.pool.seed,
            },
            tripwire: result.tripwire,
            diversidad: result.diversity,
            juez: result.judge,
            juezSemantico: result.juezSemantico,
            supportCalls: result.supportCalls,
            seleccion: {
              elegida: result.selection.selectedLabel,
              via: result.selection.via,
              razon: result.selection.why,
              respuestaCruda: result.selection.raw,
            },
            adoptado: result.adopted,
            experiencia: result.experience,
            outDir: result.outDir,
          },
          null,
          2
        )}\n`
      );
    } else {
      const s = result.ledger;
      process.stdout.write(
        [
          `harness-loop — ${result.runId}`,
          `  dominio: ${result.domain}   k: ${result.k}   modo: ${result.mode}`,
          `  ledger: ${s.rollouts}/${s.expectedRollouts} rollouts, ${s.sessions}/${s.expectedSessions} sesiones, identidad=${s.identityHolds ? 'OK' : 'ROTA'}`,
          `  pool: ${result.pool.candidates.map((c) => c.id).join(', ')} (semilla ${result.pool.seed.slice(0, 12)})`,
          `  descartadas: ${result.pool.dropped.length}`,
          // Descartar sin causa convierte un sesgo en un misterio (metodo).
          ...result.pool.dropped.map((d) => `    descartada ${d.label}: ${d.cause}`),
          `  tripwire: ${result.tripwire.violations.length} fugas, ${result.tripwire.warnings.length} avisos, ${result.tripwire.exempted.length} exenciones`,
          ...result.tripwire.violations.map((v) => `    FUGA ${v}`),
          ...result.tripwire.warnings.map((w) => `    aviso ${w}`),
          `  seleccion: ${result.selection.selectedLabel ?? '(ninguna)'} via ${result.selection.via}`,
          `  reason: ${result.selection.why ?? '-'}`,
          ...(result.diversity
            ? [
                `  diversidad: ediciones J=${result.diversity.ediciones.meanLineJaccard} (${result.diversity.ediciones.nDistinct}/${result.diversity.ediciones.n}) | artefactos J=${result.diversity.artefactos.meanLineJaccard} (${result.diversity.artefactos.nDistinct}/${result.diversity.artefactos.n})`,
              ]
            : []),
          ...(result.judge
            ? [
                `  juez (post-seleccion): ${result.judge.resumen.ok}/${result.judge.resumen.total} cumplen`,
                ...result.judge.verdicts.map(
                  (v) =>
                    `    ${v.label} [${v.kind}] ${v.ok ? 'OK' : 'FALLA'} ${v.failed.join('; ')}`
                ),
              ]
            : []),
          ...(result.juezSemantico
            ? [
                `  juez semantico: ${result.juezSemantico.filter((v) => v.complies).length}/${result.juezSemantico.length} cumplen`,
                ...result.juezSemantico.map(
                  (v) => `    ${v.label} [${v.kind}] ${v.complies ? 'CUMPLE' : 'NO CUMPLE'} ${v.why}`
                ),
              ]
            : []),
          `  llamadas de apoyo: proposer=${result.supportCalls.proposer} selector=${result.supportCalls.selector} juezSemantico=${result.supportCalls.semanticJudge} (no cuentan en el presupuesto de 4k)`,
          `  adoptado: ${result.adopted ? 'si' : 'no'}`,
          `  salidas: ${result.outDir}`,
          '',
        ].join('\n')
      );
    }
    return result.ledger.identityHolds && result.ledger.stageCountsHolds ? 0 : 1;
  } finally {
    db?.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
