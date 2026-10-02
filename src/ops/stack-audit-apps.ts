/**
 * stack-audit-apps.ts — Layer 5 de stack-verify: per-app audit.
 *
 * Para cada app en apps/*:
 *   1. Lee package.json -> detecta scripts disponibles (typecheck, test, lint).
 *   2. Corre los disponibles en serie (serial para no saturar CPU en CI chico;
 *      cuando N>2 apps con test, considera --parallel opt-in en el futuro).
 *   3. Devuelve un AppAudit con status agregado: 'PASS' si todos verde,
 *      'WARN' si alguno no estaba definido, 'FAIL' si alguno fallo.
 *
 * Que no hace:
 *   - No toca lockfiles / package.json. Solo corre `npm run X` en cada app.
 *   - No requiere deps adicionales; usa `runSync` del core.
 *   - No aborta al primer FAIL: completa todos y reporta agregado, asi una sola
 *     corrida da el panorama completo del estado del stack.
 *
 * Anadido como modulo aparte (no inline en stack-verify.ts) para:
 *   - Poder testearlo en isolation sin levantar el orquestador completo.
 *   - Permitir que otros CLIs lo reusen (gv stack apps audit, lefthook gate).
 *
 * Uso standalone:
 *   npx tsx src/ops/stack-audit-apps.ts                  # corre typecheck + test en cada app
 *   npx tsx src/ops/stack-audit-apps.ts --check typecheck   # solo typecheck
 *   npx tsx src/ops/stack-audit-apps.ts --json            # salida JSON
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';

export type AppCheckKind = 'typecheck' | 'test' | 'lint';

export interface AppCheck {
  kind: AppCheckKind;
  status: 'PASS' | 'FAIL' | 'SKIP';
  durationMs: number;
  message: string;
  exitCode?: number;
}

export interface AppAudit {
  app: string;
  packageJsonExists: boolean;
  status: 'PASS' | 'WARN' | 'FAIL';
  checks: AppCheck[];
  totalDurationMs: number;
  fixCmd?: string;
}

const ROOT = resolve(process.cwd());
const APPS_DIR = join(ROOT, 'apps');

interface PackageJsonScripts {
  scripts?: Partial<Record<string, string>>;
}

const CHECK_KIND_TO_SCRIPT: Record<AppCheckKind, string> = {
  typecheck: 'typecheck',
  test: 'test',
  lint: 'lint',
};

/** Detecta apps en apps/* (excluye .runtime y directorios ocultos). */
export function discoverApps(): string[] {
  if (!existsSync(APPS_DIR)) return [];
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '.runtime' && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

/** Lee scripts definidos en apps/<app>/package.json. */
export function readAppScripts(app: string): Partial<Record<AppCheckKind, string>> {
  const pkgPath = join(APPS_DIR, app, 'package.json');
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonScripts;
    const out: Partial<Record<AppCheckKind, string>> = {};
    for (const kind of Object.keys(CHECK_KIND_TO_SCRIPT) as AppCheckKind[]) {
      const scriptName = CHECK_KIND_TO_SCRIPT[kind];
      if (typeof pkg.scripts?.[scriptName] === 'string') {
        out[kind] = pkg.scripts[scriptName] as string;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Construye el plan de checks para cada app, sin ejecutar nada.
 * Util para tests y para que un orquestador decida el orden/parallelismo.
 */
export function planAppAudits(
  apps: string[],
  only: AppCheckKind[],
): Array<{ app: string; packageJsonExists: boolean; plan: Array<{ kind: AppCheckKind; script: string }> }> {
  const out: Array<{
    app: string;
    packageJsonExists: boolean;
    plan: Array<{ kind: AppCheckKind; script: string }>;
  }> = [];
  for (const app of apps) {
    const pkgPath = join(APPS_DIR, app, 'package.json');
    const pkgExists = existsSync(pkgPath);
    const scripts = readAppScripts(app);
    const plan: Array<{ kind: AppCheckKind; script: string }> = [];
    for (const kind of only) {
      const script = scripts[kind];
      if (script) plan.push({ kind, script });
    }
    out.push({ app, packageJsonExists: pkgExists, plan });
  }
  return out;
}

/** Ejecutor de un check individual contra una app. */
export function runAppCheck(app: string, kind: AppCheckKind, _script: string): AppCheck {
  const start = Date.now();
  const appDir = join(APPS_DIR, app);
  try {
    const r = runSync('npm', ['run', CHECK_KIND_TO_SCRIPT[kind], '--silent'], {
      cwd: appDir,
      stdio: 'pipe',
      timeout: 240_000,
    });
    const durationMs = Date.now() - start;
    if (r.status === 0) {
      return { kind, status: 'PASS', durationMs, message: 'ok' };
    }
    const stderrTail = (r.stderr || r.stdout || '').slice(-280).replace(/\s+/g, ' ').trim();
    return {
      kind,
      status: 'FAIL',
      durationMs,
      message: stderrTail || `exit ${r.status}`,
      exitCode: r.status ?? undefined,
    };
  } catch (err) {
    return {
      kind,
      status: 'FAIL',
      durationMs: Date.now() - start,
      message: (err as Error).message.slice(0, 280),
    };
  }
}

/** Compone AppAudit agregando plan + resultados. Util para tests que inyectan checks. */
export function buildAppAudit(
  app: string,
  packageJsonExists: boolean,
  plan: Array<{ kind: AppCheckKind; script: string }>,
  results: AppCheck[],
): AppAudit {
  const checks: AppCheck[] = [];
  let anyFail = false;
  let anyPass = false;
  for (const { kind } of plan) {
    const result = results.find((c) => c.kind === kind);
    if (!result) {
      checks.push({ kind, status: 'SKIP', durationMs: 0, message: 'no result provided' });
      continue;
    }
    checks.push(result);
    if (result.status === 'FAIL') anyFail = true;
    if (result.status === 'PASS') anyPass = true;
  }
  // Reglas de status:
  // - FAIL si algun check fallo
  // - WARN si NO hay checks (plan vacio = app sin scripts auditables) o si todo es SKIP
  // - WARN si package.json no existe (raro: app listada pero sin manifest)
  // - PASS si todos los checks planeados pasaron
  let status: AppAudit['status'] = 'PASS';
  if (anyFail) {
    status = 'FAIL';
  } else if (!packageJsonExists) {
    status = 'WARN';
  } else if (checks.length === 0 || checks.every((c) => c.status === 'SKIP')) {
    status = 'WARN';
  } else if (anyPass) {
    status = 'PASS';
  } else {
    status = 'WARN';
  }
  return {
    app,
    packageJsonExists,
    status,
    checks,
    totalDurationMs: checks.reduce((s, c) => s + c.durationMs, 0),
  };
}

/** Audita todas las apps con los kinds pedidos (default: typecheck + test). */
export async function auditApps(
  options: { only?: AppCheckKind[]; execute?: boolean; affected?: string | null } = {},
): Promise<AppAudit[]> {
  const only = options.only ?? ['typecheck', 'test'];
  const execute = options.execute ?? true;
  const allApps = discoverApps();
  const apps = options.affected ? filterAffectedApps(allApps, options.affected) : allApps;
  const plans = planAppAudits(apps, only);
  const audits: AppAudit[] = [];
  for (const { app, packageJsonExists, plan } of plans) {
    const totalStart = Date.now();
    const results: AppCheck[] = [];
    if (execute) {
      for (const { kind, script } of plan) {
        results.push(runAppCheck(app, kind, script));
      }
    } else {
      for (const { kind } of plan) {
        results.push({ kind, status: 'SKIP', durationMs: 0, message: 'execute=false (plan only)' });
      }
    }
    const audit = buildAppAudit(app, packageJsonExists, plan, results);
    audit.totalDurationMs = Date.now() - totalStart;
    audits.push(audit);
  }
  return audits;
}

/**
 * Filtra las apps a solo las que tienen cambios vs un git ref.
 *
 * affected apps/<app>/**  -> incluye <app>
 * affected shared/**     -> todas (no podemos saber que apps importan shared)
 *
 * Si git falla, devuelve la lista completa (fail-open).
 */
export function filterAffectedApps(allApps: string[], ref: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', `${ref}...HEAD`],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const changed = out.split('\n').filter(Boolean);
    if (changed.length === 0) return []; // sin cambios -> audit vacio (cache hit)
    const out2 = new Set<string>();
    for (const file of changed) {
      // shared/* afecta a todo (no podemos inferir)
      if (file.startsWith('shared/') || file === 'package.json' || file === 'pnpm-lock.yaml') {
        return allApps;
      }
      const m = /^apps\/([^/]+)(\/|$)/.exec(file);
      if (m && allApps.includes(m[1])) out2.add(m[1]);
    }
    return Array.from(out2);
  } catch {
    return allApps;
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseOnly(value: string | undefined): AppCheckKind[] {
  if (value === 'none') return []; // --check none => solo descubrir
  if (!value) return ['typecheck', 'test'];
  const allowed: AppCheckKind[] = ['typecheck', 'test', 'lint'];
  const out: AppCheckKind[] = [];
  for (const tok of value.split(',').map((s) => s.trim())) {
    if ((allowed as string[]).includes(tok)) out.push(tok as AppCheckKind);
  }
  return out.length ? out : ['typecheck', 'test'];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const only = parseOnly(args.includes('--check') ? args[args.indexOf('--check') + 1] : undefined);
  const affIdx = args.indexOf('--affected');
  const affected = affIdx >= 0 ? args[affIdx + 1] || 'HEAD~1' : null;
  const execute = !args.includes('--plan');
  const listOnly = only.length === 0;

  const audits = await auditApps({ only, execute, affected });
  const passed = audits.filter((a) => a.status === 'PASS').length;
  const warned = audits.filter((a) => a.status === 'WARN').length;
  const failed = audits.filter((a) => a.status === 'FAIL').length;

  if (json) {
    console.log(
      JSON.stringify({ only, affected, passed, warned, failed, audits }, null, 2),
    );
  } else {
    const title = listOnly
      ? 'Layer 5: Apps discovery (--check none -> plan only)'
      : `Layer 5: Apps audit (${only.join('+')})${affected ? `, affected vs ${affected}` : ''}`;
    console.log(`\n  ${title}`);
    if (listOnly) {
      for (const a of audits) console.log(`  - ${a.app}`);
      return;
    }
    console.log(`  ${audits.length} apps, ${passed} PASS / ${warned} WARN / ${failed} FAIL`);
    for (const a of audits) {
      const icon = a.status === 'PASS' ? '✓' : a.status === 'WARN' ? '!' : '✗';
      const detail = a.checks
        .map((c) => `${c.kind}=${c.status}(${c.durationMs}ms)`)
        .join(' ');
      console.log(`  ${icon} ${a.app.padEnd(20)} ${detail}`);
      if (a.status === 'FAIL') {
        for (const c of a.checks) {
          if (c.status === 'FAIL') console.log(`      └─ ${c.kind}: ${c.message}`);
        }
      }
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

// entrypoint: detecta cuando el script corre directamente (vs importado por tests/CLI).
// `import.meta.url` siempre viene como file:/// (POSIX). En Windows process.argv[1]
// trae separadores \. Comparar por basename resuelve cross-platform.
function getEntrypointName(): string {
  try {
    return new URL(import.meta.url).pathname.split('/').pop() || '';
  } catch {
    return '';
  }
}

if (getEntrypointName() === 'stack-audit-apps.ts' || getEntrypointName() === 'stack-audit-apps.js') {
  main().catch((err) => {
    console.error(`FATAL: ${(err as Error).message}`);
    process.exit(2);
  });
}
