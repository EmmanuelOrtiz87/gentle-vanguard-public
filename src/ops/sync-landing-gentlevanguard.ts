#!/usr/bin/env tsx
/**
 * sync-landing-gentlevanguard.ts — Push de apps/academy-landing/ a la landing
 * oficial gentlevanguard/gentlevanguard.github.io usando SSH deploy key.
 *
 * Companion de sync-to-public.ts (que sigue manejando el flujo legacy hacia
 * emmanuel-public). Este script es especifico para la URL de marca:
 *   - Source: apps/academy-landing/ del repo privado (develop)
 *   - Target: raiz del repo gentlevanguard/gentlevanguard.github.io
 *   - Transport: SSH via el alias 'github-gentlevanguard' configurado por
 *     setup-landing-deploy-key.ts
 *
 * Idempotente. Si no hay cambios en apps/academy-landing/, sale sin pushear.
 *
 * Uso:
 *   npx tsx src/ops/sync-landing-gentlevanguard.ts            # sync normal
 *   npx tsx src/ops/sync-landing-gentlevanguard.ts --dry-run  # solo diff
 *   npx tsx src/ops/sync-landing-gentlevanguard.ts --force    # push aunque no haya diff
 */

import { existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const LANDING_SRC = join(ROOT, 'apps', 'academy-landing');
const WORK_DIR = join(ROOT, '.runtime', 'landing-sync-workdir');
const HOST_ALIAS = 'github-gentlevanguard';
const REMOTE_URL = `git@${HOST_ALIAS}:gentlevanguard/gentlevanguard.github.io.git`;
// Fallback HTTPS (2026-09-22): el puerto 22 de github.com y ssh.github.com:443
// pueden estar bloqueados/cerrados por la red (ISP/DPI). gh CLI autenticado con
// WRITE access al repo público permite el mismo sync por HTTPS.
const REMOTE_URL_HTTPS = 'https://github.com/gentlevanguard/gentlevanguard.github.io.git';
const BRANCH = 'main';
const args = process.argv.slice(2);

let transport: 'ssh' | 'https' = 'ssh';

const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    input: opts.input,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    status: r.status ?? 0,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function verifyDeployKey(): boolean {
  // 1. Local: la clave existe
  const keyPath = join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.ssh', 'gv-landing-deploy');
  if (!existsSync(keyPath)) {
    log('!', `Deploy key no encontrada en ${keyPath}. Corré setup-landing-deploy-key.ts primero.`);
    return false;
  }
  // 2. Remote: SSH funciona CON ESCRITURA (git-receive-pack; una key read-only pasa
  //    git-upload-pack y el push explota después — fix 2026-10-01)
  const r = run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST_ALIAS, 'git-receive-pack gentlevanguard/gentlevanguard.github.io.git']);
  if (r.status === 0) return true;
  // 3. Fallback HTTPS: si gh está autenticado con acceso al repo, usamos HTTPS.
  log('!', `SSH fallo: ${r.stderr.slice(0, 200)}`);
  const gh = run('gh', ['repo', 'view', 'gentlevanguard/gentlevanguard.github.io', '--json', 'name']);
  if (gh.status === 0) {
    transport = 'https';
    log('↩', 'SSH bloqueado por la red — fallback a HTTPS (gh credential helper)');
    return true;
  }
  log('!', 'La publica debe estar agregada a https://github.com/gentlevanguard/gentlevanguard.github.io/settings/keys/new (Allow write access)');
  return false;
}

function ensureWorkdir(): void {
  if (existsSync(WORK_DIR)) {
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
  mkdirSync(WORK_DIR, { recursive: true });
}

function cloneRemote(): boolean {
  const url = transport === 'https' ? REMOTE_URL_HTTPS : REMOTE_URL;
  log('…', `Clonando ${url} (branch ${BRANCH}, transport ${transport})`);
  const r = run('git', ['clone', '--depth=1', '--branch', BRANCH, url, WORK_DIR]);
  if (r.status !== 0) {
    log('✗', `Clone fallo: ${r.stderr.slice(0, 300)}`);
    return false;
  }
  return true;
}

function copyLandingToRoot(): void {
  // El target es la RAIZ del repo (no apps/academy-landing/).
  // ADR-0017.1: solo academy-landing cruza. Va al root para servir en /.
  log('…', `Copiando apps/academy-landing/ → ${WORK_DIR}/`);
  for (const entry of ['README.md', 'catalog.json', 'favicon.ico', 'index.html', 'logo.svg', 'og-cover.png', 'robots.txt', 'sitemap.xml', 'start.sh', 'stop.sh']) {
    const src = join(LANDING_SRC, entry);
    if (existsSync(src)) {
      cpSync(src, join(WORK_DIR, entry));
    }
  }
  const coversSrc = join(LANDING_SRC, 'covers');
  if (existsSync(coversSrc)) {
    cpSync(coversSrc, join(WORK_DIR, 'covers'), { recursive: true });
  }
}

function hasChanges(): boolean {
  const r = run('git', ['status', '--porcelain'], { cwd: WORK_DIR });
  return r.stdout.trim().length > 0;
}

function commitAndPush(): boolean {
  run('git', ['config', 'user.name', 'gv-bot-landing'], { cwd: WORK_DIR });
  run('git', ['config', 'user.email', 'bot@gentle-vanguard'], { cwd: WORK_DIR });
  run('git', ['add', '-A'], { cwd: WORK_DIR });
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const r = run('git', ['commit', '-m', `landing: sync from private repo ${ts}`], { cwd: WORK_DIR });
  if (r.status !== 0 && !r.stdout.includes('nothing to commit')) {
    log('✗', `Commit fallo: ${r.stderr.slice(0, 300)}`);
    return false;
  }
  const push = run('git', ['push', 'origin', BRANCH], { cwd: WORK_DIR });
  if (push.status !== 0) {
    log('✗', `Push fallo: ${push.stderr.slice(0, 300)}`);
    return false;
  }
  log('✓', `Push OK a gentlevanguard/gentlevanguard.github.io ${BRANCH}`);
  return true;
}

function main(): number {
  log('…', '=== Sync landing → gentlevanguard (SSH deploy key / HTTPS fallback) ===');

  if (!existsSync(LANDING_SRC)) {
    log('✗', `Source no encontrado: ${LANDING_SRC}`);
    return 1;
  }

  if (!verifyDeployKey()) return 1;
  ensureWorkdir();
  if (!cloneRemote()) return 1;
  copyLandingToRoot();

  if (!hasChanges() && !force) {
    log('✓', 'Sin cambios en apps/academy-landing/ — nada que pushear (usa --force para override)');
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 0;
  }

  if (dryRun) {
    const diff = run('git', ['status', '--porcelain'], { cwd: WORK_DIR });
    log('…', `Dry-run: cambios a pushear:\n${diff.stdout}`);
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 0;
  }

  const ok = commitAndPush();
  rmSync(WORK_DIR, { recursive: true, force: true });
  return ok ? 0 : 1;
}

main();
