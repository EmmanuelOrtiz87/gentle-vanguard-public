#!/usr/bin/env node
/**
 * hooks-verify — ninguna declaracion de hook se certifica a si misma.
 *
 * POR QUE EXISTE (2026-11-18)
 * -------------------------------------------------------------------------
 * `config/hooks-config.json` declaraba `pre_process.mandatory: true`,
 * `orchestrator.json#preProcessing.mandatory: true` y `opencode-hooks.json`
 * comandos que NINGUN runtime ejecuta: el canon `opencode.json` no tiene clave
 * `hooks` y ningun host de escritorio ejecuta estos archivos. Config correcta
 * + ejecucion inexistente = promesa falsa (el mismo patron que el presupuesto
 * de tokens medido contra un CSV vacio).
 *
 * Semantica:
 *  - FAIL: `mandatory: true` sin runner, o hook habilitado cuyo script no existe.
 *  - WARN: hook activo sin `runner` ni `status` declarado (drift sin declarar).
 *  - OK:   runner real declarado, o status advisory/inert/superseded (no
 *          promete ejecucion).
 *
 * Uso:
 *   npm run hooks:verify            # tabla + exit 1 si hay FAIL
 *   npm run hooks:verify -- --json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type HookVerdict = 'OK' | 'WARN' | 'FAIL';

export interface HookFinding {
  source: string;
  hook: string;
  mandatory: boolean;
  runner: string | null;
  status: string | null;
  verdict: HookVerdict;
  detail: string;
}

interface HookEntry {
  enabled?: boolean;
  mandatory?: boolean;
  status?: string;
  runner?: string | null;
  runnerNote?: string;
  script?: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Primer path de archivo dentro de un comando o path directo. */
export function scriptPathOf(script: string | undefined): string | null {
  if (!script) return null;
  const m = script.match(/[\w./-]+\.(?:ts|mjs|js|cjs)\b/);
  return m ? m[0] : null;
}

export function evaluateHook(
  source: string,
  hook: string,
  entry: HookEntry,
  fileExists: (path: string) => boolean,
): HookFinding {
  const mandatory = entry.mandatory === true;
  const runner = entry.runner ?? null;
  const status = entry.status ?? null;
  const base = { source, hook, mandatory, runner, status };

  if (mandatory && !runner) {
    return {
      ...base,
      verdict: 'FAIL',
      detail: 'mandatory:true sin runner — ningun runtime lo ejecuta (una promesa falsa)',
    };
  }
  if (status === 'advisory' || status === 'inert' || status === 'superseded') {
    return { ...base, verdict: 'OK', detail: `declarado ${status} (no promete ejecucion)` };
  }
  if (entry.enabled !== false) {
    const file = scriptPathOf(entry.script);
    if (file && !fileExists(file)) {
      return { ...base, verdict: 'FAIL', detail: `el script declarado no existe (${file})` };
    }
  }
  if (runner) return { ...base, verdict: 'OK', detail: `runner: ${runner}` };
  return {
    ...base,
    verdict: 'WARN',
    detail: 'hook activo sin runner ni status declarado — drifta en silencio',
  };
}

export function evaluateHooks(root: string): HookFinding[] {
  const findings: HookFinding[] = [];
  const exists = (p: string) => existsSync(join(root, p));

  const hooksConfig = join(root, 'config', 'hooks-config.json');
  if (existsSync(hooksConfig)) {
    const parsed = readJson(hooksConfig) as { hooks?: Record<string, HookEntry> };
    for (const [hook, entry] of Object.entries(parsed.hooks ?? {})) {
      findings.push(evaluateHook('hooks-config.json', hook, entry, exists));
    }
  }

  const orchestrator = join(root, 'config', 'orchestrator.json');
  if (existsSync(orchestrator)) {
    const parsed = readJson(orchestrator) as {
      orchestrator?: { preProcessing?: HookEntry };
    };
    if (parsed.orchestrator?.preProcessing) {
      findings.push(
        evaluateHook(
          'orchestrator.json',
          'preProcessing',
          parsed.orchestrator.preProcessing,
          exists,
        ),
      );
    }
  }

  const opencodeHooks = join(root, 'config', 'opencode-hooks.json');
  if (existsSync(opencodeHooks)) {
    const parsed = readJson(opencodeHooks) as { hooks?: Record<string, unknown[]> } & HookEntry;
    const count = Object.values(parsed.hooks ?? {}).reduce((n, list) => n + list.length, 0);
    findings.push(
      evaluateHook(
        'opencode-hooks.json',
        `${count} comando(s)`,
        {
          enabled: count > 0,
          mandatory: parsed.mandatory,
          status: parsed.status,
          runner: parsed.runner,
        },
        exists,
      ),
    );
  }

  return findings;
}

function main(): void {
  const root = resolve(process.cwd());
  const findings = evaluateHooks(root);
  const fail = findings.filter((f) => f.verdict === 'FAIL');
  const warn = findings.filter((f) => f.verdict === 'WARN');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ fail: fail.length, warn: warn.length, findings }, null, 2));
  } else {
    console.log(
      `[hooks:verify] ${findings.length} declaraciones — ${fail.length} FAIL, ${warn.length} WARN`,
    );
    for (const f of findings) {
      console.log(`  ${f.verdict.padEnd(4)} ${f.source}#${f.hook} — ${f.detail}`);
    }
  }
  if (fail.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
