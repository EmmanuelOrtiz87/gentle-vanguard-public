// Design canon + repo organization checks (NORM-ORG-001 / NORM-DESIGN-SYSTEM rev2).
//
//   1. design-canon — runs `npm run conformance` of packages/gv-design-system
//      (28 checks: shell contract, brand assets byte-identity, superseded
//      palette grep, font loading, SoT↔dist sync, legacy dormant, CLI config).
//
//   2. repo-organization — lightweight structural checks:
//        a) dated/one-off files loose in repo ROOT (must live in .archive/ or docs)
//        b) forbidden tracked paths via git ls-files (runtime captures, build
//           artifacts, duplicated skill surfaces — NORM-ORG-001 §5)
//
// Status mapping:
//   design-canon:      PASS exit 0 · FAIL otherwise (canon drift is real drift)
//   repo-organization: PASS clean · WARN <=3 findings · FAIL >3 or forbidden paths

import { spawnSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { addResult, ROOT } from './context';
import { log } from '../../utils/logger.js';

const logger = log('CORE-WATCHTOWER-CHECKS-DESIGN-CANON');

const FORBIDDEN_TRACKED_PREFIXES = [
  '.playwright-cli/',
  'packages/brand/dist/',
  '.opencode/skills/',
  '.antigravity/skills/',
  '.github/skills/',
  '.codex/skills/',
  '.agents/skills/',
  '.zcode/skills/',
  '.continue/skills/',
];

// Root is for entry points and stable docs only. Dated one-offs belong in
// .archive/ (NORM-ORG-001 §2).
const DATED_IN_ROOT = /20\d{2}-\d{2}-\d{2}|_[12][90]\d{6}|-20\d{6}/;

export async function checkDesignCanon(): Promise<void> {
  logger.info('  [Design Canon] conformance del paquete gv-design-system...');

  const pkg = join(ROOT, 'packages', 'gv-design-system');
  if (!existsSync(pkg)) {
    addResult('design-canon', 'conformance', 'WARN', 'paquete gv-design-system ausente', 'ok');
    return;
  }

  const r = spawnSync('npm', ['run', 'conformance', '--silent'], {
    cwd: pkg,
    encoding: 'utf8',
    timeout: 120_000,
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));

  if (r.status === 0) {
    addResult(
      'design-canon',
      'conformance',
      'PASS',
      'conformance gv-design-system verde (shell + brand canon + organización visual)',
      'ok',
    );
    return;
  }
  addResult(
    'design-canon',
    'conformance',
    'FAIL',
    `${fails.length || '?'} check(s) de canon fallando: ${fails.slice(0, 3).join(' | ') || out.slice(-200)}`,
    'npm run conformance --prefix packages/gv-design-system (detalles y fix por check)',
    true,
  );
}

export async function checkRepoOrganization(): Promise<void> {
  logger.info('  [Repo Organization] raíz limpia + single-source...');

  const findings: string[] = [];

  // a) Dated one-off files loose in ROOT.
  try {
    for (const name of readdirSync(ROOT)) {
      const p = join(ROOT, name);
      if (!statSync(p).isFile()) continue;
      if (!/\.(md|png|jpg|zip)$/i.test(name)) continue;
      if (DATED_IN_ROOT.test(name)) findings.push(`root fechado: ${name}`);
    }
  } catch {
    addResult('repo-organization', 'structure', 'WARN', 'raíz no legible', 'ok');
    return;
  }

  // b) Forbidden tracked paths (runtime/build artifacts, duplicated skills).
  const git = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (git.status === 0) {
    const tracked = git.stdout.split('\n');
    for (const line of tracked) {
      if (FORBIDDEN_TRACKED_PREFIXES.some((prefix) => line.startsWith(prefix))) {
        findings.push(`trackeado prohibido: ${line}`);
        if (findings.length > 10) break;
      }
    }
  }

  if (findings.length === 0) {
    addResult(
      'repo-organization',
      'structure',
      'PASS',
      'raíz sin fechados sueltos + single-source de skills/assets OK (NORM-ORG-001)',
      'ok',
    );
    return;
  }
  const critical = findings.some((f) => f.startsWith('trackeado prohibido')) || findings.length > 3;
  addResult(
    'repo-organization',
    'structure',
    critical ? 'FAIL' : 'WARN',
    `${findings.length} hallazgo(s): ${findings.slice(0, 4).join(' | ')}`,
    'mover a .archive/ o git rm --cached según NORM-ORG-001',
    critical,
  );
}
