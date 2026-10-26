import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runUpstreamWatch, sourceSig, releaseContent, registerWeekly } from '../../src/ops/upstream-watch.js';

test('failed alert delivery retains the old signature and retries until acknowledged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-upstream-delivery-'));
  mkdirSync(join(root, 'config')); mkdirSync(join(root, '.runtime/upstream-watch'), { recursive: true });
  writeFileSync(join(root, 'config/upstream-watch.json'), JSON.stringify({ version: 1, sources: [{ id: 'fixture', label: 'fixture', urls: ['https://fixture.invalid/source'] }] }));
  const state = join(root, '.runtime/upstream-watch/state.json');
  writeFileSync(state, JSON.stringify({ version: 1, checkedAt: '', sources: [{ id: 'fixture', sig: sourceSig(['old']), changedAt: '' }] }));
  let deliveries = 0; let accepted = false;
  const deps = { root, fetch: (async () => new Response('new')) as typeof fetch,
    deliver: () => { deliveries++; return { ok: accepted, detail: accepted ? 'BL-fixture' : 'temporarily unavailable' }; } };
  await runUpstreamWatch(['--quiet'], deps);
  assert.equal(JSON.parse(readFileSync(state, 'utf8')).sources[0].sig, sourceSig(['old']));
  accepted = true; await runUpstreamWatch(['--quiet'], deps);
  assert.equal(JSON.parse(readFileSync(state, 'utf8')).sources[0].sig, sourceSig(['new']));
  await runUpstreamWatch(['--quiet'], deps); assert.equal(deliveries, 2);
});
test('release signatures ignore download counters and preserve version and release notes', () => {
  const release = { tag_name: 'v4.2.0', target_commitish: 'main', published_at: '2026-10-15', body: 'notes', html_url: 'https://github.com/example/release', assets: [{ download_count: 1 }] };
  assert.equal(releaseContent(JSON.stringify(release)), releaseContent(JSON.stringify({ ...release, assets: [{ download_count: 99 }] })));
  assert.notEqual(releaseContent(JSON.stringify(release)), releaseContent(JSON.stringify({ ...release, tag_name: 'v4.3.0' })));
  assert.throws(() => releaseContent('{}'));
});

test('weekly registration tries noninteractive S4U then only the hidden wrapper fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-upstream-schedule-'));
  const calls: Array<{ command: string; args: string[] }> = [];
  const fakeRun = (command: string, args: string[]) => {
    calls.push({ command, args });
    return { status: calls.length === 1 ? 1 : 0, stdout: '', stderr: '', error: null, signal: null };
  };
  assert.equal(registerWeekly(root, fakeRun), true);
  assert.match(calls[0].args.join(' '), /LogonType S4U/);
  assert.match(calls[1].args.join(' '), /wscript.exe/);
  assert.doesNotMatch(calls[1].args.join(' '), /\/TR.*node.exe/);
});
