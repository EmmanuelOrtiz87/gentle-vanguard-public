import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRows, render, writeReport } from '../../src/tools/comparative-benchmark.js';

test('files and agent counts establish declared capability, never execution or peer ranking', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-comparison-'));
  mkdirSync(join(root, 'config')); writeFileSync(join(root, 'config/agents.json'), JSON.stringify({ version: 1, agents: [{ id: 'a' }, { id: 'b' }] }));
  const rows = buildRows(root);
  const agents = rows.find(row => row.dimension === 'Agentes')!;
  assert.equal(agents.level, 'declared'); assert.match(agents.evidence, /2 agentes/);
  const output = render(rows);
  assert.match(output, /No establece paridad ni superioridad/);
  assert.doesNotMatch(output, /runtime-verified|GV lidera|total:.*%/);
});

test('report creation preserves existing user reports', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-report-'));
  const path = join(root, 'report.md'); writeFileSync(path, 'owner');
  assert.throws(() => writeReport(path, 'replacement'));
  assert.equal(readFileSync(path, 'utf8'), 'owner');
});
