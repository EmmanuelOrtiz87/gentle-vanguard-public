#!/usr/bin/env node
/**
 * Unit Tests: skill plugin system (F3.4)
 * - Manifest validation (valid / invalid / unknown permission / gv-plugin.json)
 * - Registry lifecycle (install -> enable/disable/deprecate -> remove, integrity)
 * - Install from fixture directory (end-to-end, isolated tmp root)
 * - Refusal on secret-like content
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  manifestFromSkillMd,
  manifestFromGvPluginJson,
  resolveManifest,
  parseSkillFrontmatter,
} from '../../src/plugins/skill-manifest.ts';
import {
  listEntries,
  getEntry,
  setStatus,
  removeEntry,
  upsertEntry,
  verifyIndex,
} from '../../src/plugins/skill-registry.ts';
import { installSkill, removeSkill } from '../../src/plugins/skill-install.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'skill-plugins');

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'gv-skill-plugins-'));
}

// ─── Manifest: frontmatter parsing ──────────────────────────────────────────

test('parseSkillFrontmatter: nested metadata + folded description (real repo format)', () => {
  const fm = parseSkillFrontmatter(
    readFileSync(join(FIXTURES, 'valid-skill', 'SKILL.md'), 'utf-8'),
  );
  assert.strictEqual(fm.fields.name, 'demo-tutor-skill');
  assert.ok(fm.fields.description.length > 20, 'folded description is joined');
  assert.strictEqual(fm.nested.metadata.license, 'MIT');
  assert.strictEqual(fm.nested.metadata.version, '1.0.0');
  assert.match(fm.body, /^# Demo Tutor Skill/);
});

test('manifest: valid SKILL.md frontmatter passes', () => {
  const r = manifestFromSkillMd(readFileSync(join(FIXTURES, 'valid-skill', 'SKILL.md'), 'utf-8'));
  assert.ok(r.ok, `errors: ${r.errors.join('; ')}`);
  assert.strictEqual(r.manifest?.name, 'demo-tutor-skill');
  assert.strictEqual(r.manifest?.version, '1.0.0');
  assert.deepStrictEqual(r.manifest?.permissions, ['filesystem-read']);
  assert.strictEqual(r.manifest?.entrypoint, 'SKILL.md');
});

test('manifest: unknown permission is rejected', () => {
  const r = manifestFromSkillMd(
    readFileSync(join(FIXTURES, 'invalid-permission', 'SKILL.md'), 'utf-8'),
  );
  assert.ok(!r.ok);
  assert.ok(
    r.errors.some((e) => e.includes('permissions')),
    JSON.stringify(r.errors),
  );
});

test('manifest: none is exclusive with other permissions', () => {
  const r = manifestFromGvPluginJson({
    name: 'conflicting-skill',
    version: '1.0.0',
    description: 'A manifest that combines none with network and must fail.',
    permissions: ['none', 'network'],
  });
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes('none')));
});

test('manifest: bad name / bad semver rejected', () => {
  const bad = manifestFromGvPluginJson({
    name: 'Not_Kebab',
    version: '1.0',
    description: 'too short name and bad version both fail validation here.',
    permissions: ['none'],
  });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.includes('name')));
  assert.ok(bad.errors.some((e) => e.includes('semver')));
});

test('manifest: gv-plugin.json preferred over SKILL.md', () => {
  const r = resolveManifest(join(FIXTURES, 'gv-plugin-skill'));
  assert.ok(r.ok);
  assert.strictEqual(r.origin, 'gv-plugin.json');
  assert.deepStrictEqual(r.manifest?.permissions, ['network']);
  assert.strictEqual(r.manifest?.version, '2.1.3');
});

test('manifest: missing dir yields parseable error', () => {
  const r = resolveManifest(join(FIXTURES, 'does-not-exist'));
  assert.ok(!r.ok);
  assert.strictEqual(r.origin, 'none');
});

// ─── Registry lifecycle ──────────────────────────────────────────────────────

test('registry: install -> disable -> deprecate -> enable -> remove (idempotent state)', () => {
  const root = tmpRoot();
  try {
    const manifest = {
      name: 'lifecycle-skill',
      version: '1.0.0',
      description: 'Registry lifecycle test skill with a long enough description.',
      permissions: ['none'],
      entrypoint: 'SKILL.md',
    };
    upsertEntry(
      {
        manifest,
        origin: 'test://fixture',
        originType: 'local',
        checksum: 'a'.repeat(64),
        manifestOrigin: 'SKILL.md',
      },
      { root },
    );
    // Idempotent reinstall keeps first installedAt and status.
    upsertEntry(
      {
        manifest,
        origin: 'test://fixture-2',
        originType: 'local',
        checksum: 'a'.repeat(64),
        manifestOrigin: 'SKILL.md',
      },
      { root },
    );
    let e = getEntry('lifecycle-skill', { root });
    assert.ok(e);
    assert.strictEqual(e.status, 'enabled');
    assert.strictEqual(e.origin, 'test://fixture-2', 'metadata refreshed');
    const firstInstalledAt = e.installedAt;
    assert.ok(firstInstalledAt);

    assert.strictEqual(listEntries({ root }).length, 1);

    assert.ok(setStatus('lifecycle-skill', 'disabled', { root }).ok);
    assert.strictEqual(getEntry('lifecycle-skill', { root })?.status, 'disabled');
    assert.ok(setStatus('lifecycle-skill', 'deprecated', { root }).ok);
    assert.strictEqual(getEntry('lifecycle-skill', { root })?.status, 'deprecated');
    assert.ok(setStatus('lifecycle-skill', 'enabled', { root }).ok);

    // Remove cleans up; double remove fails.
    assert.ok(removeEntry('lifecycle-skill', { root }).ok);
    assert.ok(!removeEntry('lifecycle-skill', { root }).ok, 'double remove fails');
    assert.strictEqual(listEntries({ root }).length, 0);

    // Integrity hash tracks content — hand-editing the index is detected.
    assert.ok(verifyIndex({ root }).ok);
    const raw = JSON.parse(readFileSync(join(root, '.runtime', 'skill-plugins.json'), 'utf-8'));
    const injected = { name: 'injected', version: '9.9.9', description: 'tampered entry' };
    raw.skills['injected'] = injected;
    writeFileSync(join(root, '.runtime', 'skill-plugins.json'), JSON.stringify(raw));
    assert.ok(!verifyIndex({ root }).ok, 'tampered index detected');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── Install from fixture directory ─────────────────────────────────────────

test('install: local fixture installs, stamps frontmatter, lands in registry', async () => {
  const root = tmpRoot();
  try {
    const r = await installSkill(join(FIXTURES, 'valid-skill'), { root });
    assert.ok(r.ok, r.message);
    assert.strictEqual(r.name, 'demo-tutor-skill');

    const dest = join(root, 'skills', 'demo-tutor-skill', 'SKILL.md');
    assert.ok(existsSync(dest), 'skill copied into skills/');
    const stamped = readFileSync(dest, 'utf-8');
    assert.match(stamped, /source: external-installed/);
    assert.match(stamped, /installed-from: /);
    assert.match(stamped, /checksum: [0-9a-f]{64}/);
    assert.match(stamped, /^# Demo Tutor Skill/m, 'body preserved');

    const e = getEntry('demo-tutor-skill', { root });
    assert.ok(e);
    assert.strictEqual(e.status, 'enabled');
    assert.strictEqual(e.originType, 'local');
    assert.ok(e.checksum.length === 64);
    assert.ok(verifyIndex({ root }).ok);

    // Idempotent reinstall works and stays clean.
    const again = await installSkill(join(FIXTURES, 'valid-skill'), { root });
    assert.ok(again.ok, again.message);
    assert.strictEqual(listEntries({ root }).length, 1);

    // Remove cleans dir + entry.
    assert.ok(removeSkill('demo-tutor-skill', { root }).ok);
    assert.ok(!existsSync(dest));
    assert.ok(!getEntry('demo-tutor-skill', { root }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install: gv-plugin.json fixture installs with network permission', async () => {
  const root = tmpRoot();
  try {
    const r = await installSkill(join(FIXTURES, 'gv-plugin-skill'), { root });
    assert.ok(r.ok, r.message);
    const e = getEntry('gv-manifest-skill', { root });
    assert.deepStrictEqual(e?.permissions, ['network']);
    assert.strictEqual(e?.manifestOrigin, 'gv-plugin.json');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install: invalid manifest refused, nothing written', async () => {
  const root = tmpRoot();
  try {
    const r = await installSkill(join(FIXTURES, 'invalid-permission'), { root });
    assert.ok(!r.ok);
    assert.match(r.message, /manifest validation failed/);
    assert.ok(!existsSync(join(root, 'skills', 'bad-permission-skill')));
    assert.strictEqual(listEntries({ root }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install: secret-like content refused', async () => {
  const root = tmpRoot();
  try {
    const r = await installSkill(join(FIXTURES, 'secret-skill'), { root });
    assert.ok(!r.ok);
    assert.match(r.message, /secret-like content/);
    assert.ok(r.findings && r.findings.length > 0, 'scanner findings reported');
    assert.ok(!existsSync(join(root, 'skills', 'leaky-skill')));
    assert.strictEqual(listEntries({ root }).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
