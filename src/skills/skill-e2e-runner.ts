#!/usr/bin/env node
/** Runs deterministic skill probes and keeps evaluation evidence separate from production. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from '../core/run-command.js';
import { DatabaseManager } from '../database/nexus/manager.js';
import { CRITICAL_SKILLS } from '../integrations/zcode-sync.js';

interface LiveCase {
  id: string;
  skill: string;
  script: string;
  expectedPattern: string;
  timeoutMs: number;
}

interface LiveDataset {
  version: string;
  description: string;
  cases: LiveCase[];
}

interface ProbeResult extends LiveCase {
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  durationMs: number;
  reason: string;
  output: string;
}

export function evaluateLiveProbe(
  status: number | null,
  output: string,
  expectedPattern: string,
): { passed: boolean; reason: string } {
  if (status !== 0) {
    return { passed: false, reason: `command exited with status ${status ?? 'null'}` };
  }
  if (!output.toLowerCase().includes(expectedPattern.toLowerCase())) {
    return { passed: false, reason: `expected evidence not found: ${expectedPattern}` };
  }
  return { passed: true, reason: 'exit=0 and evidence matched' };
}

function isInfrastructureBlocked(output: string): boolean {
  return /spawn eperm|spawn eacces|permission denied|operation not permitted/i.test(output);
}

function checkCriticalContracts(root: string): Array<{
  skill: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}> {
  return CRITICAL_SKILLS.map((skill) => {
    const path = join(
      root,
      skill.root === 'opencode' ? '.opencode/skills' : 'skills',
      skill.dir,
      'SKILL.md',
    );
    if (!existsSync(path)) return { skill: skill.dir, status: 'FAIL', detail: 'SKILL.md missing' };
    const content = readFileSync(path, 'utf8');
    const valid = /^---[\s\S]*?^name:\s*.+$[\s\S]*?^description:\s*/m.test(content);
    return {
      skill: skill.dir,
      status: valid ? 'PASS' : 'FAIL',
      detail: valid ? 'metadata contract valid' : 'name or description missing',
    };
  });
}

function renderMarkdown(report: {
  generatedAt: string;
  contracts: ReturnType<typeof checkCriticalContracts>;
  probes: ProbeResult[];
}): string {
  const contractPass = report.contracts.filter((item) => item.status === 'PASS').length;
  const probePass = report.probes.filter((item) => item.status === 'PASS').length;
  const lines = [
    '# Skill E2E Qualification',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Contract coverage: ${contractPass}/${report.contracts.length}`,
    `- Live probes: ${probePass}/${report.probes.length} PASS`,
    `- Blocked: ${report.probes.filter((item) => item.status === 'BLOCKED').length}`,
    `- Failed: ${report.probes.filter((item) => item.status === 'FAIL').length}`,
    '',
    '| Skill | Probe | Status | Duration | Evidence |',
    '| --- | --- | --- | ---: | --- |',
  ];
  for (const probe of report.probes) {
    lines.push(
      `| ${probe.skill} | ${probe.id} | ${probe.status} | ${probe.durationMs} ms | ${probe.reason.replace(/\|/g, '\\|')} |`,
    );
  }
  lines.push('', 'Evaluation outcomes never contribute to lifecycle decisions.', '');
  return lines.join('\n');
}

export function runSkillE2E(root = process.cwd(), record = true): {
  generatedAt: string;
  contracts: ReturnType<typeof checkCriticalContracts>;
  probes: ProbeResult[];
  status: 'PASS' | 'FAIL';
} {
  const dataset = JSON.parse(
    readFileSync(join(root, 'tests', 'eval', 'skill-live-cases.json'), 'utf8'),
  ) as LiveDataset;
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const criticalNames = new Set(CRITICAL_SKILLS.map((skill) => skill.dir));
  const probes: ProbeResult[] = [];

  for (const liveCase of dataset.cases) {
    if (!criticalNames.has(liveCase.skill) || !packageJson.scripts?.[liveCase.script]) {
      probes.push({
        ...liveCase,
        status: 'FAIL',
        durationMs: 0,
        reason: !criticalNames.has(liveCase.skill)
          ? 'skill is not in the critical registry'
          : `package script missing: ${liveCase.script}`,
        output: '',
      });
      continue;
    }
    const started = performance.now();
    const result = runSync('npm', ['run', liveCase.script], {
      cwd: root,
      timeout: liveCase.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    const durationMs = Number((performance.now() - started).toFixed(2));
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const evaluation = evaluateLiveProbe(result.status, output, liveCase.expectedPattern);
    const blocked = !evaluation.passed && isInfrastructureBlocked(output);
    const status: ProbeResult['status'] = evaluation.passed
      ? 'PASS'
      : blocked
        ? 'BLOCKED'
        : 'FAIL';
    const probe = {
      ...liveCase,
      status,
      durationMs,
      reason: blocked ? 'execution blocked by host permissions' : evaluation.reason,
      output: output.slice(-2000),
    };
    probes.push(probe);
    if (record && status !== 'BLOCKED') {
      DatabaseManager.getInstance().recordSkillOutcome(liveCase.skill, status === 'PASS', {
        sessionId: `skill-e2e:${dataset.version}`,
        durationMs,
        tool: 'skill-e2e-runner',
        detail: `${liveCase.id}: ${probe.reason}`,
        evidenceKind: 'evaluation',
      });
    }
  }

  const contracts = checkCriticalContracts(root);
  return {
    generatedAt: new Date().toISOString(),
    contracts,
    probes,
    status:
      contracts.every((item) => item.status === 'PASS') &&
      probes.every((item) => item.status === 'PASS')
        ? 'PASS'
        : 'FAIL',
  };
}

function main(): void {
  const report = runSkillE2E(process.cwd(), !process.argv.includes('--no-record'));
  const outDir = resolve('reports', 'audits');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'skill-e2e-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, 'skill-e2e-latest.md'), renderMarkdown(report));
  console.log(JSON.stringify(report, null, 2));
  if (report.status === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
