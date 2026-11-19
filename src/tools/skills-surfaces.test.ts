import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { auditSurfaces, type Surface } from './skills-surfaces.ts';

const roots: string[] = [];

function fixture(skillNames: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'skills-surfaces-'));
  roots.push(root);
  for (const name of skillNames) {
    mkdirSync(join(root, 'skills', name), { recursive: true });
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
  return root;
}

function mirror(root: string, tool: string, skillNames: string[]): Surface {
  const path = join(root, tool, 'skills');
  for (const name of skillNames) {
    mkdirSync(join(path, name), { recursive: true });
    writeFileSync(join(path, name, 'SKILL.md'), `# ${name}\n`);
  }
  return { tool, path, kind: 'workspace' };
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('auditSurfaces', () => {
  it('counts canonical skills and marks a complete mirror ok', () => {
    const root = fixture(['alpha', 'beta', 'gamma']);
    const surface = mirror(root, 'complete-tool', ['alpha', 'beta']);
    const report = auditSurfaces([surface], root, ['alpha', 'beta']);
    assert.equal(report.canonical, 3);
    assert.equal(report.critical, 2);
    assert.equal(report.ok, true);
    const [entry] = report.surfaces;
    assert.equal(entry.present, true);
    assert.equal(entry.skills, 2);
    assert.equal(entry.criticalPresent, 2);
    assert.deepEqual(entry.criticalMissing, []);
  });

  it('flags a workspace mirror missing a critical skill', () => {
    const root = fixture(['alpha', 'beta']);
    const surface = mirror(root, 'stale-tool', ['alpha']);
    const report = auditSurfaces([surface], root, ['alpha', 'beta']);
    assert.equal(report.ok, false);
    assert.deepEqual(report.surfaces[0].criticalMissing, ['beta']);
  });

  it('reports extras without failing', () => {
    const root = fixture(['alpha']);
    const surface = mirror(root, 'extra-tool', ['alpha', 'legacy-stub']);
    const report = auditSurfaces([surface], root, ['alpha']);
    assert.equal(report.ok, true);
    assert.deepEqual(report.surfaces[0].extras, ['legacy-stub']);
  });

  it('fails a missing workspace surface but tolerates a missing host surface', () => {
    const root = fixture(['alpha']);
    const missingWorkspace: Surface = {
      tool: 'absent',
      path: join(root, 'absent', 'skills'),
      kind: 'workspace',
    };
    const missingHost: Surface = {
      tool: 'host',
      path: join(root, 'host', 'skills'),
      kind: 'host',
    };
    const workspaceReport = auditSurfaces([missingWorkspace], root, ['alpha']);
    assert.equal(workspaceReport.ok, false);
    assert.equal(workspaceReport.surfaces[0].present, false);
    assert.deepEqual(workspaceReport.surfaces[0].criticalMissing, ['alpha']);

    const hostReport = auditSurfaces([missingHost], root, ['alpha']);
    assert.equal(hostReport.ok, true);
  });

  it('ignores directories without SKILL.md', () => {
    const root = fixture(['alpha']);
    const surface = mirror(root, 'no-skill', []);
    mkdirSync(join(surface.path, 'empty-dir'), { recursive: true });
    const report = auditSurfaces([surface], root, ['alpha']);
    assert.equal(report.surfaces[0].skills, 0);
  });
});
