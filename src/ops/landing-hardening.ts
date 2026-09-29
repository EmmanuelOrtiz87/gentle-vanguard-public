#!/usr/bin/env tsx
/**
 * landing-hardening.ts — Endurecimiento minimo del repo gentlevanguard/gentlevanguard.github.io
 * (la landing oficial, GitHub Pages). Por acuerdo 2026-09-16, este repo debe tener
 * lo MINIMO: solo sirve archivos estaticos, no codigo.
 *
 * Que agrega:
 *   1. .gitignore  (5 lineas: .DS_Store, .vscode/, *.log, node_modules/, .env*)
 *   2. Parrafo en README.md explicando que la fuente vive en
 *      EmmanuelOrtiz87/gentle-vanguard/apps/academy-landing/ y NO se commitea aca
 *      — se sincroniza via SSH deploy key.
 *
 * Si la landing ya tiene .gitignore o ya tiene el parrafo, sale sin tocar nada
 * (idempotente).
 *
 * Uso:
 *   npx tsx src/ops/landing-hardening.ts            # aplica
 *   npx tsx src/ops/landing-hardening.ts --dry-run  # muestra diff
 *   npx tsx src/ops/landing-hardening.ts --verify   # solo verifica que .gitignore + parrafo esten
 *
 * Requiere: deploy key ya configurada (setup-landing-deploy-key.ts) Y la publica
 * agregada al repo gentlevanguard (1 vez, paso manual en GitHub UI).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const WORK_DIR = join(ROOT, '.runtime', 'landing-hardening-workdir');
const HOST_ALIAS = 'github-gentlevanguard';
const REMOTE_URL = `git@${HOST_ALIAS}:gentlevanguard/gentlevanguard.github.io.git`;
const BRANCH = 'main';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify');

const GITIGNORE = `.DS_Store
.vscode/
*.log
node_modules/
.env*
`;

const README_FOOTER = `

---

## Origen del codigo

Esta landing **NO se commitea a mano** aca. La fuente vive en
\`EmmanuelOrtiz87/gentle-vanguard/apps/academy-landing/\` y se sincroniza
automaticamente al branch \`main\` de este repo via SSH deploy key
(configurada por \`setup-landing-deploy-key.ts\`).

Workflow: cualquier cambio en \`apps/academy-landing/\` del repo privado
se publica en menos de 1 minuto via \`gv landing sync\` (o el workflow
de GitHub Actions si los paths matchean).

**No commitees a este repo a mano** — los commits locales se sobrescriben
en el proximo sync. Edita siempre la fuente en el repo privado.
`;

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function clone(): boolean {
  if (existsSync(WORK_DIR)) {
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
  mkdirSync(WORK_DIR, { recursive: true });
  const r = spawnSync('git', ['clone', '--depth=1', '--branch', BRANCH, REMOTE_URL, WORK_DIR], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    log('!', `Clone fallo: ${r.stderr.slice(0, 300)}`);
    return false;
  }
  return true;
}

function checkExisting(): { gitignore: boolean; readme: boolean } {
  const gi = join(WORK_DIR, '.gitignore');
  const readme = join(WORK_DIR, 'README.md');
  const giExists = existsSync(gi);
  const readmeOk = existsSync(readme) && readFileSync(readme, 'utf8').includes('Origen del codigo');
  return { gitignore: giExists, readme: readmeOk };
}

function applyChanges(): { changed: boolean; details: string[] } {
  const details: string[] = [];
  let changed = false;

  // .gitignore — append si no existe, noop si existe
  const giPath = join(WORK_DIR, '.gitignore');
  if (!existsSync(giPath)) {
    writeFileSync(giPath, GITIGNORE, 'utf8');
    details.push('+ .gitignore (nuevo)');
    changed = true;
  } else {
    const current = readFileSync(giPath, 'utf8');
    if (current.trim() === GITIGNORE.trim()) {
      details.push('= .gitignore (ya coincide, noop)');
    } else {
      // Append solo si el contenido no esta ya (set de reglas)
      const existingLines = new Set(current.split('\n').map((l) => l.trim()).filter(Boolean));
      const newLines = GITIGNORE.split('\n').map((l) => l.trim()).filter(Boolean);
      const missing = newLines.filter((l) => !existingLines.has(l));
      if (missing.length === 0) {
        details.push('= .gitignore (reglas ya presentes, noop)');
      } else {
        writeFileSync(giPath, current + (current.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n', 'utf8');
        details.push(`+ .gitignore (anexadas ${missing.length} reglas: ${missing.join(', ')})`);
        changed = true;
      }
    }
  }

  // README.md — append footer si no existe
  const readmePath = join(WORK_DIR, 'README.md');
  if (existsSync(readmePath)) {
    const current = readFileSync(readmePath, 'utf8');
    if (current.includes('Origen del codigo')) {
      details.push('= README.md (footer ya presente, noop)');
    } else {
      writeFileSync(readmePath, current + README_FOOTER, 'utf8');
      details.push('+ README.md (footer anadido)');
      changed = true;
    }
  } else {
    writeFileSync(readmePath, `# Gentle-Vanguard Academy — Landing oficial\n\nLanding estatica servida por GitHub Pages en https://gentlevanguard.github.io/.\n${README_FOOTER}`, 'utf8');
    details.push('+ README.md (nuevo)');
    changed = true;
  }

  return { changed, details };
}

function commitAndPush(): boolean {
  spawnSync('git', ['config', 'user.name', 'gv-bot-landing'], { cwd: WORK_DIR });
  spawnSync('git', ['config', 'user.email', 'bot@gentle-vanguard'], { cwd: WORK_DIR });
  spawnSync('git', ['add', '-A'], { cwd: WORK_DIR });
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const r = spawnSync('git', ['commit', '-m', `chore(landing): hardening minimo — .gitignore + README footer (${ts})`], { cwd: WORK_DIR, encoding: 'utf8' });
  if (r.status !== 0) {
    log('!', `Commit fallo: ${r.stderr.slice(0, 300)}`);
    return false;
  }
  const push = spawnSync('git', ['push', 'origin', BRANCH], { cwd: WORK_DIR, encoding: 'utf8' });
  if (push.status !== 0) {
    log('!', `Push fallo: ${push.stderr.slice(0, 300)}`);
    return false;
  }
  return true;
}

function main(): number {
  if (verifyOnly) {
    if (!clone()) return 1;
    const status = checkExisting();
    log('?', `gitignore: ${status.gitignore ? 'presente' : 'falta'}`);
    log('?', `readme footer: ${status.readme ? 'presente' : 'falta'}`);
    rmSync(WORK_DIR, { recursive: true, force: true });
    return status.gitignore && status.readme ? 0 : 2;
  }

  log('…', '=== Endurecimiento minimo del repo gentlevanguard/gentlevanguard.github.io ===');

  if (!clone()) return 1;
  const status = checkExisting();

  if (status.gitignore && status.readme) {
    log('+', 'Repo ya tiene .gitignore y README footer — noop');
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 0;
  }

  const result = applyChanges();
  for (const d of result.details) log(' ', d);

  if (!result.changed) {
    log('+', 'Nada que cambiar');
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 0;
  }

  if (dryRun) {
    log('…', 'Dry-run: cambios calculados, no se commitea');
    rmSync(WORK_DIR, { recursive: true, force: true });
    return 0;
  }

  log('…', 'Commiteando y pusheando');
  const ok = commitAndPush();
  rmSync(WORK_DIR, { recursive: true, force: true });

  if (ok) {
    log('+', 'Push OK al repo gentlevanguard/gentlevanguard.github.io');
  } else {
    log('!', 'Push fallo — ver mensaje arriba');
  }
  return ok ? 0 : 1;
}

main();
