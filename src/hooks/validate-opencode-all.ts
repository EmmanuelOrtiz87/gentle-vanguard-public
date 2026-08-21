#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';
import { validateOpencodeJsonSteps, validateAgentMdSteps } from '../opencode-guards.js';
import { db } from '../database/db.js';

function loadJson(p: string) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    console.error(`Invalid JSON: ${p}`);
    process.exit(2);
  }
}

function main(): number {
  const root = process.cwd();
  const opencodePath = join(root, 'opencode.json');
  const agentsDir = join(root, '.opencode', 'agents');

  let hasErrors = false;
  let errorCount = 0;

  const opencode = loadJson(opencodePath);
  if (!opencode) {
    console.error('opencode.json not found');
    return 2;
  }

  const jsonErrors = validateOpencodeJsonSteps(opencode, 'opencode.json');
  if (jsonErrors.length) {
    for (const e of jsonErrors) console.error(e);
    hasErrors = true;
    errorCount += jsonErrors.length;
  } else {
    console.log('opencode.json steps: OK');
  }

  if (!existsSync(agentsDir)) {
    console.warn('.opencode/agents not found, skipping agent MD checks');
    return hasErrors ? 1 : 0;
  }

  const files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const p = join(agentsDir, f);
    const errs = validateAgentMdSteps(p);
    if (errs.length) {
      for (const e of errs) console.error(e);
      hasErrors = true;
      errorCount += errs.length;
    }
  }

  if (hasErrors) {
    alertValidationFailure(errorCount);
    return 1;
  }

  console.log('All OpenCode validations passed');
  clearValidationAlert();
  return 0;
}

function alertValidationFailure(errors: number): void {
  try {
    const dbm = db();
    dbm.insertAlert({
      name: 'OpenCode validation failure',
      rule: 'opencode.validation',
      severity: 'critical',
      triggered: 1,
      actual: errors,
      threshold: 0,
      transition: 'fired',
    });
    dbm.insertEvent('opencode.validation', {
      status: 'failed',
      errors,
      timestamp: new Date().toISOString(),
    });
    console.error('Nexus alert created for validation failure');
  } catch (err) {
    console.error(
      'Failed to write validation alert to Nexus DB:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

function clearValidationAlert(): void {
  try {
    const dbm = db();
    dbm.insertAlert({
      name: 'OpenCode validation failure',
      rule: 'opencode.validation',
      severity: 'info',
      triggered: 0,
      actual: 0,
      threshold: 0,
      transition: 'resolved',
    });
    dbm.insertEvent('opencode.validation', {
      status: 'passed',
      errors: 0,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // No-op if DB is unavailable
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = main();
  process.exit(code);
}

export { main };
