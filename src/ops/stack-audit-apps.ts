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
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';

export type AppCheckKind = 'typecheck' | 'test' | 'lint' | 'build';

export interface AppCheck {
  kind: string;
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
  omissions: Array<{ script: string; reason: string }>;
  totalDurationMs: number;
  fixCmd?: string;
}

const ROOT = resolve(process.cwd());
const VALIDATION_CONTRACT_PATH = join(ROOT, 'config', 'app-validation-contracts.json');

/** Keep failed checks at the end so bounded pre-push output retains the cause. */
export function failureSummary(audits: AppAudit[]): string[] {
  return audits.flatMap((app) => app.checks
    .filter((check) => check.status === 'FAIL')
    .map((check) => `FAIL ${app.app} ${check.kind}: ${check.message}`));
}
const APPS_DIR = join(ROOT, 'apps');

type NativeTestSuite = { runner: 'node-test' | 'vitest'; files: string[] };

function readSafeLocalTestContracts(app: string): { scripts: Record<string, string>; nativeSuite?: NativeTestSuite; error?: string } {
  try {
    const config = JSON.parse(readFileSync(VALIDATION_CONTRACT_PATH, 'utf8')) as {
      version?: number;
      safeLocalTestScripts?: Record<string, Record<string, string>>;
      nativeTestSuites?: Record<string, NativeTestSuite>;
    };
    if (config.version !== 1 || !config.safeLocalTestScripts || typeof config.safeLocalTestScripts !== 'object') {
      return { scripts: {}, error: 'Invalid version or safeLocalTestScripts shape' };
    }
    const scripts = config.safeLocalTestScripts[app] ?? {};
    if (Object.values(scripts).some((reason) => typeof reason !== 'string' || !reason.trim())) {
      return { scripts: {}, error: `Invalid contract reason for ${app}` };
    }
    const nativeSuite = config.nativeTestSuites?.[app];
    if (nativeSuite) {
      if (!['node-test', 'vitest'].includes(nativeSuite.runner) || !Array.isArray(nativeSuite.files) || nativeSuite.files.length === 0) {
        return { scripts: {}, error: `Invalid native test suite contract for ${app}` };
      }
      const appDir = join(APPS_DIR, app);
      for (const file of nativeSuite.files) {
        if (typeof file !== 'string' || file.includes('..') || file.startsWith('/') || file.startsWith('\\') || !existsSync(join(appDir, file))) {
          return { scripts: {}, error: `Invalid or missing native test file for ${app}: ${String(file)}` };
        }
      }
    }
    return { scripts, nativeSuite };
  } catch (error) {
    return { scripts: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

interface PackageJsonScripts {
  scripts?: Partial<Record<string, string>>;
}

const CHECK_KIND_TO_SCRIPT: Record<AppCheckKind, string> = {
  typecheck: 'typecheck',
  test: 'test',
  lint: 'lint',
  build: 'build',
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
      const scriptName = kind === 'build' ? (pkg.scripts?.build ? 'build' : 'static:build') : CHECK_KIND_TO_SCRIPT[kind];
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
): Array<{
  app: string;
  packageJsonExists: boolean;
  plan: Array<{ kind: string; script: string }>;
  omissions: Array<{ script: string; reason: string }>;
}> {
  const out: Array<{
    app: string;
    packageJsonExists: boolean;
    plan: Array<{ kind: string; script: string }>;
    omissions: Array<{ script: string; reason: string }>;
  }> = [];
  for (const app of apps) {
    const pkgPath = join(APPS_DIR, app, 'package.json');
    const pkgExists = existsSync(pkgPath);
    const scripts = readAppScripts(app);
    const plan: Array<{ kind: string; script: string }> = [];
    const omissions: Array<{ script: string; reason: string }> = [];
    for (const kind of only) {
      const script = scripts[kind];
      if (kind === 'test') {
        if (script) plan.push({ kind: 'test', script: 'test' });
        const namedTests = readNamedTestScripts(app);
        const contract = readSafeLocalTestContracts(app);
        const safeTests = namedTests.filter((name) => contract.scripts[name] || !deferredTestReason(name));
        plan.push(...safeTests.map((name) => ({ kind: name, script: name })));
        if (contract.nativeSuite) plan.push({ kind: 'test:native', script: 'native-tests' });
        for (const name of namedTests) {
          const reason = contract.scripts[name] ? undefined : deferredTestReason(name);
          if (reason) omissions.push({ script: name, reason });
        }
        for (const name of Object.keys(contract.scripts)) {
          if (!namedTests.includes(name)) omissions.push({ script: name, reason: 'Contract references a script absent from package.json' });
        }
        if (contract.error) omissions.push({ script: 'config/app-validation-contracts.json', reason: `Could not load safe local test contracts: ${contract.error}` });
        if (!script && safeTests.length === 0 && !contract.nativeSuite) {
          omissions.push({
            script: 'test',
            reason: namedTests.length === 0
              ? (pkgExists ? 'No test or test:* scripts are declared' : 'package.json is missing')
              : 'No bounded, non-interactive test script is declared',
          });
        }
        continue;
      }
      if (script) {
        plan.push({ kind, script: kind === 'build' && !hasPackageScript(app, 'build') ? 'static:build' : kind });
      } else {
        omissions.push({ script: kind, reason: pkgExists ? `package.json does not define "${kind}"` : 'package.json is missing' });
      }
    }
    out.push({ app, packageJsonExists: pkgExists, plan, omissions });
  }
  return out;
}

function hasPackageScript(app: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(APPS_DIR, app, 'package.json'), 'utf8')) as PackageJsonScripts;
    return typeof pkg.scripts?.[name] === 'string';
  } catch {
    return false;
  }
}

function readNamedTestScripts(app: string): string[] {
  try {
    const pkgPath = join(APPS_DIR, app, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonScripts;
    return Object.keys(pkg.scripts ?? {}).filter((name) => name.startsWith('test:')).sort();
  } catch {
    return [];
  }
}

function deferredTestReason(script: string): string | undefined {
  const suffix = script.slice('test:'.length).toLowerCase();
  if (/watch|coverage/.test(suffix)) return 'Watch/coverage mode is not a bounded deterministic suite';
  if (/quality/.test(suffix)) return 'Composite quality script duplicates typecheck/lint/test checks';
  if (/e2e|browser|gui|visual|autoplay|journey|bot-manager|smoke/.test(suffix)) {
    return 'Dedicated integration/browser/service run; requires an explicit environment contract';
  }
  return undefined;
}

/** Ejecutor de un check individual contra una app. */
export function runAppCheck(app: string, kind: string, script: string): AppCheck {
  const start = Date.now();
  const appDir = join(APPS_DIR, app);
  try {
    const suite = script === 'native-tests' ? readSafeLocalTestContracts(app).nativeSuite : undefined;
    if (script === 'native-tests' && !suite) throw new Error('Native test suite contract is missing or invalid');
    const command = suite ? process.execPath : 'npm';
    const args = suite
      ? suite.runner === 'node-test'
        ? ['--import', 'tsx', '--test', ...suite.files.map((file) => join(appDir, file))]
        : [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', appDir, ...suite.files]
      : ['run', script, '--silent'];
    const r = runSync(command, args, {
      cwd: suite ? ROOT : appDir,
      stdio: 'pipe',
      timeout: 240_000,
    });
    const durationMs = Date.now() - start;
    if (r.status === 0) {
      return { kind, status: 'PASS', durationMs, message: 'ok' };
    }
    const failureOutput = [r.stderr, r.stdout, r.error?.message].filter(Boolean).join('\n');
    const failureDetail = failureOutput.slice(-2_000).replace(/\s+/g, ' ').trim();
    return {
      kind,
      status: 'FAIL',
      durationMs,
      message: failureDetail || `exit ${r.status}`,
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
  plan: Array<{ kind: string; script: string }>,
  results: AppCheck[],
  omissions: Array<{ script: string; reason: string }> = [],
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
  } else if (!packageJsonExists && checks.length === 0) {
    status = 'WARN';
  } else if (checks.length === 0 || checks.every((c) => c.status === 'SKIP') || omissions.length > 0) {
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
    omissions,
    totalDurationMs: checks.reduce((s, c) => s + c.durationMs, 0),
  };
}

/** Audita todas las apps con los kinds pedidos (default: typecheck + test + build). */
export async function auditApps(
  options: { only?: AppCheckKind[]; execute?: boolean; affected?: string | null } = {},
): Promise<AppAudit[]> {
  const only = options.only ?? ['typecheck', 'test', 'build'];
  const execute = options.execute ?? true;
  const allApps = discoverApps();
  const apps = options.affected ? filterAffectedApps(allApps, options.affected) : allApps;
  const plans = planAppAudits(apps, only);
  const audits: AppAudit[] = [];
  for (const { app, packageJsonExists, plan, omissions } of plans) {
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
    const audit = buildAppAudit(app, packageJsonExists, plan, results, omissions);
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
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
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
  if (!value) return ['typecheck', 'test', 'build'];
  const allowed: AppCheckKind[] = ['typecheck', 'test', 'lint', 'build'];
  const out: AppCheckKind[] = [];
  for (const tok of value.split(',').map((s) => s.trim())) {
    if ((allowed as string[]).includes(tok)) out.push(tok as AppCheckKind);
  }
  return out.length ? out : ['typecheck', 'test', 'build'];
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
        .map((c) => `${c.kind}=${c.status}(${c.durationMs}ms)${c.status === 'SKIP' ? `:${c.message}` : ''}`)
        .join(' ');
      console.log(`  ${icon} ${a.app.padEnd(20)} ${detail}`);
      if (a.status === 'FAIL') {
        for (const c of a.checks) {
          if (c.status === 'FAIL') console.log(`      └─ ${c.kind}: ${c.message}`);
        }
      }
      for (const omission of a.omissions) {
        console.log(`      └─ ${omission.script}: ${omission.reason}`);
      }
    }
  }
  if (!json) for (const line of failureSummary(audits)) console.log(line);
  process.exit(failed > 0 ? 1 : 0);
}

// entrypoint: detecta cuando el script corre directamente (vs importado por tests/CLI).
// `import.meta.url` siempre viene como file:/// (POSIX). En Windows process.argv[1]
// trae separadores de Windows; resolverlo como URL evita ejecutar main al importar.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`FATAL: ${(err as Error).message}`);
    process.exit(2);
  });
}
