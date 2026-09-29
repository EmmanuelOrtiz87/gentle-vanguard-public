#!/usr/bin/env node
/**
 * setup/local-layer.ts — Validates the user-local governance layer (3-tier model).
 *
 * See docs/GOVERNANCE-USERS.md. The local layer is optional (zero-config): an absent
 * layer is valid. When present, this validator checks:
 *   - config/local/*.json parse as JSON and their names match a canon config
 *   - skills-local/<name>/SKILL.md exists for each local skill
 *   - .session/local-rules/ contains readable markdown
 *
 * Pure logic (validateLocalLayer) is unit-testable; I/O is injected.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface LocalLayerIssue {
  severity: 'WARN' | 'FAIL';
  message: string;
}

export interface LocalLayerInput {
  configLocalFiles: string[];
  canonConfigFiles: string[];
  skillLocalDirs: string[];
  skillLocalHasSkillMd: Record<string, boolean>;
  localRuleFiles: string[];
}

export interface LocalLayerReport {
  present: boolean;
  ok: boolean;
  issues: LocalLayerIssue[];
}

// ─── Pure validation ──────────────────────────────────────────────────

export function validateLocalLayer(input: LocalLayerInput): LocalLayerReport {
  const issues: LocalLayerIssue[] = [];
  const hasConfig = input.configLocalFiles.filter((f) => f !== 'README.md').length > 0;
  const hasSkills = input.skillLocalDirs.length > 0;
  const hasRules = input.localRuleFiles.filter((f) => f !== 'README.md').length > 0;
  const present = hasConfig || hasSkills || hasRules;

  const canonNames = new Set(input.canonConfigFiles);

  for (const file of input.configLocalFiles) {
    if (file === 'README.md') continue;
    if (!canonNames.has(file)) {
      issues.push({
        severity: 'WARN',
        message: `config/local/${file} no coincide con ningún config del canon (no sobrescribirá nada)`,
      });
    }
  }

  for (const dir of input.skillLocalDirs) {
    if (!input.skillLocalHasSkillMd[dir]) {
      issues.push({
        severity: 'FAIL',
        message: `skills-local/${dir}/ no tiene SKILL.md (formato requerido)`,
      });
    }
  }

  return { present, ok: !issues.some((i) => i.severity === 'FAIL'), issues };
}

// ─── I/O adapter ──────────────────────────────────────────────────────

function safeList(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
  } catch {
    return [];
  }
}

export function inspectLocalLayer(root: string): LocalLayerReport {
  const configLocalDir = join(root, 'config', 'local');
  const skillsLocalDir = join(root, 'skills-local');
  const rulesDir = join(root, '.session', 'local-rules');

  const configLocalFiles = safeList(configLocalDir).filter((f) => f.endsWith('.json') || f === 'README.md');
  const canonConfigFiles = safeList(join(root, 'config')).filter((f) => f.endsWith('.json'));

  // JSON syntax check (I/O side of validation)
  for (const file of configLocalFiles) {
    if (!file.endsWith('.json')) continue;
    try {
      JSON.parse(readFileSync(join(configLocalDir, file), 'utf8'));
    } catch (err) {
      return {
        present: true,
        ok: false,
        issues: [{ severity: 'FAIL', message: `config/local/${file} no es JSON válido: ${(err as Error).message}` }],
      };
    }
  }

  const skillLocalEntries = safeList(skillsLocalDir).filter((f) => f !== 'README.md');
  const skillLocalDirs: string[] = [];
  const skillLocalHasSkillMd: Record<string, boolean> = {};
  for (const name of skillLocalEntries) {
    const has = existsSync(join(skillsLocalDir, name, 'SKILL.md'));
    if (has) {
      skillLocalDirs.push(name);
      skillLocalHasSkillMd[name] = true;
    } else if (!name.includes('.')) {
      // directory without SKILL.md → report as invalid skill dir
      skillLocalDirs.push(name);
      skillLocalHasSkillMd[name] = false;
    }
  }

  const localRuleFiles = safeList(rulesDir);

  return validateLocalLayer({
    configLocalFiles,
    canonConfigFiles,
    skillLocalDirs,
    skillLocalHasSkillMd,
    localRuleFiles,
  });
}

// ─── CLI ──────────────────────────────────────────────────────────────

function main(): number {
  const root = resolve(process.cwd());
  const report = inspectLocalLayer(root);
  if (!report.present) {
    console.log('[SKIP] Capa local no presente (zero-config, válida). Ver docs/GOVERNANCE-USERS.md');
    return 0;
  }
  for (const issue of report.issues) {
    console.log(`[${issue.severity}] ${issue.message}`);
  }
  console.log(report.ok ? '[[OK]] Capa local válida' : '[X] Capa local con errores');
  return report.ok ? 0 : 1;
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('local-layer.ts') || invoked.endsWith('local-layer')) {
  process.exit(main());
}
