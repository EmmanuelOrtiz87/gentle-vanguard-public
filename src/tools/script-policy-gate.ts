#!/usr/bin/env node
/**
 * script-policy-gate.ts — NORM-TS-001 con alcance declarado + wiring del guardrail de destruccion.
 *
 * Cierra dos hallazgos P3 del audit 2026-11-17:
 * - F14: `harness:doctor` solo mira la superficie editable (AGENTS.md, skills/, rules/,
 *   scripts/, src/agents); los .ps1 versionados en apps/ y docs/ quedaban invisibles. Este
 *   gate inventaria TODOS los .ps1 versionados y exige que cada uno viva bajo una excepcion
 *   declarada con su razon. Un .ps1 nuevo fuera de la lista falla: el silencio deja de ser
 *   una excepcion implicita.
 * - F15: el guardrail de destruccion (untracked-snapshot) corre como step de autostart, no
 *   como veto de push: borra archivos del workspace, no del remoto, asi que un hook de push
 *   no lo puede interceptar. Lo que si puede verificarse es que el wiring no desaparezca en
 *   silencio: script npm, step de autostart habilitado, destino del snapshot y referencia en
 *   la normativa de autonomia.
 *
 * Uso:
 *   node --import tsx src/tools/script-policy-gate.ts            # reporte
 *   node --import tsx src/tools/script-policy-gate.ts --check    # exit 1 si hay violaciones
 *   node --import tsx src/tools/script-policy-gate.ts --json
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Ps1Exception {
  prefix: string;
  reason: string;
}

/**
 * Excepciones sancionadas por NORM-TS-001. Solo estas rutas pueden contener .ps1
 * versionados; cualquier otra es una violacion del gate.
 */
export const PS1_EXCEPTIONS: readonly Ps1Exception[] = [
  {
    prefix: '.archive/',
    reason: 'historia congelada: no se ejecuta, se conserva para trazabilidad',
  },
  {
    prefix: 'apps/wpp-bot/scripts/',
    reason:
      'app de cliente (wpp-bot): install.ps1 es bootstrap previo a Node (Scheduled Task como SYSTEM, no hay runtime para un .ts); el ex-sandbox se migro a scripts/sandbox.ts',
  },
  {
    prefix: 'docs/presentations/decks/build/',
    reason:
      'toolchain heredado de exportacion de decks (automatizacion COM de PowerPoint), previo a NORM-TS-001',
  },
];

export interface ScriptPolicyReport {
  tracked: number;
  violations: string[];
  exceptions: { prefix: string; files: number; reason: string }[];
}

/** Un .ps1 es valido solo si cae bajo una excepcion declarada. */
export function checkPs1Inventory(
  paths: readonly string[],
  exceptions: readonly Ps1Exception[] = PS1_EXCEPTIONS,
): ScriptPolicyReport {
  const normalized = paths.map((p) => p.replace(/\\/g, '/'));
  const violations = normalized.filter(
    (path) => !exceptions.some((exception) => path.startsWith(exception.prefix)),
  );
  const used = exceptions
    .map((exception) => ({
      prefix: exception.prefix,
      reason: exception.reason,
      files: normalized.filter((path) => path.startsWith(exception.prefix)).length,
    }))
    .filter((exception) => exception.files > 0);
  return { tracked: normalized.length, violations, exceptions: used };
}

export interface DestructionGuardInput {
  packageScripts: Record<string, string | undefined>;
  autostartSteps: ReadonlyArray<{ id?: string; script?: string; enabled?: boolean }>;
  snapshotSource: string;
  normText: string;
}

const SNAPSHOT_SCRIPT = 'src/ops/untracked-snapshot.ts';

/** El guardrail existe de verdad si script, step, destino y normativa estan conectados. */
export function checkDestructionGuardWiring(input: DestructionGuardInput): string[] {
  const problems: string[] = [];
  const script = input.packageScripts['guard:snapshot'];
  if (!script || !script.includes(SNAPSHOT_SCRIPT)) {
    problems.push(
      `package.json: el script "guard:snapshot" no existe o no ejecuta ${SNAPSHOT_SCRIPT}`,
    );
  }
  const step = input.autostartSteps.find((candidate) => candidate.script === SNAPSHOT_SCRIPT);
  if (!step) {
    problems.push(
      `config/session-autostart.config.json: no hay step que ejecute ${SNAPSHOT_SCRIPT}`,
    );
  } else if (step.enabled === false) {
    problems.push(
      `config/session-autostart.config.json: el step "${step.id ?? SNAPSHOT_SCRIPT}" esta deshabilitado`,
    );
  }
  if (!input.snapshotSource.includes('.session/snapshots/untracked')) {
    problems.push(
      'src/ops/untracked-snapshot.ts: no escribe en .session/snapshots/untracked (destino esperado)',
    );
  }
  if (!input.normText.includes('guard:snapshot')) {
    problems.push(
      'rules/NORMATIVAS-AUTONOMOUS-EVOLUTION.md: la normativa de autonomia no referencia guard:snapshot',
    );
  }
  return problems;
}

function trackedPs1(root: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '*.ps1'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

interface AutostartConfig {
  pipeline?: { steps?: Array<{ id?: string; script?: string; enabled?: boolean }> };
}

export function evaluate(root: string): {
  ps1: ScriptPolicyReport;
  guard: string[];
  ok: boolean;
} {
  const ps1 = checkPs1Inventory(trackedPs1(root));
  const packageJson = readJson<{ scripts?: Record<string, string> }>(join(root, 'package.json'));
  const autostart = readJson<AutostartConfig>(
    join(root, 'config', 'session-autostart.config.json'),
  );
  const guard = checkDestructionGuardWiring({
    packageScripts: packageJson?.scripts ?? {},
    autostartSteps: autostart?.pipeline?.steps ?? [],
    snapshotSource: readText(join(root, SNAPSHOT_SCRIPT)),
    normText: readText(join(root, 'rules', 'NORMATIVAS-AUTONOMOUS-EVOLUTION.md')),
  });
  return { ps1, guard, ok: ps1.violations.length === 0 && guard.length === 0 };
}

function main(): void {
  const root = process.cwd();
  const result = evaluate(root);
  const json = process.argv.includes('--json');
  const check = process.argv.includes('--check');

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `script-policy-gate -> ${result.ps1.tracked} .ps1 versionados, ` +
        `${result.ps1.exceptions.length} excepciones declaradas, ` +
        `${result.ps1.violations.length} violaciones NORM-TS-001`,
    );
    for (const exception of result.ps1.exceptions) {
      console.log(`  OK: ${exception.prefix} (${exception.files}) - ${exception.reason}`);
    }
    for (const violation of result.ps1.violations) {
      console.log(`  ERR: ${violation} fuera de la superficie sancionada (NORM-TS-001)`);
    }
    if (result.guard.length === 0) {
      console.log(
        '  OK: guardrail de destruccion conectado (script + autostart + destino + norma)',
      );
    }
    for (const problem of result.guard) {
      console.log(`  ERR: ${problem}`);
    }
  }

  if (!result.ok) {
    process.exitCode = 1;
    if (check) {
      console.error(
        'Arreglo: mover el .ps1 bajo una excepcion declarada (con razon) o reescribirlo en TypeScript; ' +
          'para el guardrail, restaurar el script/step/destino/normativa que el audit exige.',
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(join(process.cwd(), 'package.json'))) {
    console.error('script-policy-gate: ejecutar desde la raiz del repo');
    process.exit(1);
  }
  main();
}
