#!/usr/bin/env node
/**
 * prepush-gate.ts — Composite pre-push gate (Fase 6 N8).
 *
 * Replaces the 12 sequential lefthook pre-push commands with a single parallel
 * gate. Runs all checks concurrently (bounded pool) via Promise.allSettled and
 * caches green results keyed by a tree hash: if nothing changed since the last
 * green run, the gate skips everything (<5s warm). The full app audit runs serially.
 *
 * Usage:
 *   npx tsx src/git/prepush-gate.ts                # run gate (cache-aware)
 *   npx tsx src/git/prepush-gate.ts --force        # bypass cache
 *   npx tsx src/git/prepush-gate.ts --json         # machine-readable output
 *   npx tsx src/git/prepush-gate.ts --list         # list checks and exit
 *   npx tsx src/git/prepush-gate.ts --audit-apps   # exigir el barrido COMPLETO de apps (a demanda)
 *   npx tsx src/git/prepush-gate.ts --skip-apps    # hotfixes: skip Layer 5 stack-audit-apps
 *
 * Exit codes: 0 = all checks passed (or warm cache hit), 1 = any check failed.
 *
 * POLITICA DE LA AUDITORIA DE APPS (2026-11-18, decision del owner)
 * ------------------------------------------------------------------------
 * "stack-audit-apps deberia ser a demanda, no parte del cierre": el barrido
 * completo es O(catalogo de apps) y crece con cada app nueva. Ponerlo en el
 * camino del push no da senal proporcional: un push de docs pagaba 20 minutos.
 * Regla: EL PUSH VALIDA EL CAMBIO, NO EL CATALOGO.
 *
 *   - diff acotado a apps concretas  -> se auditan ESAS apps y BLOQUEA (rapido, senal alta)
 *   - diff en superficie compartida    -> NO se barren todas las apps en el push; lo hace la
 *                                         cadencia programada (src/ops/stack-apps-audit-scheduled.ts).
 *                                         El push lo declara, no lo esconde.
 *   - --audit-apps                     -> el owner exige el barrido completo y BLOQUEA
 *
 * --skip-apps se mantiene por compatibilidad (hotfixes).
 */
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { run, runSync } from '../core/run-command.js';
import {
  assertKnownAppScope,
  inspectAppScope,
  readWorkingFile,
  type AppScope,
} from './prepush-app-scope.js';
import { appAuditEnvironment } from './app-audit-receipts.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CACHE_FILE = join(ROOT, '.runtime', 'prepush-cache.json');
const GATE_VERSION = 13; // scope unknown blocks; per-app evidence is checked separately

// ─── Check definitions (mirrors .lefthook.yml pre-push) ─────────────────────

interface GateCheck {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
  description: string;
}

/**
 * Base del escaneo de secretos: lo último que el remoto tiene de esta rama.
 * Si la rama no existe en el remoto (rama nueva): usar el FORK POINT con
 * origin/main si existe — escanea TODOS los commits de la rama, no solo el
 * último (GB-20261120: con HEAD~1, un secreto en el commit 2 de una hotfix de
 * 5 commits se pusheaba completo con verde). Sin origin/main (repo sin remoto
 * aún) queda HEAD~1, que es lo único que se puede saber.
 */
function resolveSecretScanBase(): string {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = branch && !branch.startsWith('HEAD') ? `origin/${branch}` : '';
  if (remote && runGit(['rev-parse', '--verify', '--quiet', remote])) return remote;
  if (runGit(['rev-parse', '--verify', '--quiet', 'origin/main'])) {
    const forkPoint = runGit(['merge-base', 'origin/main', 'HEAD']);
    if (forkPoint) return forkPoint;
  }
  return 'HEAD~1';
}

const CHECKS: GateCheck[] = [
  {
    name: 'secret-scan',
    command: 'node',
    args: [
      '--import',
      'tsx',
      'src/security/secret-scan-gate.ts',
      '--base',
      resolveSecretScanBase(),
      '--head',
      'HEAD',
    ],
    timeoutMs: 120_000,
    description:
      'Escaneo de secretos en las lineas AÑADIDAS del push (espejo local cableado del gate de seguridad del CI: con Actions caido por billing, el escaneo bloqueante no corria en ningun lado)',
  },
  {
    name: 'models-alignment',
    command: 'node',
    args: ['--import', 'tsx', 'src/git/check-models.ts'],
    timeoutMs: 300_000,
    description: 'Ids de modelo alineados al upstream real (fail-open sin red)',
  },
  {
    name: 'typecheck',
    command: 'pnpm',
    args: ['typecheck'],
    timeoutMs: 180_000,
    description: 'TypeScript strict typecheck',
  },
  {
    name: 'lint',
    command: 'pnpm',
    args: ['lint'],
    timeoutMs: 120_000,
    description: 'ESLint',
  },
  {
    name: 'audit-check',
    command: 'node',
    args: ['--import', 'tsx', 'src/infrastructure/siem-audit-bridge.ts', '--Scope', 'quick'],
    timeoutMs: 60_000,
    description: 'SIEM audit bridge (quick)',
  },
  {
    name: 'orchestrator-auto-fix',
    command: 'node',
    args: ['--import', 'tsx', 'src/orchestration/orchestrate-auto-fix.ts', '--Fix'],
    timeoutMs: 120_000,
    description: 'Orchestrator auto-fix',
  },
  {
    name: 'npm-audit',
    command: 'node',
    args: [
      '--import',
      'tsx',
      'src/infrastructure/npm-audit-pre-push.ts',
      '--AuditLevel',
      'moderate',
    ],
    timeoutMs: 120_000,
    description: 'npm audit (moderate+)',
  },
  {
    name: 'deadcode-ratchet',
    command: 'node',
    args: ['--import', 'tsx', 'src/ops/deadcode-ratchet.ts'],
    timeoutMs: 180_000,
    description: 'Deadcode ratchet (knip) — bloquea si crece vs .deadcode-baseline.txt',
  },
  {
    name: 'gates-verify',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/quality-gates-verify.ts'],
    timeoutMs: 120_000,
    description:
      'Calidad de gates: cada gate declarado "enforced" en config/quality-gates.json tiene ejecucion real (hook o workflow)',
  },
  {
    name: 'token-safety-audit',
    command: 'node',
    args: ['--import', 'tsx', 'src/tokens/token-safety.ts', '--strict'],
    timeoutMs: 60_000,
    description:
      'Token safety config-local de las 8 herramientas desktop (exit 1 solo con WARN de una superficie reproducible; not-applied es hallazgo, no falla)',
  },
  {
    name: 'skills-accessibility',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/skills-accessibility-gate.ts'],
    timeoutMs: 120_000,
    description:
      'Accesibilidad de skills: toda skill cargable es alcanzable por el router (indice semantico + description)',
  },
  {
    name: 'skills-size',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/check-skill-sizes.ts'],
    timeoutMs: 60_000,
    description: 'Tamaño de skills: ninguna skill supera el ratchet de tokens/lineas vs baseline',
  },
  {
    name: 'skills-refs',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/check-skill-references.ts'],
    timeoutMs: 60_000,
    description: 'Referencias de skills: 0 links locales rotos nuevos respecto del baseline',
  },
  {
    name: 'skills-quality-gate',
    command: 'node',
    args: ['--import', 'tsx', 'src/skills/skill-quality-audit.ts', '--gate'],
    timeoutMs: 60_000,
    description:
      'Calidad de skills: routing EN/ES, metadata de criticas y nombres unicos (gate de rutas)',
  },
  {
    name: 'skills-governance-ratchet',
    command: 'node',
    args: ['--import', 'tsx', 'src/skills/skill-governance-audit.ts', '--check'],
    timeoutMs: 60_000,
    description:
      'Gobernanza de skills: colisiones de triggers, skills sin triggers y refs rotas no crecen vs baseline',
  },
  {
    name: 'gitignore-source-guard',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/gitignore-source-guard.ts'],
    timeoutMs: 180_000,
    description:
      'Guard anti-.gitignore: el codigo fuente referenciado por el repo viaja en el clon',
  },
  {
    name: 'app-typecheck-coverage',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/app-typecheck-coverage-gate.ts'],
    timeoutMs: 120_000,
    description:
      'Cobertura de typecheck: el typecheck de cada app verifica TODO su codigo, no solo src/',
  },
  {
    name: 'decks-guion-coverage',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/decks-guion-coverage-gate.ts'],
    timeoutMs: 60_000,
    description: 'Guiones de presentacion: cada deck tiene guion y una seccion por cada slide',
  },
  {
    name: 'decks-facts-drift',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/decks-facts-drift-gate.ts'],
    timeoutMs: 60_000,
    description: 'Cifras de los decks: las afirmaciones sobre el repo coinciden con la medicion',
  },
  {
    name: 'orphans',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/orphan-module-gate.ts', '--strict'],
    timeoutMs: 60_000,
    description:
      'Modulos sin consumidores: src/ sin muertos (owner 2026-11-19: promovido a enforced)',
  },
  {
    // El gate OWASP agentic estaba en el catalogo como "enforced" sin ninguna
    // ejecucion real: era aspiracional. Corre DE VERDAD en el composite, asi
    // que el catalogo y lo que se ejecuta dicen lo mismo.
    name: 'owasp-agentic',
    command: 'npm',
    args: ['run', 'owasp:top10:agentic'],
    timeoutMs: 60_000,
    description:
      'OWASP Top 10 for Agentic Applications 2026 (ASI01..ASI10): cada control declarado tiene que existir en disco',
  },
  {
    name: 'script-policy',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/script-policy-gate.ts', '--check'],
    timeoutMs: 60_000,
    description:
      'NORM-TS-001 con alcance declarado (.ps1 fuera de la superficie) + wiring del guardrail de destruccion',
  },
  {
    name: 'glossary-export',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/glossary-export.ts', '--check'],
    timeoutMs: 60_000,
    description: 'Nomenclatura portable sin drift respecto del glosario del sitio',
  },
  {
    name: 'claude-surface',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/claude-surface-sync.ts', '--check'],
    timeoutMs: 60_000,
    description: 'Superficie .claude (Claude Code): sin rutas muertas, sin junctions rotos',
  },
  {
    name: 'gates-selftest',
    // UNA sola fuente de verdad: el script npm `gates:selftest`.
    // Antes el composite mantenia su propia lista de archivos y ya habia
    // derivado (7 de 9): los contratos de `dependabot-alerts-gate` y de
    // `quality-gates-verify` (los dos mas importantes) NO se ejecutaban en
    // el push. Delegar al script elimina esa clase de drift por construccion.
    command: 'npm',
    args: ['run', 'gates:selftest', '--silent'],
    timeoutMs: 180_000,
    description: 'Test negativo de los gates nuevos: verifica que muerdan',
  },
  {
    name: 'shell-quoting',
    command: 'npm',
    args: ['run', 'audit:shell-quoting'],
    timeoutMs: 60_000,
    description: 'Static shell-quoting audit',
  },
  {
    name: 'design-canon-conformance',
    command: 'npm',
    args: ['run', 'conformance', '--prefix', 'packages/gv-design-system', '--silent'],
    timeoutMs: 120_000,
    description:
      'Canon visual: shell + marca byte-identica + paleta + fuentes (NORM-DESIGN-SYSTEM rev2)',
  },
  {
    name: 'dashboard-lint',
    command: 'npm',
    args: ['run', 'dashboard:lint'],
    timeoutMs: 180_000,
    description:
      'Espejo local de dashboard-ci-lint (Actions caida por billing: el check sigue corriendo)',
  },
  {
    name: 'dashboard-build',
    command: 'npm',
    args: ['run', 'dashboard:build'],
    timeoutMs: 300_000,
    description: 'Espejo local de dashboard-ci-build: tsc + vite build (Actions caida por billing)',
  },
  {
    name: 'perf-baseline',
    command: 'npm',
    args: ['run', 'perf:baseline:check'],
    timeoutMs: 120_000,
    description: 'Perf baseline validation (self-skips if absent)',
  },
  {
    name: 'coverage-gate',
    command: 'npm',
    args: ['run', 'coverage:quick', '--', '--no-write'],
    timeoutMs: 120_000,
    description: 'Code coverage gate (quick, informational)',
  },
  {
    name: 'sbom-generate',
    command: 'node',
    args: [
      '--import',
      'tsx',
      'src/security/generate-sbom.ts',
      '--output',
      'sbom/gentle-vanguard-sbom.json',
      '--format',
      'json',
    ],
    timeoutMs: 120_000,
    description: 'Regenerate SBOM',
  },
  {
    name: 'stack-audit-apps',
    command: 'node',
    args: ['--import', 'tsx', 'src/ops/stack-audit-apps.ts'],
    timeoutMs: 1_200_000, // The 15-minute run reached the penultimate app; each app step remains bounded.
    description:
      'Layer 5 stack-verify: typecheck + test en apps afectadas (o todas si el cambio es compartido)',
  },
  {
    name: 'container-scan',
    command: 'node',
    args: [
      '--import',
      'tsx',
      'src/security/container-scan.ts',
      'scan',
      '--sbom',
      'sbom/gentle-vanguard-sbom.json',
      '--fail-on',
      'high',
      '--json',
    ],
    timeoutMs: 180_000,
    description: 'Container/artifact vuln scan (self-skips if toolchain absent)',
  },
  {
    name: 'e2e-real-smoke',
    command: 'node',
    args: ['--import', 'tsx', 'src/git/run-e2e-smoke.ts'],
    timeoutMs: 900_000,
    description: 'Smoke E2E real de las apps cambiadas en el push (NORM-E2E-001)',
  },
  {
    name: 'content-validate',
    command: 'npm',
    args: ['run', 'content:validate'],
    timeoutMs: 60_000,
    description: 'Content operations validation',
  },
  {
    name: 'ci-static-gates',
    command: 'npm',
    args: ['run', 'ci:static-gates'],
    timeoutMs: 120_000,
    description: 'CI static gates locally',
  },
  {
    name: 'declaration-audit',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/declaration-audit.ts'],
    timeoutMs: 120_000,
    description:
      'Declaraciones: toda ruta derivada leida por el codigo esta declarada, todo gate del catalogo tiene ejecutor real y todo control tiene test de contrato',
  },
  {
    name: 'unit-suite',
    command: 'npm',
    args: ['run', 'test:unit:parallel'],
    timeoutMs: 600_000,
    description:
      'Suite unitaria completa en local (33 s, 226 archivos). El CI esta caido por billing de la cuenta: sin este espejo local, un test rojo queda invisible semanas (pasó con el delegador entre el 2026-11-06 y el 2026-11-11)',
  },
  {
    name: 'universal-quality',
    command: 'npm',
    args: ['run', 'quality:universal'],
    timeoutMs: 180_000,
    description:
      'Calidad universal (6 s). Espejo local del job universal-quality del CI: con Actions caido, este check no se ejecutaba en absoluto',
  },
  {
    name: 'runtime-retention',
    command: 'node',
    args: ['--import', 'tsx', 'src/ops/runtime-retention-notify.ts'],
    timeoutMs: 300_000,
    description:
      'Retencion de .runtime (3 s, 3,9 GB / 53k archivos). Audita, ESCALA lo que no entra en la politica (la decision es del owner, no del gate) y AVISA al owner por MCAS solo cuando el conjunto de escalaciones cambia',
  },
  {
    name: 'app-registry',
    command: 'node',
    args: ['--import', 'tsx', 'src/ops/app-registry.ts'],
    timeoutMs: 60_000,
    description:
      'Registro unico de apps: ids unicos, sin puertos repetidos, carpetas y scripts start/stop reales, y los dos centros de comando (Command Center = nativas, Sandbox = clientes) sin pisarse',
  },
  {
    name: 'start-command-audit',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/start-command-audit.ts'],
    timeoutMs: 120_000,
    description:
      'Todo comando de arranque apunta a un archivo real (el start.sh de sandbox-gv llamaba a un modulo inexistente y nadie lo noto)',
  },
  {
    name: 'sh-launcher-audit',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/sh-launcher-audit.ts'],
    timeoutMs: 60_000,
    description:
      'Los start.sh de apps lanzan node directo con pidfile: sin pnpm/npx/npm como CLI intermedio (nieto con consola, PID no atribuible) y sin wait desnudo que bloquee la terminal',
  },
  {
    name: 'app-design-gate',
    command: 'node',
    args: ['--import', 'tsx', 'src/tools/app-design-gate.ts'],
    timeoutMs: 60_000,
    description:
      'NORM-APP-001 con gate real: waiver de cliente, declaracion nativa (ratchet sobre baseline), manifiesto en superficies web y evidencia visual cuando la declaracion dice homologada',
  },
];

// ─── Tree hash ───────────────────────────────────────────────────────────────

function runGit(args: string[]): string {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8', windowsHide: true });
  return (result.stdout ?? '').toString().trim();
}

function runGitBuffer(args: string[]): Buffer {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed (${result.status})`);
  return result.stdout ?? Buffer.alloc(0);
}

function fileHash(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path, 'utf-8')).digest('hex');
  } catch {
    return 'missing';
  }
}

export function hashWorkingTreeChanges(
  trackedDiff: Buffer,
  untrackedFiles: Array<{ path: string; contents: Buffer }>,
): string {
  const hash = createHash('sha256').update(trackedDiff);
  for (const file of [...untrackedFiles].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update('\0').update(file.path).update('\0').update(file.contents);
  }
  return hash.digest('hex');
}

/**
 * Tree hash includes actual tracked and untracked file contents so repeated
 * edits to an already-dirty path cannot reuse a stale green result.
 */
function computeTreeHash(): string {
  const head = runGit(['rev-parse', 'HEAD']);
  const status = runGit(['status', '--porcelain']);
  const pkg = fileHash(join(ROOT, 'package.json'));
  const lock = fileHash(join(ROOT, 'pnpm-lock.yaml'));
  const trackedDiff = runGitBuffer([
    'diff',
    '--binary',
    '--no-ext-diff',
    '--no-textconv',
    'HEAD',
    '--',
  ]);
  const untrackedPaths = runGitBuffer(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const untrackedFiles = untrackedPaths.map((path) => {
    const absolutePath = join(ROOT, path);
    const stat = lstatSync(absolutePath);
    return {
      path,
      contents: stat.isSymbolicLink()
        ? Buffer.from(`symlink:${readlinkSync(absolutePath)}`)
        : readFileSync(absolutePath),
    };
  });
  const workingTreeChanges = hashWorkingTreeChanges(trackedDiff, untrackedFiles);
  return createHash('sha256')
    .update(`${head}\n${status}\n${pkg}\n${lock}\n${workingTreeChanges}`)
    .update(appAuditEnvironment())
    .update(fileHash(join(ROOT, 'node_modules', '.package-lock.json')))
    .update(fileHash(join(ROOT, 'node_modules', '.modules.yaml')))
    .digest('hex')
    .slice(0, 16);
}

// ─── Tree fence (2026-09-16) ─────────────────────────────────────────────────
// Detecta mutaciones fuera de banda: archivos que estaban limpios antes de
// correr los checks y aparecen modificados después. Los checks del gate son
// todos de solo-lectura sobre el árbol fuente, así que cualquier cambio nuevo
// proviene de un agente concurrente (otra sesión/editor) — se reporta con la
// hora para poder correlacionar contra token-ingest (zcode/codex/minimax).
// Advisory: no bloquea el push.

function treeFence(before: string): string[] {
  const beforeFiles = new Set(before.split('\n').filter(Boolean));
  const after = runGit(['status', '--porcelain']);
  const newMutations = after
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      const path = line.slice(3).trim();
      return (
        !beforeFiles.has(line) && !beforeFiles.has(` M ${path}`) && !beforeFiles.has(`?? ${path}`)
      );
    });
  return newMutations;
}

function printFence(mutations: string[]): void {
  if (mutations.length === 0) return;
  console.log('');
  console.log('🚧 TREE-FENCE: el árbol se modificó DURANTE el gate (fuera de banda):');
  for (const m of mutations.slice(0, 10)) console.log(`   ${m}`);
  console.log(
    `   Los checks del gate no editan código fuente — un agente concurrente` +
      ` (otra sesión zcode/codex/minimax) está editando el repo AHORA.` +
      ` Correlacionar con: node -e (token-ingest timestamps) o witr process.`,
  );
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface GateCache {
  version: number;
  entries: Record<string, { timestamp: string; checks: Record<string, string> }>;
}

function loadCache(): GateCache {
  try {
    if (existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as GateCache;
      if (parsed.version === GATE_VERSION) return parsed;
    }
  } catch {
    /* corrupt cache → reset */
  }
  return { version: GATE_VERSION, entries: {} };
}

function saveCache(cache: GateCache): void {
  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    /* cache is best-effort */
  }
}

// ─── Check runner ────────────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  /** `warn` = INDETERMINADO (exit 2): el check no pudo mirar, no pudo afirmar.
   * Nunca bloquea (push offline válido) pero es visible — no verde silencioso. */
  status: 'pass' | 'warn' | 'fail' | 'error';
  durationMs: number;
  tail: string;
}

export function buildPerfBaselineArgs(results: CheckResult[]): string[] {
  const measuredChecks = new Set(['audit-check', 'npm-audit', 'orchestrator-auto-fix']);
  return [
    'run',
    'perf:baseline:check',
    '--',
    ...results
      .filter((result) => measuredChecks.has(result.name))
      .map((result) => `--duration=${result.name}=${(result.durationMs / 1000).toFixed(2)}`),
  ];
}

export function buildAppAuditArgs(
  args: string[],
  appScope: { mode: AppScope['mode']; base: string | null; reason?: string },
): string[] {
  assertKnownAppScope({ ...appScope, reason: appScope.reason ?? 'rango no verificable' });
  if (!appScope.base) throw new Error('Base Git de apps no verificable');
  if (appScope.mode === 'full') return [...args, '--reuse-evidence'];
  return [...args, '--affected', appScope.base, '--include-worktree', '--reuse-evidence'];
}

/**
 * ¿La auditoria de apps corre en el push, y bloquea?
 *
 * - `apps`  : el diff toca apps concretas. Auditoria acotada, barata y de senal
 *             alta -> corre y BLOQUEA.
 * - `full`  : el diff toca superficie compartida (src/**, scripts/**, config/**).
 *             Barrer TODAS las apps aqui es O(catalogo) y no escala; el push no
 *             paga eso. NO se corre en el push (la cadencia lo hace) y el gate
 *             lo DECLARA.
 * - `none`  : no hay apps afectadas -> nada que auditar.
 *
 * `--audit-apps` (a demanda) fuerza el barrido completo y bloqueante.
 */
export function isAppAuditBlocking(
  appScope: { mode: AppScope['mode'] },
  options: { auditApps: boolean },
): boolean {
  if (options.auditApps) return true;
  return appScope.mode === 'apps';
}

/** ¿La auditoria de apps debe ejecutarse en este push? */
export function shouldRunAppAudit(
  appScope: { mode: AppScope['mode'] },
  options: { auditApps: boolean },
): boolean {
  if (options.auditApps) return true;
  return appScope.mode === 'apps' || appScope.mode === 'none';
}

/**
 * Veredicto del gate: los checks no bloqueantes (advisory) informan pero no
 * bloquean el push. Un FAIL bloqueante sigue bloqueando.
 *
 * `warn` (INDETERMINADO, exit 2) JAMÁS bloquea — ni siquiera estando fuera del
 * set advisory: "no pude mirar" no es evidencia de fallo ni de éxito, y
 * bloquear el push por falta de conectividad castiga el trabajo offline.
 * Sí resta del allGreen: el verde solo significa "todo verificado".
 */
export function evaluateGate(
  results: CheckResult[],
  nonBlocking: Set<string>,
): { allPass: boolean; blockingFailures: CheckResult[]; allGreen: boolean } {
  const blockingFailures = results.filter(
    (r) => (r.status === 'fail' || r.status === 'error') && !nonBlocking.has(r.name),
  );
  return {
    allPass: blockingFailures.length === 0,
    blockingFailures,
    allGreen: results.every((r) => r.status === 'pass'),
  };
}

export function runOne(
  check: GateCheck,
  args = check.args,
  onStderr?: (chunk: Buffer) => void,
): Promise<CheckResult> {
  return new Promise((resolvePromise) => {
    const start = Date.now();
    const windows = process.platform === 'win32';
    const child = run(check.command, args, { cwd: ROOT, detached: !windows });
    let stdout = '';
    let stderr = '';
    let finished = false;
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      onStderr?.(d);
    });
    const finish = (status: CheckResult['status']) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const output = stdout + stderr;
      const tail = output.split('\n').filter(Boolean).slice(-6).join('\n');
      // Un check que falla deja su output COMPLETO en disco: el tail de 6
      // líneas no diagnosticó el flake de universal-quality (2026-11-12) y
      // obligó a re-correr el gate entero a ciegas tres veces.
      if (status !== 'pass') {
        try {
          const dir = join(ROOT, '.runtime', 'prepush-failures');
          mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          writeFileSync(
            join(dir, `${check.name}-${stamp}.log`),
            `[command] ${check.command} ${args.join(' ')}\n[exit] ${status}\n\n${output}`,
          );
        } catch {
          /* best-effort: el diagnostico no puede romper el gate */
        }
      }
      resolvePromise({ name: check.name, status, durationMs: Date.now() - start, tail });
    };
    // spawn() has no timeout option. Terminate the check and its npm/test workers.
    const timer = setTimeout(() => {
      stderr += `\n[timeout] ${check.name} exceeded ${check.timeoutMs}ms.\n`;
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (windows) {
          const killed = runSync('taskkill.exe', ['/T', '/F', '/PID', String(child.pid)], {
            timeout: 8000,
          });
          if (killed.status !== 0) child.kill('SIGKILL');
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish('error');
    }, check.timeoutMs);
    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`;
      finish('error');
    });
    child.on('close', (code, signal) => {
      if (signal) stderr += `\n[signal] ${signal}\n`;
      // Convención de códigos: 0 = OK, 1 = BLOQUEANTE, 2 = INDETERMINADO
      // (el check corrió pero no pudo verificar; p.ej. models-alignment sin
      // red). El 2 se reporta como `warn`, no como pass verde silencioso
      // (meta-auditoría 2026-11-20: fail-open no es verde).
      finish(code === 0 ? 'pass' : code === 2 ? 'warn' : 'fail');
    });
  });
}

/** Bounded concurrency pool — parallel but avoids CPU thrashing. */
async function runChecks(checks: GateCheck[], concurrency = 4): Promise<CheckResult[]> {
  const results: CheckResult[] = new Array(checks.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, checks.length) }, async () => {
    while (index < checks.length) {
      const i = index++;
      results[i] = await runOne(checks[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function printSummary(results: CheckResult[], totalMs: number, nonBlocking: Set<string>): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  console.log(
    `\n=== Pre-push gate: ${passed}/${results.length} passed in ${(totalMs / 1000).toFixed(1)}s ===`,
  );
  for (const r of results) {
    const icon =
      r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'warn' ? '🟡' : '⚠️';
    const advisory =
      r.status === 'warn'
        ? ' (indeterminado: no bloquea)'
        : nonBlocking.has(r.name) && r.status !== 'pass'
          ? ' (advisory: no bloquea)'
          : '';
    console.log(`${icon} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)${advisory}`);
    if (r.status !== 'pass' && r.tail) {
      console.log(`   └─ ${r.tail.split('\n').join('\n      ')}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const json = args.includes('--json');
  const list = args.includes('--list');
  const skipApps = args.includes('--skip-apps');
  const auditApps = args.includes('--audit-apps');

  if (list) {
    for (const c of skipApps ? CHECKS.filter((x) => x.name !== 'stack-audit-apps') : CHECKS) {
      console.log(`${c.name}\t${c.description}`);
    }
    return;
  }

  const start = Date.now();
  const appScope = inspectAppScope(undefined, 'HEAD', undefined, readWorkingFile);
  assertKnownAppScope(appScope);

  // Politica de la auditoria de apps: el push valida el CAMBIO, no el CATALOGO.
  const appAuditRuns = !skipApps && shouldRunAppAudit(appScope, { auditApps });
  const appAuditBlocking = appAuditRuns && isAppAuditBlocking(appScope, { auditApps });
  const checks = appAuditRuns ? CHECKS : CHECKS.filter((c) => c.name !== 'stack-audit-apps');
  const nonBlocking = new Set<string>();
  if (appAuditRuns && !appAuditBlocking) nonBlocking.add('stack-audit-apps');

  if (!json) {
    if (skipApps) {
      console.log(
        '[prepush-gate] --skip-apps: skipping stack-audit-apps (Layer 5). ' +
          'For HOTFIXES only. Next full push will re-validate apps.',
      );
      console.log('');
    } else if (appAuditRuns) {
      const selected =
        appScope.mode === 'full'
          ? 'todas (dependencias compartidas identificadas)'
          : appScope.mode === 'apps'
            ? appScope.apps.join(', ')
            : 'ninguna';
      console.log(`[pre-push] Auditoría de apps: ${selected}. ${appScope.reason}.`);
    } else {
      console.log(
        '[pre-push] Auditoría de apps: NO se ejecuta en este push (el diff toca superficie ' +
          'compartida: src/**, scripts/** o config/** -> barrido completo en la cadencia ' +
          'programada). Exigible con --audit-apps.',
      );
    }
  }
  const treeHash = computeTreeHash();

  // --skip-apps implies --force for cache purposes (skip partial-result cache hits).
  // We never STORE to cache under --skip-apps because the gate is intentionally incomplete.
  // A global receipt never substitutes per-app input/environment checks.
  if (!force && !skipApps && appScope.mode === 'none') {
    const cache = loadCache();
    const hit = cache.entries[treeHash];
    const age = hit ? Date.now() - Date.parse(hit.timestamp) : Infinity;
    if (hit && age >= 0 && age <= 24 * 60 * 60 * 1000) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      if (json) {
        console.log(
          JSON.stringify({
            warmCache: true,
            treeHash,
            elapsedSec: elapsed,
            checks: hit.checks,
            appScope,
          }),
        );
      } else {
        console.log(
          `[prepush-gate] Warm cache hit (${elapsed}s) — tree unchanged since green run at ${hit.timestamp}. Skipping ${checks.length} checks.`,
        );
      }
      process.exit(0);
    }
  }

  const before = runGit(['status', '--porcelain']);
  const appAudit = checks.find((check) => check.name === 'stack-audit-apps');
  const appAuditArgs = appAudit ? buildAppAuditArgs(appAudit.args, appScope) : undefined;
  // The app audit runs installer and backup suites that apply Windows ACLs.
  // Let the other resource-heavy gates finish first so icacls is not competing
  // with four concurrent builds/test runners for process, disk, and AV locks.
  const perfBaseline = checks.find((check) => check.name === 'perf-baseline');
  const parallelChecks = checks.filter(
    (check) => check.name !== 'stack-audit-apps' && check.name !== 'perf-baseline',
  );
  const results = await runChecks(parallelChecks);
  if (perfBaseline) {
    results.push(await runOne(perfBaseline, buildPerfBaselineArgs(results)));
  }
  if (appAudit && appAuditArgs) {
    const progress = json ? undefined : (chunk: Buffer) => process.stderr.write(chunk);
    results.push(await runOne(appAudit, appAuditArgs, progress));
  }
  const totalMs = Date.now() - start;
  const { allPass, allGreen } = evaluateGate(results, nonBlocking);
  const fence = treeFence(before);

  if (
    allGreen &&
    !skipApps &&
    appScope.mode === 'none' &&
    fence.length === 0 &&
    computeTreeHash() === treeHash
  ) {
    const cache = loadCache();
    cache.entries[treeHash] = {
      timestamp: new Date().toISOString(),
      checks: Object.fromEntries(results.map((r) => [r.name, 'pass'])),
    };
    saveCache(cache);
  }

  if (json) {
    console.log(
      JSON.stringify({
        warmCache: false,
        treeHash,
        totalMs,
        allPass,
        allGreen,
        appScope,
        appAudit: { runs: appAuditRuns, blocking: appAuditBlocking, mode: appScope.mode },
        skipped: appAuditRuns ? [] : ['stack-audit-apps'],
        nonBlocking: [...nonBlocking],
        results,
        fence,
      }),
    );
  } else {
    printSummary(results, totalMs, nonBlocking);
    printFence(fence);
  }

  process.exit(allPass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[prepush-gate] Fatal:', err);
    process.exit(1);
  });
}
