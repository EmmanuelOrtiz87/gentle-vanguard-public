#!/usr/bin/env node
/** Safe, read-only diagnostic for Codex skill assets. It never deletes or rewrites files. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { compareSkillTrees } from '../integrations/tool-interoperability-audit.js';

const ROOT = resolve(process.cwd());
const SOURCE = join(ROOT, 'skills');
const TARGET = join(homedir(), '.codex', 'skills');
const CHECKED_SKILLS = ['gv-shorts-skill', 'impeccable'];

export type CodexAssetsDoctorReport = {
  ok: boolean;
  source: string;
  target: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  missingTarget: boolean;
  critical: { skill: string; status: 'fresh' | 'missing' | 'changed' | 'extra' }[];
  unknownExtras: string[];
  managedExtras: string[];
  safe: true;
};

function doctor(): CodexAssetsDoctorReport {
  if (!existsSync(TARGET)) {
    return { ok: false, source: SOURCE, target: TARGET, status: 'FAIL', missingTarget: true, critical: [], unknownExtras: [], managedExtras: [], safe: true };
  }
  const critical: CodexAssetsDoctorReport['critical'] = [];
  const managedExtras: string[] = [];
  const unknownExtras: string[] = [];
  for (const skill of CHECKED_SKILLS) {
    const sourceSkill = join(SOURCE, skill);
    const targetSkill = join(TARGET, skill);
    if (!existsSync(targetSkill)) {
      critical.push({ skill, status: 'missing' });
      continue;
    }
    const comparison = compareSkillTrees(sourceSkill, targetSkill);
    const differences = comparison.differences;
    const meaningful = differences.filter((item) => !item.startsWith('unexpected:'));
    if (meaningful.some((item) => item.startsWith('missing:'))) critical.push({ skill, status: 'missing' });
    else if (meaningful.some((item) => item.startsWith('changed:'))) critical.push({ skill, status: 'changed' });
    else if (differences.some((item) => item.startsWith('unexpected:'))) critical.push({ skill, status: 'extra' });
    else critical.push({ skill, status: 'fresh' });
    for (const item of differences.filter((entry) => entry.startsWith('unexpected:')).map((entry) => entry.slice(11))) {
      if (skill === 'impeccable') managedExtras.push(`${skill}/${item}`);
      else unknownExtras.push(`${skill}/${item}`);
    }
  }
  const status = critical.some((item) => item.status === 'missing' || item.status === 'changed') || unknownExtras.length ? 'WARN' : 'PASS';
  return { ok: status === 'PASS', source: SOURCE, target: TARGET, status, missingTarget: false, critical, unknownExtras, managedExtras, safe: true };
}

const report = doctor();
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1;
