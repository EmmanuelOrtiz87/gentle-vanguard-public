#!/usr/bin/env node
/**
 * Model Profile Switcher — multi-profile-per-SDD-phase convention (gentle-ai).
 *
 * Reads config/model-router.json `profiles` section and applies a named profile
 * set (cheap/balanced/premium) to the per-phase agent bindings. Each profile
 * overrides temperature + hallucinationGuard per SDD phase (BA/SAD/DEV/QA).
 *
 * The model itself is unchanged (single native model in this environment); the
 * value is the per-phase temperature/guard tuning.
 *
 * Usage:
 *   npx tsx src/model-profile-switcher.ts --list
 *   npx tsx src/model-profile-switcher.ts --set premium
 *   npx tsx src/model-profile-switcher.ts --set cheap --apply
 *   npx tsx src/model-profile-switcher.ts --status
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const ROUTER_PATH = join(ROOT, 'config', 'model-router.json');

interface PhaseOverride {
  temperature: number;
  hallucinationGuard: string;
}

interface ProfileSet {
  description: string;
  phases: Record<string, PhaseOverride>;
}

interface RouterConfig {
  profiles?: {
    active: string;
    available: string[];
    sets: Record<string, ProfileSet>;
  };
  agentBindings?: Record<string, { temperature?: number; hallucinationGuard?: string }>;
}

function loadRouter(): RouterConfig {
  if (!existsSync(ROUTER_PATH)) {
    throw new Error(`model-router.json not found at ${ROUTER_PATH}`);
  }
  return JSON.parse(readFileSync(ROUTER_PATH, 'utf-8')) as RouterConfig;
}

function saveRouter(config: RouterConfig): void {
  writeFileSync(ROUTER_PATH, JSON.stringify(config, null, 2) + '\n');
}

function listProfiles(): void {
  const config = loadRouter();
  const profiles = config.profiles;
  if (!profiles) {
    console.log('No profiles section in model-router.json');
    return;
  }
  console.log(`Active profile: ${profiles.active}`);
  console.log(`Available: ${profiles.available.join(', ')}`);
  for (const [name, set] of Object.entries(profiles.sets)) {
    const marker = name === profiles.active ? ' *' : '';
    console.log(`\n[${name}]${marker} — ${set.description}`);
    for (const [phase, ov] of Object.entries(set.phases)) {
      console.log(`  ${phase}: temp=${ov.temperature}, guard=${ov.hallucinationGuard}`);
    }
  }
}

function applyProfile(name: string, persist: boolean): void {
  const config = loadRouter();
  const profiles = config.profiles;
  if (!profiles) throw new Error('No profiles section in model-router.json');
  if (!profiles.sets[name]) {
    throw new Error(`Unknown profile "${name}". Available: ${profiles.available.join(', ')}`);
  }

  const set = profiles.sets[name];
  const bindings = config.agentBindings ?? {};

  // Map SDD phase codes to agent binding keys.
  const phaseToBinding: Record<string, string> = {
    BA: 'BA',
    SAD: 'SAD',
    DEV: 'DEV',
    QA: 'QA',
  };

  let applied = 0;
  for (const [phase, ov] of Object.entries(set.phases)) {
    const bindingKey = phaseToBinding[phase];
    if (bindingKey && bindings[bindingKey]) {
      bindings[bindingKey].temperature = ov.temperature;
      bindings[bindingKey].hallucinationGuard = ov.hallucinationGuard;
      applied++;
    }
  }

  if (persist) {
    profiles.active = name;
    saveRouter(config);
    console.log(
      `[OK] Applied profile "${name}" to ${applied} phase bindings and persisted as active.`,
    );
  } else {
    console.log(`[DRY-RUN] Would apply profile "${name}" to ${applied} phase bindings.`);
  }
}

function status(): void {
  const config = loadRouter();
  const profiles = config.profiles;
  if (!profiles) {
    console.log('No profiles section in model-router.json');
    return;
  }
  console.log(`Active profile: ${profiles.active}`);
  const set = profiles.sets[profiles.active];
  if (set) {
    console.log(`Description: ${set.description}`);
    for (const [phase, ov] of Object.entries(set.phases)) {
      console.log(`  ${phase}: temp=${ov.temperature}, guard=${ov.hallucinationGuard}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    listProfiles();
  } else if (args.includes('--status')) {
    status();
  } else if (args.includes('--set')) {
    const idx = args.indexOf('--set');
    const name = args[idx + 1];
    if (!name) {
      console.error('Usage: --set <profile> [--apply]');
      process.exit(1);
    }
    const persist = args.includes('--apply');
    try {
      applyProfile(name, persist);
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
  } else {
    console.log('Usage:');
    console.log('  npx tsx src/model-profile-switcher.ts --list');
    console.log('  npx tsx src/model-profile-switcher.ts --set <profile> [--apply]');
    console.log('  npx tsx src/model-profile-switcher.ts --status');
  }
}
