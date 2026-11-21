#!/usr/bin/env node
/**
 * e2e-agent — implementación nativa determinista (NORM-E2E-001).
 *
 * Ejecuta el smoke E2E real de una app (`apps/<app>/tests/e2e-smoke.*`), captura
 * la evidencia en `.session/e2e-<app>-<timestamp>.log` y devuelve un envelope
 * honesto (`=== JSON OUTPUT ===`): un helper que solo preparó el comando NO es
 * éxito — el smoke debe salir con 0 FAIL.
 *
 * Es el helper que hace al e2e-agent alcanzable desde la cadena del orquestador
 * (route-and-delegate → agent-delegator → este script), no solo desde el host
 * interactivo. GB-20261120 S6.
 *
 * Determinista: NO llama a un LLM. El host (sesión interactiva) usa su propio
 * agente e2e-agent (host-only) para trabajo de análisis; este helper ejecuta.
 */
import { existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runSync } from '../core/run-command.js';

function emit(result: { success: boolean } & Record<string, unknown>): void {
  console.log('=== JSON OUTPUT ===');
  console.log(JSON.stringify(result));
  if (!result.success) process.exitCode = 1;
}

export interface E2eTarget {
  app: string;
  script: string;
}

/** Extensión del smoke por orden de preferencia (NORM-E2E-001: ps1/ts/py según stack). */
const SMOKE_EXTENSIONS = ['.ts', '.mts', '.mjs', '.js'] as const;

/** Resuelve la app y su smoke desde el texto de la tarea. Exportado para test. */
export function resolveE2eTarget(
  task: string,
  root: string,
): E2eTarget | { clarification: string } {
  const appsDir = join(root, 'apps');
  if (!existsSync(appsDir))
    return { clarification: 'No existe el directorio apps/. ¿Qué app hay que validar?' };
  const apps = readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
  const mentioned = apps.filter((app) =>
    new RegExp(`\\b${app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(task),
  );
  if (mentioned.length === 0) {
    return {
      clarification: `¿Qué app hay que validar con el smoke E2E? Apps con smoke disponible o app nueva: ${apps.slice(0, 12).join(', ')}…`,
    };
  }
  if (mentioned.length > 1) {
    return {
      clarification: `La tarea menciona varias apps (${mentioned.join(', ')}): ¿cuál validar? Una app por delegación.`,
    };
  }
  const app = mentioned[0];
  for (const ext of SMOKE_EXTENSIONS) {
    const script = join(appsDir, app, 'tests', `e2e-smoke${ext}`);
    if (existsSync(script)) return { app, script };
  }
  return {
    clarification: `La app '${app}' no tiene tests/e2e-smoke.{ts,mjs,js}. NORM-E2E-001 exige uno antes de declararla homologada: crearlo primero.`,
  };
}

function run(): void {
  const { values } = parseArgs({
    options: {
      task: { type: 'string' },
      model: { type: 'string' },
      temperature: { type: 'string' },
      app: { type: 'string' },
    },
  });
  const task = values.task ?? '';
  const root = process.cwd();
  const startedAt = Date.now();

  const target = values.app
    ? resolveE2eTarget(values.app, root) // el override explícito menciona la app por nombre
    : resolveE2eTarget(task, root);
  if ('clarification' in target) {
    emit({
      success: false,
      executionKind: 'e2e-smoke',
      needsClarification: true,
      nextQuestion: target.clarification,
    });
    return;
  }

  const { app, script } = target;
  const isTs = /\.(ts|mts)$/.test(script);
  const command = process.execPath;
  const args = isTs ? ['--import', 'tsx', script] : [script];

  const evidenceDir = join(root, '.session');
  mkdirSync(evidenceDir, { recursive: true });
  const logPath = join(
    evidenceDir,
    `e2e-${app}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
  );
  const lines: string[] = [
    `# e2e-agent · app=${app} · script=${script}`,
    `started=${new Date().toISOString()} task=${task.slice(0, 200)}`,
  ];

  // El smoke define su puerto aislado y runtime dir (NORM-E2E-001 §requisitos);
  // el helper no adivina puertos ni muta envs de la app.
  const run = runSync(command, args, { cwd: root, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  lines.push(...(run.stdout ?? '').split('\n'));
  if (run.stderr) lines.push('--- stderr ---', ...run.stderr.split('\n'));
  lines.push(`exit=${run.status}`);
  appendFileSync(logPath, lines.join('\n') + '\n');

  // Evidencia dual: NORM-E2E-001 define "=== RESULTADO: X OK / Y FAIL ===", y los
  // smokes que corren sobre node:test (gv-agenda, kairos-agenda) reportan con el
  // resumen ℹ pass/fail. Ambos formatos son evidencia válida.
  const resultado = /=== RESULTADO:\s*(\d+) OK\s*\/\s*(\d+) FAIL ===/.exec(run.stdout ?? '');
  const nodeTest = /ℹ fail\s+(\d+)/.exec(run.stdout ?? '');
  const nodePass = /ℹ pass\s+(\d+)/.exec(run.stdout ?? '');
  const pass = resultado ? Number(resultado[1]) : nodePass ? Number(nodePass[1]) : 0;
  const fail = resultado ? Number(resultado[2]) : nodeTest ? Number(nodeTest[1]) : undefined;
  const timedOut = run.status === null || run.status === undefined;
  const success =
    !timedOut && run.status === 0 && pass > 0 && (fail === undefined ? false : fail === 0);

  emit({
    success,
    executionKind: 'e2e-smoke',
    llmCalled: false,
    evidenceKind: 'e2e-smoke-log',
    app,
    script,
    logPath,
    exitCode: run.status ?? undefined,
    pass,
    fail,
    durationMs: Date.now() - startedAt,
    error: success
      ? undefined
      : timedOut
        ? 'El smoke no terminó (timeout 600s). Evidencia en ' + logPath
        : `El smoke salió con exit ${run.status} (RESULTADO: ${pass} OK / ${fail ?? '?'} FAIL). Evidencia en ${logPath}`,
  });
}

// Guard CLI por URL del módulo (idioma de route-and-delegate): correr solo si
// este archivo ES el proceso principal. Un substring-match con el nombre caería
// con archivos que lo contienen (p. ej. tests/unit/e2e-agent.test.ts).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
