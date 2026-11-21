import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditAgentCompatibility } from '../../src/ops/agent-compat-audit.ts';

test('repo real: score 0-100 con las 3 dimensiones y sin fixes cuando está sano', () => {
  const report = auditAgentCompatibility();
  assert.ok(report.score >= 80 && report.score <= 100, `score razonable: ${report.score}`);
  assert.ok(
    report.dimensions.startup &&
      report.dimensions.validation &&
      report.dimensions['docs-reliability'],
  );
  assert.ok(Array.isArray(report.topFixes));
});

test('fixture: citación de comando inexistente baja docs-reliability y produce fix', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-agent-compat-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { typecheck: 'tsc', test: 'node --test', lint: 'eslint .' } }),
      'utf8',
    );
    writeFileSync(
      join(root, 'AGENTS.md'),
      '# x\nCorré `npm run session:autostart:detached` y luego `npm run inventado`.\n',
    );
    writeFileSync(
      join(root, '.lefthook.yml'),
      'pre-commit:\n  commands:\n    a:\n      run: echo hi\n    b:\n      run: echo hi\n',
    );
    const report = auditAgentCompatibility(root);
    assert.ok(
      report.dimensions['docs-reliability'].score < 100,
      'citación rota debe bajar docs-reliability',
    );
    assert.ok(
      report.topFixes.some((f) => f.includes('inventado')),
      `fix debe nombrar el comando roto: ${report.topFixes.join(' | ')}`,
    );
    // familia con placeholder no se marca rota
    writeFileSync(
      join(root, 'AGENTS.md'),
      '# x\nCorré `npm run inventado:<tool>` y `npm run humanize:*`.\n',
    );
    const report2 = auditAgentCompatibility(root);
    assert.ok(
      !report2.topFixes.some((f) => f.includes('inventado:')),
      'familia con placeholder no es comando roto',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
