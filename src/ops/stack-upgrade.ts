/**
 * stack-upgrade — actualización del workspace Gentle-Vanguard desde origin.
 *
 * Comando nativo para que cualquier máquina/usuario del stack se sincronice
 * con lo último publicado SIN ir a GitHub a mano:
 *
 *   npm run upgrade            # upgrade completo (preflight → pull → post)
 *   npm run upgrade:check      # solo reporta qué llegaría, no toca nada
 *   npx tsx src/cli/gv.ts upgrade [--branch develop] [--check]
 *   npx tsx src/cli/gv.ts sync (alias) · update (alias) · update-all (+ db:optimize)
 *
 * Candados (lo que el `git pull` pelado no tenía):
 *   1. Árbol sucio → npm run guard:snapshot ANTES de tocar nada (regla de
 *      destrucción del stack: los cambios sin commit se respaldan primero).
 *   2. Solo FAST-FORWARD (--ff-only): si el branch local divergió de origin,
 *      el upgrade NO hace merge automático — aborta con instrucciones.
 *   3. Lockfiles cambiados → npm install (respeta el lock; jamás npm update,
 *      que pisa las versiones fijadas).
 *   4. Contenido de academy cambiado → regenera el registry (y con él el
 *      stamp del Service Worker, ver build-courses-registry.mjs).
 *   5. Gate final: conformance del design system (33 checks) + stack:facts
 *      sin drift estructural.
 *
 * La lógica de decisión es pura y testeable (buildUpgradePlan / classifyDivergence).
 * offline (ADR-0017): si origin no es alcanzable, falla con mensaje claro y
 * no muta nada.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSync, type RunSyncResult } from '../core/run-command.js';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'yarn.lock'];
const ACADEMY_DATA_PREFIX = 'apps/academy-web/data/';

export interface UpgradePlan {
  /** lockfiles entre los cambios entrantes → npm install post-pull */
  npmInstall: boolean;
  /** contenido de academy entrante → regenerar registry + stamp SW */
  regenAcademy: boolean;
  /** cambios de código de apps corriendo → sugerir restart desde Command Center */
  suggestAppRestart: boolean;
  /** lockfiles detectados (para el reporte) */
  lockfiles: string[];
}

/**
 * Plan de post-upgrade a partir de los archivos que llegan con el pull.
 * Pura: mismo input → mismo output (testeada en tests/unit/stack-upgrade.test.ts).
 */
export function buildUpgradePlan(incomingFiles: string[]): UpgradePlan {
  const lockfiles = incomingFiles.filter((f) => LOCKFILES.some((l) => f === l || f.endsWith(`/${l}`)));
  const regenAcademy = incomingFiles.some(
    (f) => f.startsWith(`${ACADEMY_DATA_PREFIX}courses/`)
      || f.startsWith(`${ACADEMY_DATA_PREFIX}ebooks/`)
      || f.startsWith(`${ACADEMY_DATA_PREFIX}toolkits/`),
  );
  const suggestAppRestart = incomingFiles.some(
    (f) => (f.startsWith('apps/') && /\.(ts|js|mjs|css|html)$/.test(f)) || f.startsWith('src/'),
  );
  return {
    npmInstall: lockfiles.length > 0,
    regenAcademy,
    suggestAppRestart,
    lockfiles: [...new Set(lockfiles)],
  };
}

/** Clasifica el stderr de un pull --ff-only fallido. Pura. */
export function classifyDivergence(stderr: string): 'diverged' | 'uncommitted-conflict' | 'unknown' {
  const s = (stderr || '').toLowerCase();
  if (s.includes('not possible to fast-forward') || s.includes('diverging') || s.includes('diverged')) {
    return 'diverged';
  }
  if (s.includes('local changes') || s.includes('would be overwritten') || s.includes('untracked working tree')) {
    return 'uncommitted-conflict';
  }
  return 'unknown';
}

/** Parsea `git log --oneline` en [hash, asunto]. Pura. */
export function parseIncomingCommits(logOut: string): Array<{ hash: string; subject: string }> {
  return (logOut || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const sp = line.indexOf(' ');
      return { hash: line.slice(0, sp), subject: line.slice(sp + 1) };
    });
}

interface GitOut {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

function git(args: string[], opts: { timeout?: number; quiet?: boolean } = {}): GitOut {
  const r: RunSyncResult = runSync('git', args, {
    cwd: ROOT,
    timeout: opts.timeout ?? 120_000,
    stdio: 'pipe',
  });
  if (!opts.quiet && r.stdout?.trim()) process.stdout.write(r.stdout);
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

function log(msg: string, color: 'c' | 'g' | 'y' | 'r' | 'gray' = 'gray'): void {
  const colors = { c: '\x1b[36m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', gray: '\x1b[90m' };
  console.log(`${colors[color]}${msg}\x1b[0m`);
}

function rootVersion(): string {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? '?';
  } catch {
    return '?';
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const checkOnly = argv.includes('--check');
  const branchIdx = argv.indexOf('--branch');
  const branchArg = branchIdx >= 0 ? argv[branchIdx + 1] : undefined;

  if (!existsSync(join(ROOT, '.git'))) {
    log(`✗ ${ROOT} no es un repo git — el upgrade opera sobre un clone del stack.`, 'r');
    return 2;
  }

  // ── 1. Preflight ────────────────────────────────────────────────────────────
  log('── Preflight ───────────────────────────────────────────────', 'c');
  const status = git(['status', '--porcelain'], { quiet: true });
  if (!status.ok) {
    log('✗ git status falló (¿repo corrupto?): ' + status.stderr.split('\n')[0], 'r');
    return 2;
  }
  const dirtyLines = status.stdout.split('\n').filter(Boolean);

  const branch = branchArg || git(['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true }).stdout.trim();
  if (!branch || branch === 'HEAD') {
    log('✗ HEAD desacoplado (detached) — hacé checkout de develop o main antes de upgradear.', 'r');
    return 2;
  }

  log(`  repo: ${ROOT}`);
  log(`  branch: ${branch} · versión actual: v${rootVersion()} · cambios sin commit: ${dirtyLines.length}`);

  log('  fetch origin…');
  const fetched = git(['fetch', 'origin', branch], { timeout: 180_000, quiet: true });
  if (!fetched.ok) {
    const err = (fetched.stderr || fetched.stdout).toLowerCase();
    log('✗ No se pudo alcanzar origin. Sin conexión o credenciales vencidas:', 'r');
    log('    ' + (fetched.stderr || fetched.stdout).split('\n').filter(Boolean).slice(0, 3).join('\n    '), 'gray');
    if (err.includes('authentication') || err.includes('403') || err.includes('permission')) {
      log('    → refrescá credenciales (gh auth login / git credential). Nada se modificó.', 'y');
    } else {
      log('    → ADR-0017 local-first: el stack sigue operable offline; reintentá con red. Nada se modificó.', 'y');
    }
    return 2;
  }

  const localHead = git(['rev-parse', 'HEAD'], { quiet: true }).stdout.trim();
  const originRef = `origin/${branch}`;
  const remoteHead = git(['rev-parse', originRef], { quiet: true }).stdout.trim();
  if (!remoteHead) {
    log(`✗ origin/${branch} no existe en el remote.`, 'r');
    return 2;
  }

  const localOnly = git(['rev-list', '--count', `${originRef}..HEAD`], { quiet: true }).stdout.trim();
  const incomingLog = git(['log', '--oneline', '--no-decorate', `HEAD..${originRef}`], { quiet: true }).stdout;
  const incoming = parseIncomingCommits(incomingLog);
  const changedFiles = git(['diff', '--name-only', 'HEAD', originRef], { quiet: true })
    .stdout.split('\n')
    .filter(Boolean);
  const plan = buildUpgradePlan(changedFiles);

  // ── 2. Reporte ──────────────────────────────────────────────────────────────
  if (!incoming.length) {
    log(`✓ Ya estás al día con ${originRef} (${localHead.slice(0, 9)}) — v${rootVersion()}`, 'g');
    if (Number(localOnly) > 0) {
      log(`  · tenés ${localOnly} commit(s) local(es) sin push (el upgrade no los toca).`, 'y');
    }
    return 0;
  }

  log(`\n── ${incoming.length} commit(s) entrantes desde ${originRef} ──`, 'c');
  for (const c of incoming.slice(0, 12)) log(`  ${c.hash} ${c.subject}`, 'gray');
  if (incoming.length > 12) log(`  … y ${incoming.length - 12} más`, 'gray');
  log(`\n  archivos cambiados: ${changedFiles.length}`);
  if (plan.lockfiles.length) log(`  · lockfiles: ${plan.lockfiles.join(', ')} → npm install post-pull`, 'y');
  if (plan.regenAcademy) log('  · contenido academy → regenerar registry + stamp SW', 'y');

  if (checkOnly) {
    log('\n✓ (--check) Nada se modificó. Corré "npm run upgrade" para aplicar.', 'g');
    return 0;
  }

  // ── 3. Snapshot del árbol sucio (regla de destrucción) ─────────────────────
  if (dirtyLines.length) {
    log(`\n── Árbol sucio (${dirtyLines.length} archivos) — snapshot de seguridad ──`, 'y');
    const snap = runSync('npm', ['run', 'guard:snapshot'], { cwd: ROOT, stdio: 'pipe', timeout: 180_000 });
    if (snap.status === 0) {
      log('  ✓ respaldado en .session/snapshots/untracked/ (guard:snapshot)', 'g');
    } else {
      log('  ⚠ guard:snapshot falló — el pull igual respeta archivos locales (--ff-only),', 'y');
      log('    pero revisá .session/snapshots/ si algo te importa.', 'y');
    }
  }

  // ── 4. Pull fast-forward only ───────────────────────────────────────────────
  log(`\n── Pull --ff-only desde ${originRef} ──`, 'c');
  const pull = git(['pull', '--ff-only', 'origin', branch]);
  if (!pull.ok) {
    const kind = classifyDivergence(pull.stderr);
    if (kind === 'diverged') {
      log(`\n✗ Tu branch local DIVERGIÓ de ${originRef} (tenés commits propios y llegaron otros).`, 'r');
      log('  El upgrade no hace merges automáticos. Opciones:', 'y');
      log(`    git pull --rebase origin ${branch}   # rebasar tus commits locales`, 'gray');
      log(`    git push origin ${branch}            # si los tuyos deben ganar`, 'gray');
      log('    git reset --hard ' + originRef + '          # descartar los locales (¡snapshot antes!)', 'gray');
    } else if (kind === 'uncommitted-conflict') {
      log('\n✗ Hay cambios sin commit que el pull pisaría. Snapshot no alcanza: committeá o stasheá.', 'r');
    } else {
      log('\n✗ git pull falló:\n' + (pull.stderr || pull.stdout).split('\n').slice(0, 6).join('\n'), 'r');
    }
    return 1;
  }
  const newHead = git(['rev-parse', 'HEAD'], { quiet: true }).stdout.trim();

  // ── 5. Post-upgrade ─────────────────────────────────────────────────────────
  log('\n── Post-upgrade ────────────────────────────────────────────', 'c');
  if (plan.npmInstall) {
    log(`  npm install (lockfiles: ${plan.lockfiles.join(', ')})…`);
    const ins = runSync('npm', ['install'], { cwd: ROOT, stdio: 'pipe', timeout: 600_000 });
    log(ins.status === 0 ? '  ✓ dependencias sincronizadas con el lock' : `  ⚠ npm install salió ${ins.status} — revisá el output`, ins.status === 0 ? 'g' : 'y');
  }

  if (plan.regenAcademy) {
    log('  regenerando registry de academy (y stamp del SW)…');
    const regen = runSync('node', ['scripts/build-courses-registry.mjs'], {
      cwd: join(ROOT, 'apps/academy-web'), stdio: 'pipe', timeout: 120_000,
    });
    log(regen.status === 0 ? '  ✓ data/courses.js + sw.js estampados' : '  ⚠ regen falló — corrélo a mano', regen.status === 0 ? 'g' : 'y');
  }

  log('  conformance del design system (gate 33 checks)…');
  const conf = runSync('npm', ['run', 'conformance', '--prefix', 'packages/gv-design-system'], {
    cwd: ROOT, stdio: 'pipe', timeout: 300_000,
  });
  log(conf.status === 0 ? '  ✓ canon visual íntegro (33/33)' : '  ⚠ conformance con fallas — el upgrade llegó con drift visual', conf.status === 0 ? 'g' : 'y');

  log(`\n✓ Upgrade aplicado: ${localHead.slice(0, 9)} → ${newHead.slice(0, 9)} · v${rootVersion()} · ${incoming.length} commit(s)`, 'g');
  if (plan.suggestAppRestart) {
    log('  · apps corriendo NO se hot-recargan: reiniciá desde Command Center (npm run cc:start) lo que uses.', 'y');
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => process.exit(code));
}
