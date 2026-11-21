#!/usr/bin/env node

/**
 * Reproducible bootstrap for a checked-out Gentle-Vanguard distribution.
 *
 * This is intentionally conservative: it installs project dependencies only,
 * never downloads OS runtimes or secrets without an explicit external installer.
 * The NSIS installer can call the same phases after provisioning Node.
 *
 * Plan firmado (patrón rsc --accept-plan, absorbido 2026-10-21/11-12):
 *   1. `--dry-run`  → imprime el plan en stdout (JSON puro, stdout = contrato
 *      de datos) y lo serializa a `.runtime/bootstrap-plan.json` con su hash.
 *   2. Revisión: el plan se inspecciona fuera del proceso (owner/automatismo).
 *   3. `--accept-plan .runtime/bootstrap-plan.json` → recompone el plan contra
 *      el estado ACTUAL del repo y verifica el hash ANTES de ejecutar. Si el
 *      repo cambió desde la revisión (hash distinto), se niega: nunca ejecuta
 *      un plan que ya no describe la realidad. Sin `--accept-plan`, el
 *      bootstrap clásico sigue igual.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { runSync } from '../core/run-command.js';

const root = resolve(process.cwd());
const dryRun = process.argv.includes('--dry-run');
const full = process.argv.includes('--full');
const acceptIdx = process.argv.indexOf('--accept-plan');
const acceptPath = acceptIdx >= 0 ? process.argv[acceptIdx + 1] : null;

export interface BootstrapPhase {
  id: string;
  command: string;
  label: string;
}

export interface BootstrapPlan {
  id: 'bootstrap-plan-v1';
  root: string;
  full: boolean;
  phases: BootstrapPhase[];
  /** sha256 del JSON canónico SIN el campo hash (auto-referencia imposible). */
  hash?: string;
}

/** Fases que ejecutará el bootstrap, derivadas SOLO del estado del repo. */
export function computePhases(rootDir: string, fullMode: boolean): BootstrapPhase[] {
  const phases: BootstrapPhase[] = [];
  if (fullMode) {
    phases.push({
      id: 'install-missing-prereqs',
      command: `${process.execPath} --import tsx src/infrastructure/dependency-installer.ts`,
      label: 'Install missing prerequisites (best-effort)',
    });
  }
  phases.push({
    id: 'install-deps',
    command: 'pnpm install --frozen-lockfile',
    label: 'Install locked project dependencies',
  });
  phases.push({
    id: 'doctor',
    command: `${process.execPath} --import tsx src/infrastructure/installer-doctor.ts --strict`,
    label: 'Verify installed dependencies',
  });
  phases.push({
    id: 'nexus-init',
    command: `${process.execPath} --import tsx src/database/db-init.ts --quiet`,
    label: 'Initialize Nexus database',
  });
  if (existsSync(join(rootDir, '.git'))) {
    phases.push({
      id: 'hooks',
      command: 'npx lefthook install',
      label: 'Install repository hooks',
    });
  }
  if (fullMode) {
    phases.push({
      id: 'health',
      command: `${process.execPath} --import tsx src/core/maintenance-watchtower.ts --action health`,
      label: 'Run full stack health check',
    });
  }
  return phases;
}

export function buildPlan(rootDir: string, fullMode: boolean): BootstrapPlan {
  const plan: BootstrapPlan = {
    id: 'bootstrap-plan-v1',
    root: rootDir,
    full: fullMode,
    phases: computePhases(rootDir, fullMode),
  };
  plan.hash = sha256Of(plan);
  return plan;
}

export function sha256Of(planWithoutHash: Omit<BootstrapPlan, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(planWithoutHash)).digest('hex');
}

/** Verifica que el plan revisado siga describiendo la realidad actual. */
export function verifyPlan(reviewed: BootstrapPlan, current: BootstrapPlan): string | null {
  const reviewedBody = { ...reviewed, hash: undefined } as Omit<BootstrapPlan, 'hash'>;
  const recomputedHash = sha256Of(reviewedBody);
  if (reviewed.hash !== recomputedHash)
    return 'El plan revisado fue alterado después de su emisión (hash interno no coincide).';
  const currentBody = { ...current, hash: undefined } as Omit<BootstrapPlan, 'hash'>;
  if (recomputedHash !== sha256Of(currentBody))
    return 'El repo cambió desde la revisión del plan (fases/root/full distintas): re-emita el plan con --dry-run.';
  return null;
}

function command(phase: BootstrapPhase): boolean {
  // stdout = contrato de datos (bitácora 2026-11-20): las etiquetas son diagnóstico
  console.error(`${dryRun ? '[DRY-RUN] ' : ''}${phase.label}`);
  if (dryRun) return true;
  const [name, ...args] = phase.command.split(' ');
  const result = runSync(name, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    if (phase.id === 'install-missing-prereqs') {
      // Fail-open por diseño (el doctor --strict posterior es el enforcement duro).
      console.error(`Bootstrap continúa (fase best-effort falló): ${phase.label}`);
      return true;
    }
    console.error(`Bootstrap failed in: ${phase.label}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  if (
    !existsSync(join(root, 'package.json')) ||
    !existsSync(join(root, 'config', 'installer-manifest.json'))
  ) {
    console.error('Run the bootstrap from the Gentle-Vanguard repository root.');
    process.exit(2);
  }

  for (const directory of ['.runtime', '.session', '.telemetry']) {
    const path = join(root, directory);
    if (!existsSync(path) && !dryRun) mkdirSync(path, { recursive: true });
  }

  const plan = buildPlan(root, full);

  if (acceptPath) {
    if (!existsSync(acceptPath)) {
      console.error(`Plan revisado no encontrado: ${acceptPath}`);
      process.exit(2);
    }
    let reviewed: BootstrapPlan;
    try {
      reviewed = JSON.parse(readFileSync(acceptPath, 'utf8')) as BootstrapPlan;
    } catch {
      console.error('El plan revisado no es JSON válido.');
      process.exit(2);
    }
    const refusal = verifyPlan(reviewed, plan);
    if (refusal) {
      console.error(`--accept-plan RECHAZADO: ${refusal}`);
      process.exit(3);
    }
    console.error('[bootstrap] plan aceptado y verificado (hash coincide con el repo actual).');
  }

  // Full mode: instalar prereqs faltantes (no solo detectarlos) corre como
  // fase del plan (install-missing-prereqs, fail-open): el plan firmado
  // describe TODO lo que va a ejecutar, sin ejecuciones fuera del plan.

  for (const phase of plan.phases) {
    if (!command(phase)) process.exit(1);
  }

  if (dryRun) {
    // stdout es el contrato de datos: el plan completo sale en stdout y viaja
    // serializado con su hash para la revisión fuera del proceso.
    console.log(JSON.stringify(plan, null, 2));
    const planPath = join(root, '.runtime', 'bootstrap-plan.json');
    try {
      writeFileSync(planPath, JSON.stringify(plan, null, 2));
      console.error(
        `[bootstrap] plan serializado en ${planPath} (hash ${plan.hash?.slice(0, 12)}…). Revisión fuera del proceso → --accept-plan ${planPath}`,
      );
    } catch {
      // best-effort: la serialización no bloquea el dry-run
    }
    return;
  }

  console.log('Bootstrap completed. Next: npm run session:autostart:detached');
}

// CLI Guard: main() solo corre cuando este archivo es el proceso directo —
// importarlo (p.ej. para tests del plan) no ejecuta el bootstrap.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename ?? process.argv[1])
) {
  void main();
}
