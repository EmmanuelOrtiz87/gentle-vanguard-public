#!/usr/bin/env node
/**
 * Unit Tests: process-hygiene (native orphan/zombie reaper)
 *
 * Covers the PURE analyzer (analyzeProcesses) with fake snapshots — no
 * PowerShell, no real kills. Regression guards for the four garbage shapes:
 * duplicate daemons, hung one-shots, aged daemons and stale PID files.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import {
  analyzeProcesses,
  DEFAULT_OPTIONS,
  type ProcessSnapshot,
  type ProcessInfo,
} from '../../src/core/process-hygiene.ts';

const REPO = 'C:\\Workspace_local\\gentle-vanguard';

function proc(
  pid: number,
  ppid: number,
  cmdline: string,
  ageHours = 0,
  name = 'node.exe',
): ProcessInfo {
  return {
    pid,
    ppid,
    name,
    created: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    cmdline,
  };
}

function snap(
  repoProcesses: ProcessInfo[],
  livePids: number[],
  pidFiles: Record<string, string> = {},
): ProcessSnapshot {
  return {
    repoProcesses,
    livePids: new Set(livePids),
    portOwners: new Map(),
    pidFiles: new Map(Object.entries(pidFiles)),
  };
}

const OPTS = { ...DEFAULT_OPTIONS };

test('duplicate daemon: non-port-owner websocket-server is killed, owner kept', () => {
  const owner = proc(
    32868,
    26192,
    `"node.exe" --import tsx ${REPO}\\apps\\web-dashboard\\server\\websocket-server.ts`,
    0.2,
  );
  const dup = proc(
    14960,
    26192,
    `"node.exe" --import tsx ${REPO}\\apps\\web-dashboard\\server\\websocket-server.ts`,
    0.1,
  );
  const s = snap([owner, dup], [32868, 14960, 26192], {
    [join('.runtime', 'dashboard-ws.pid')]: '32868',
  });
  s.portOwners.set(8080, 32868); // port file wsPort=8080 is read from disk; emulate via keeper pidfile
  const { findings, keptHealthy } = analyzeProcesses(s, OPTS);
  const dupFindings = findings.filter((f) => f.kind === 'duplicate-daemon');
  assert.strictEqual(dupFindings.length, 1, 'exactly one duplicate finding');
  assert.strictEqual(dupFindings[0].pid, 14960, 'the non-pidfile instance is the duplicate');
  assert.strictEqual(dupFindings[0].action, 'kill');
  assert.ok(
    keptHealthy.some((k) => k.classId === 'websocket-server' && k.pid === 32868),
    'owner kept healthy',
  );
});

test('hung one-shot: dead parent + age > minAgeMin is killed; young one spared', () => {
  const hung = proc(
    19948,
    11372,
    `"node.exe" --import tsx ${REPO}\\src\\multitenant\\ci-rollback-engine.ts --action status`,
    1.5,
  );
  const fresh = proc(20100, 11372, `"node.exe" --import tsx ${REPO}\\src\\some-once.ts`, 0.05); // 3 min
  const s = snap([hung, fresh], [19948, 20100], {}); // parent 11372 NOT in live set → dead
  const { findings } = analyzeProcesses(s, OPTS);
  const hungFindings = findings.filter((f) => f.kind === 'hung-oneshot');
  assert.strictEqual(hungFindings.length, 1);
  assert.strictEqual(hungFindings[0].pid, 19948);
  assert.strictEqual(hungFindings[0].action, 'kill');
  assert.ok(!findings.some((f) => f.pid === 20100), 'fresh one-shot spared');
});

test('one-shot with LIVE parent is never killed (active agent work)', () => {
  const active = proc(
    20200,
    9999,
    `"node.exe" --import tsx ${REPO}\\src\\research\\deep-analysis.ts`,
    2,
  );
  const s = snap([active], [20200, 9999], {}); // parent 9999 alive
  const { findings } = analyzeProcesses(s, OPTS);
  const for20200 = findings.filter((f) => f.pid === 20200);
  assert.ok(
    for20200.every((f) => f.action === 'report'),
    'report-only, never kill',
  );
});

test('aged daemon (token-ingest > 24h) is recycled whole when recycleAged', () => {
  const aged = proc(
    25672,
    38772,
    `"node.exe" --import tsx ${REPO}\\src\\tokens\\token-ingest.ts --watch 30`,
    74,
  );
  const s = snap([aged], [25672], { '.runtime\\token-ingest.pid': '25672' });
  const { findings } = analyzeProcesses(s, { ...OPTS, recycleAged: true });
  const agedFindings = findings.filter((f) => f.kind === 'aged-daemon');
  assert.strictEqual(agedFindings.length, 1);
  assert.strictEqual(agedFindings[0].pid, 25672);
  assert.strictEqual(agedFindings[0].action, 'recycle');
  // with recycling disabled the same daemon is only kept healthy
  const { keptHealthy } = analyzeProcesses(s, { ...OPTS, recycleAged: false });
  assert.ok(keptHealthy.some((k) => k.classId === 'token-ingest-daemon' && k.pid === 25672));
});

test('aged daemon with respawn=client (codegraph-mcp) is NEVER recycled', () => {
  const aged = proc(
    11016,
    11372,
    `"node.exe" --import loader ${REPO}\\src\\codegraph-mcp-server-start.ts`,
    40,
  );
  const s = snap([aged], [11016], {});
  const { findings } = analyzeProcesses(s, { ...OPTS, recycleAged: true });
  assert.ok(!findings.some((f) => f.pid === 11016), 'client-owned MCP stays untouched');
});

test('stale pidfile (dead PID) is cleaned', () => {
  const s = snap([], [123], { '.runtime\\dashboard-vite.pid': '45999' }); // 45999 dead
  const { findings } = analyzeProcesses(s, OPTS);
  const stale = findings.filter((f) => f.kind === 'stale-pidfile');
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(stale[0].action, 'clean-pidfile');
});

test('pidfile pointing at a LIVE pid is not flagged (legit global-path child)', () => {
  const s = snap([], [123, 8500], { '.runtime\\codegraph-mcp-server.pid': '8500' }); // 8500 alive
  const { findings } = analyzeProcesses(s, OPTS);
  assert.ok(!findings.some((f) => f.kind === 'stale-pidfile'), 'live pidfile left alone');
});

test('leftover headless chrome older than threshold is killed', () => {
  const chrome = proc(
    77001,
    1,
    `"chrome.exe" --headless=new --user-data-dir=${REPO}\\.runtime\\shots about:blank`,
    2,
    'chrome.exe',
  );
  const s = snap([chrome], [77001], {});
  const { findings } = analyzeProcesses(s, OPTS);
  const hc = findings.filter((f) => f.kind === 'headless-chrome');
  assert.strictEqual(hc.length, 1);
  assert.strictEqual(hc[0].action, 'kill');
});

test('watchdogs classify before their supervised servers (order matters)', () => {
  const wd = proc(
    26192,
    11372,
    `"node.exe" --import tsx ${REPO}\\src\\dashboard-ws-autostart.ts --quiet --watch`,
    0.2,
  );
  const s = snap([wd], [26192], {});
  const { keptHealthy } = analyzeProcesses(s, OPTS);
  assert.ok(
    keptHealthy.some((k) => k.classId === 'ws-watchdog' && k.pid === 26192),
    'watchdog matched its own class, not websocket-server',
  );
});

test('vite dev server matches vite-server class, not skill-server', () => {
  const vite = proc(
    16580,
    26628,
    `"node.exe" ${REPO}\\apps\\web-dashboard\\node_modules\\vite\\bin\\vite.js`,
    0.5,
  );
  const skill = proc(
    38196,
    32868,
    `"node.exe" ${REPO}\\apps\\web-dashboard\\server\\scripts\\skill-server.ts`,
    0.5,
  );
  const s = snap([vite, skill], [16580, 38196, 26628, 32868], {
    '.runtime\\dashboard-vite.pid': '16580',
  });
  const { keptHealthy, findings } = analyzeProcesses(s, OPTS);
  assert.ok(
    keptHealthy.some((k) => k.classId === 'vite-server' && k.pid === 16580),
    'vite classified',
  );
  // skill-server is a live-parent repo process → report-only at most
  assert.ok(
    !findings.some((f) => f.pid === 38196 && f.action !== 'report'),
    'skill-server never killed',
  );
});

test('static app servers (python http.server) are protected classes, not hung one-shots', () => {
  // academy: start.sh shape — relative `-d .`, pidfile records the msys nohup
  // wrapper pid (alive, but not a class instance itself).
  const academy = proc(
    33728,
    17396,
    'C:\\Python314\\python.exe -m http.server 4173 --bind 127.0.0.1 -d .',
    2,
    'python.exe',
  );
  // design-hub: node-spawned shape — absolute --directory, dead parent, old.
  const hub = proc(
    888,
    7,
    'python -m http.server 8095 --bind 127.0.0.1 --directory C:\\Workspace_local\\gentle-vanguard\\apps\\design-hub',
    26,
    'python.exe',
  );
  const s = snap([academy, hub], [33728, 17396, 888], {
    '.runtime\\app-academy-http.pid': '17396',
    '.runtime\\app-design-hub-http.pid': '888',
  });
  const { findings, keptHealthy } = analyzeProcesses(s, OPTS);
  assert.ok(
    !findings.some((f) => f.pid === 33728 || f.pid === 888),
    'static app servers never flagged (regression: session-close reaper killed academy)',
  );
  assert.ok(!findings.some((f) => f.kind === 'stale-pidfile'), 'pidfiles point at live pids');
  assert.ok(keptHealthy.some((k) => k.classId === 'app-academy-http' && k.pid === 33728));
  assert.ok(keptHealthy.some((k) => k.classId === 'app-design-hub-http' && k.pid === 888));
});

test('relative server/server.ts instances are disambiguated by pidfile (cms vs archify)', () => {
  // start.sh spawns both with cwd=app dir → IDENTICAL relative cmdlines.
  const cms = proc(37652, 500, '"node.exe" --import tsx server/server.ts', 1);
  const arch = proc(36848, 501, '"node.exe" --import tsx server/server.ts', 1);
  const s = snap([cms, arch], [37652, 36848], {
    '.runtime\\app-cms-api.pid': '37652',
    '.runtime\\app-archify-api.pid': '36848',
  });
  const { findings, keptHealthy } = analyzeProcesses(s, OPTS);
  assert.ok(!findings.some((f) => f.kind === 'duplicate-daemon'), 'not duplicates of each other');
  assert.ok(!findings.some((f) => f.kind === 'hung-oneshot'), 'classified, not hung one-shots');
  assert.ok(keptHealthy.some((k) => k.classId === 'cms-api' && k.pid === 37652));
  assert.ok(keptHealthy.some((k) => k.classId === 'archify-api' && k.pid === 36848));
});

test('relative vite.js with pidfile maps to its app class (analytics)', () => {
  const vite = proc(
    37532,
    900,
    '"node.exe" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174',
    1,
  );
  const s = snap([vite], [37532], { '.runtime\\app-analytics-vite.pid': '37532' });
  const { findings, keptHealthy } = analyzeProcesses(s, OPTS);
  assert.ok(keptHealthy.some((k) => k.classId === 'gv-analytics-vite' && k.pid === 37532));
  assert.ok(!findings.some((f) => f.pid === 37532), 'kept healthy, no findings');
});
