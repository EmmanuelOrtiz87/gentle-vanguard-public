import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, classifyPath } from '../../src/ops/worktree-consolidation-report.js';

test('classifies GV Knowledge Ops paths as one feature block', () => {
  assert.equal(classifyPath('apps/gv-knowledge-ops/server/db.mjs').id, 'gv-knowledge-ops');
  assert.equal(classifyPath('docs/apps/GV-KNOWLEDGE-OPS-PLAN-2026-10.md').id, 'gv-knowledge-ops');
  assert.equal(classifyPath('src/ops/gv-knowledge-refresh-scheduled.ts').id, 'gv-knowledge-ops');
});

test('classifies Codex Engram doctor hardening paths together', () => {
  assert.equal(classifyPath('src/ops/stack-doctor.ts').id, 'codex-engram-doctor');
  assert.equal(classifyPath('tests/unit/stack-doctor.test.ts').id, 'codex-engram-doctor');
  assert.equal(classifyPath('docs/architecture/codex-engram-runtime-binding.md').id, 'codex-engram-doctor');
});

test('classifies consolidation tooling and carries suggested checks', () => {
  const block = classifyPath('src/ops/worktree-consolidation-report.ts');
  assert.equal(block.id, 'consolidation-tooling');
  assert.ok(block.suggestedChecks.includes('npm run -s stack:consolidation'));
});

test('builds a deterministic consolidation report from git status entries', () => {
  const report = buildReport(
    'C:/Workspace_local/gentle-vanguard',
    [
      { status: ' M', path: 'docs/clientes/whatsapp-bot-viandas/README.md' },
      { status: '??', path: 'apps/gv-knowledge-ops/README.md' },
      { status: ' M', path: 'src/ops/stack-doctor.ts' },
      { status: '??', path: 'unknown/new-file.txt' },
    ],
    '2026-10-14T00:00:00.000Z',
  );
  assert.equal(report.readOnly, true);
  assert.equal(report.totalFiles, 4);
  assert.deepEqual(
    report.blocks.map((block) => block.id),
    ['codex-engram-doctor', 'commercial-client-docs', 'gv-knowledge-ops', 'uncategorized'],
  );
  assert.equal(report.blocks.find((block) => block.id === 'commercial-client-docs')?.risk, 'high');
  assert.equal(report.blocks.find((block) => block.id === 'gv-knowledge-ops')?.files[0]?.state, 'untracked');
  assert.ok(
    report.blocks
      .find((block) => block.id === 'codex-engram-doctor')
      ?.suggestedChecks.includes('npm run -s stack:doctor -- --json'),
  );
});
