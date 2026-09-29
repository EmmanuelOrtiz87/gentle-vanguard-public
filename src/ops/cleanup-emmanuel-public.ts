#!/usr/bin/env tsx
/**
 * cleanup-emmanuel-public.ts — Borra apps/academy-landing/ del repo legacy
 * EmmanuelOrtiz87/gentle-vanguard-public. Despues de este push, ese repo
 * queda solo con archivos del stack (no landing). La URL de marca vive
 * unicamente en gentlevanguard/gentlevanguard.github.io.
 *
 * Que problema resuelve: habia DOS landings publicadas:
 *   1. gentlevanguard.github.io                       (oficial, URL de marca)
 *   2. emmanuelortiz87.github.io/gentle-vanguard-public  (mirror legacy, sin GH Pages)
 *
 * El mirror legacy generaba confusion: el user pensaba que la landing estaba
 * caida cuando en realidad se publica en otro lado. Ademas el sync duplicaba
 * trabajo (mismos archivos en 2 lados).
 *
 * Solucion: borrar apps/academy-landing/ del mirror. El repo queda solo con
 * el stack (bootstrap scripts, docs, build/, etc.) — sigue siendo util como
 * "stack distribution" via git clone.
 *
 * Uso:
 *   npx tsx src/ops/cleanup-emmanuel-public.ts            # ejecuta el cleanup
 *   npx tsx src/ops/cleanup-emmanuel-public.ts --dry-run  # muestra que haria
 *
 * Requiere: PAT_SYNC o HTTPS auth contra EmmanuelOrtiz87/gentle-vanguard-public.
 * (El user ya lo tiene configurado en Settings > Secrets; este script usa
 * el mismo mecanismo via git credential helper o env var GITHUB_TOKEN.)
 */

import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const WORK_DIR = join(ROOT, '.runtime', 'cleanup-emmanuel-public-workdir');
const REMOTE_URL = 'https://github.com/EmmanuelOrtiz87/gentle-vanguard-public.git';
const BRANCH = 'main';
const LANDING_PATH = 'apps/academy-landing';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function main(): number {
  log('…', '=== Cleanup apps/academy-landing/ from emmanuel-public (legacy mirror) ===');

  if (existsSync(WORK_DIR)) {
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
  mkdirSync(WORK_DIR, { recursive: true });

  log('…', `Clonando ${REMOTE_URL}`);
  const clone = run('git', ['clone', '--depth=1', '--branch', BRANCH, REMOTE_URL, WORK_DIR]);
  if (clone.status !== 0) {
    log('✗', `Clone fallo: ${clone.stderr.slice(0, 300)}`);
    log('!', 'Verifica que tenes HTTPS auth (git credential helper, GITHUB_TOKEN, o PAT).');
    return 1;
  }

  const landingAbs = join(WORK_DIR, LANDING_PATH);
  if (!existsSync(landingAbs)) {
    log('✓', `${LANDING_PATH} no existe en el repo publico — nada que borrar`);
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 0;
  }

  if (dryRun) {
    const files = run('git', ['ls-tree', '-r', '--name-only', BRANCH, LANDING_PATH], { cwd: WORK_DIR });
    log('…', `Dry-run: borraria estos archivos:\n${files.stdout}`);
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 0;
  }

  log('…', `Borrando ${LANDING_PATH}/ del workdir`);
  rmSync(landingAbs, { recursive: true, force: true });

  run('git', ['config', 'user.name', 'gv-bot-cleanup'], { cwd: WORK_DIR });
  run('git', ['config', 'user.email', 'bot@gentle-vanguard'], { cwd: WORK_DIR });
  run('git', ['add', '-A'], { cwd: WORK_DIR });

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const commitMsg = `chore: remove apps/academy-landing/ (deprecated — use https://gentlevanguard.github.io/)

La landing oficial vive en gentlevanguard/gentlevanguard.github.io (URL de
marca, GH Pages activo). El mirror legacy en este repo queda solo con
archivos del stack (bootstrap scripts, docs, build/, etc.) para
distribucion via git clone.

Triggered by: npx tsx src/ops/cleanup-emmanuel-public.ts
Fecha: ${ts}`;
  const commit = run('git', ['commit', '-m', commitMsg], { cwd: WORK_DIR });
  if (commit.status !== 0 && !commit.stdout.includes('nothing to commit')) {
    log('✗', `Commit fallo: ${commit.stderr.slice(0, 300)}`);
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 1;
  }

  log('…', `Pusheando a ${REMOTE_URL} (${BRANCH})`);
  const push = run('git', ['push', 'origin', BRANCH], { cwd: WORK_DIR });
  if (push.status !== 0) {
    log('✗', `Push fallo: ${push.stderr.slice(0, 300)}`);
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 1;
  }

  log('✓', `Push OK — ${LANDING_PATH}/ removido de emmanuel-public`);
  log('✓', 'URL de marca unica: https://gentlevanguard.github.io/');
  rmSync(WORK_DIR, { recursive: true, force: true });
  return 0;
}

main();
