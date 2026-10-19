import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canTransition,
  loadManifest,
  loadPlatformRegistry,
  packageJob,
  previewJob,
  transition,
  validate,
  type Job,
  type PlatformRegistry,
} from '../../src/content-operations/engine.js';
import { preparePublication } from '../../src/content-operations/publication.js';
import { buildShortQueueIntent, createJobFromShortRequest } from '../../src/content-operations/shorts.js';

const baseJob: Job = {
  id: 'TEST-001',
  date: '2026-08-18',
  timezone: 'America/Argentina/San_Juan',
  platform: 'linkedin',
  campaign: 'TEST',
  theme: 'Test',
  contentType: 'test',
  copy: 'Contenido de prueba',
  status: 'DRAFT',
  approvalRequired: true,
};

test('content operations validates a complete job', () => {
  assert.deepEqual(validate(baseJob), []);
});

test('content operations previews a valid job without mutating it', () => {
  const registry: PlatformRegistry = {
    version: '1.0.0',
    platforms: { linkedin: { mode: 'adapter', media: true, approvalRequired: true } },
  };
  const result = previewJob({ ...baseJob, asset: 'assets/example.png' }, registry);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.publishStatus, 'READY_FOR_APPROVAL');
    assert.deepEqual(result.data.errors, []);
  }
});

test('content operations preview blocks invalid remote jobs', () => {
  const registry: PlatformRegistry = {
    version: '1.0.0',
    platforms: { tiktok: { mode: 'adapter', media: true, approvalRequired: true } },
  };
  const result = previewJob({ ...baseJob, id: 'TEST-PREVIEW', platform: 'tiktok', approvalRequired: false }, registry);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.publishStatus, 'BLOCKED');
    assert.ok(result.data.errors.includes('approvalRequired must be true for remote publication'));
  }
});

test('publication planning is fail-closed until approval and target are present', () => {
  const registry: PlatformRegistry = {
    version: '1.0.0',
    platforms: { tiktok: { mode: 'adapter', media: true, approvalRequired: true } },
  };
  const blocked = preparePublication({ ...baseJob, platform: 'tiktok', asset: 'video.mp4' }, registry);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error.message, /APPROVED/);

  const ready = preparePublication(
    { ...baseJob, platform: 'tiktok', asset: 'video.mp4', status: 'APPROVED' },
    registry,
    { accountId: 'tiktok-account-1' },
  );
  assert.equal(ready.ok, true);
  if (ready.ok) {
    assert.equal(ready.data.dryRun, true);
    assert.equal(ready.data.adapter, 'tiktok-content-posting');
    assert.equal(ready.data.target.accountId, 'tiktok-account-1');
  }
});

test('ContentOS creates an auditable draft from gv-shorts-core input', () => {
  const job = createJobFromShortRequest({
    id: 'SHORT-001',
    date: '2026-10-10',
    campaign: 'GV KNOWLEDGE',
    theme: 'ContentOS',
    request: {
      brief: 'Explicar como funciona el stack local-first de Gentle-Vanguard',
      platform: 'youtube',
      aspect: '9:16',
      durationSec: 30,
    },
    asset: 'runtime/shorts/SHORT-001.mp4',
  });
  assert.equal(job.platform, 'youtube');
  assert.equal(job.contentType, 'short-video');
  assert.equal(job.status, 'DRAFT');
  assert.equal(job.approvalRequired, true);
  assert.equal(job.copy, 'Explicar como funciona el stack local-first de Gentle-Vanguard');
});

test('short queue intent is deterministic and idempotent', () => {
  const request = { brief: 'Crear un short sobre el stack GV', platform: 'tiktok' as const, aspect: '9:16' as const, durationSec: 30 };
  const first = buildShortQueueIntent({ id: 'same-input', request });
  const second = buildShortQueueIntent({ id: 'same-input', request });
  assert.deepEqual(first, second);
  assert.match(first.eventId, /^short-[a-f0-9]{24}$/);
});

test('content operations rejects remote jobs without approval', () => {
  const job = { ...baseJob, id: 'TEST-002', approvalRequired: false };
  assert.ok(validate(job).includes('approvalRequired must be true for remote publication'));
});

test('content operations rejects invalid date format', () => {
  const job = { ...baseJob, id: 'TEST-003', date: '18-08-2026' };
  assert.ok(validate(job).some((e) => e.includes('invalid date format')));
});

test('content operations rejects unknown platform when registry provided', () => {
  const registry: PlatformRegistry = {
    version: '1.0.0',
    platforms: { linkedin: { mode: 'adapter', media: true, approvalRequired: true } },
  };
  const job = { ...baseJob, id: 'TEST-004', platform: 'myspace' };
  assert.ok(validate(job, registry).some((e) => e.includes('unknown platform')));
});

test('content operations warns when media platform has no asset', () => {
  const registry: PlatformRegistry = {
    version: '1.0.0',
    platforms: { linkedin: { mode: 'adapter', media: true, approvalRequired: true } },
  };
  const job = { ...baseJob, id: 'TEST-005', asset: undefined };
  assert.ok(validate(job, registry).some((e) => e.includes('asset is recommended')));
});

test('content operations state machine allows valid transitions', () => {
  assert.equal(canTransition('DRAFT', 'VALIDATED'), true);
  assert.equal(canTransition('VALIDATED', 'PACKAGED'), true);
  assert.equal(canTransition('PACKAGED', 'REVIEW'), true);
  assert.equal(canTransition('REVIEW', 'APPROVED'), true);
  assert.equal(canTransition('APPROVED', 'PUBLISHED'), true);
  assert.equal(canTransition('PUBLISHED', 'MEASURED'), true);
  assert.equal(canTransition('FAILED', 'DRAFT'), true);
});

test('content operations state machine rejects invalid transitions', () => {
  assert.equal(canTransition('DRAFT', 'PUBLISHED'), false);
  assert.equal(canTransition('APPROVED', 'DRAFT'), false);
  assert.equal(canTransition('MEASURED', 'REVIEW'), false);
});

test('content operations transition returns a new job', () => {
  const next = transition(baseJob, 'VALIDATED');
  assert.equal(next.status, 'VALIDATED');
  assert.equal(baseJob.status, 'DRAFT'); // immutability
});

test('content operations transition throws on invalid edge', () => {
  assert.throws(() => transition(baseJob, 'PUBLISHED'), /Invalid transition/);
});

test('content operations packages a job without network access', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-content-operations-'));
  const output = packageJob(root, baseJob);

  assert.equal(existsSync(join(output, 'caption.txt')), true);
  assert.equal(existsSync(join(output, 'publication.json')), true);
  assert.equal(readFileSync(join(output, 'STATUS.txt'), 'utf8'), 'REVIEW\n');
});

test('content operations packaging is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-content-operations-'));
  const first = packageJob(root, baseJob);
  const pubPath = join(first, 'publication.json');
  const before = readFileSync(pubPath, 'utf8');
  const second = packageJob(root, baseJob);
  const after = readFileSync(pubPath, 'utf8');

  assert.equal(first, second);
  assert.equal(before, after); // not rewritten
});

test('content operations manifest is readable', () => {
  const root = process.cwd();
  const jobs = loadManifest(root);
  assert.ok(jobs.length >= 3);
  assert.ok(jobs.every((job) => job.approvalRequired));
});

test('content operations platform registry is readable', () => {
  const root = process.cwd();
  const registry = loadPlatformRegistry(root);
  assert.ok(registry.platforms.linkedin);
  assert.equal(registry.platforms.linkedin.mode, 'adapter');
  assert.ok(registry.platforms.github);
  assert.equal(registry.platforms.github.mode, 'native-repo');
});

test('content operations manifest jobs pass validation against registry', () => {
  const root = process.cwd();
  const jobs = loadManifest(root);
  const registry = loadPlatformRegistry(root);
  for (const job of jobs) {
    const errors = validate(job, registry);
    assert.deepEqual(errors, [], `${job.id} should be valid: ${errors.join('; ')}`);
  }
});

test('content operations saveManifest round-trips', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-content-operations-'));
  const manifestDir = join(root, 'content/operations');
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, 'master-manifest.json');
  writeFileSync(manifestPath, JSON.stringify([baseJob], null, 2), 'utf8');
  const jobs = loadManifest(root);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'TEST-001');
});
