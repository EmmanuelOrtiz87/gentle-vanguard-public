import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNpxTsxSync } from '../../src/core/run-command.ts';
import type { Norm } from '../../src/tools/auto-norm-learner.ts';
import {
  analyzePatterns,
  findSemanticMatch,
  promoteNorms,
  semanticTokens,
  tokenSimilarity,
} from '../../src/tools/auto-norm-learner.ts';

const script = resolve('src/tools/auto-norm-learner.ts');
const lesson = 'Recurring lesson must preserve the latest observation timestamp';
const id = 'inbox:recurring lesson must preserve the latest observation timestamp';

// Fechas relativas: pruneStaleNorms descarta normas con occurrences<3 y lastSeen >30d.
// Fechas fijas de octubre convertian el test en una bomba de tiempo al cruzar la ventana.
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = new Date(Date.now() - 10 * DAY_MS);
BASE.setUTCHours(0, 0, 0, 0);
const BASE_ISO = BASE.toISOString();
const NEWER_ISO = new Date(BASE.getTime() + DAY_MS + 10.5 * 60 * 60 * 1000).toISOString();
const OLDER_ISO = new Date(BASE.getTime() - DAY_MS + 10.5 * 60 * 60 * 1000).toISOString();

function norm(overrides: Partial<Norm> = {}): Norm {
  return {
    id,
    category: 'pattern',
    description: lesson,
    trigger: 'recurring lesson',
    confidence: 55,
    occurrences: 1,
    firstSeen: BASE_ISO,
    lastSeen: BASE_ISO,
    status: 'proposed',
    source: 'test',
    ...overrides,
  };
}

function fixture(t: TestContext, norms: Norm[]) {
  const dir = mkdtempSync(join(tmpdir(), 'gv-norm-learner-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const sub of ['.session', 'rules/adaptive', 'knowledge-base/00-inbox']) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  writeFileSync(join(dir, '.session/learned-norms.json'), JSON.stringify(norms));
  return dir;
}

function run(dir: string): Norm[] {
  // Keep CLI integration real while isolating external Engram and shell tools.
  const result = runNpxTsxSync(script, ['--quiet'], {
    cwd: dir,
    env: { ...process.env, PATH: '', Path: '' },
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(join(dir, '.session/learned-norms.json'), 'utf8'));
}

function session(dir: string, file: string, data: Record<string, unknown>): void {
  writeFileSync(
    join(dir, '.session', file),
    JSON.stringify({
      startTime: new Date().toISOString(),
      toolCalls: 10,
      filesRead: 30,
      qualityScore: 95,
      errors: [],
      warnings: [],
      ...data,
    }),
  );
}

test('learns from recent session JSON directly, without shell tools', (t) => {
  const dir = fixture(t, []);
  for (let index = 0; index < 3; index++) {
    session(dir, `session-${index}.json`, {
      sessionId: `recent-${index}`,
      errors: ['connection: rejected'],
    });
  }
  session(dir, 'session-stale.json', {
    sessionId: 'old',
    startTime: '2000-01-01T00:00:00Z',
    errors: ['connection: old'],
  });
  writeFileSync(join(dir, '.session/session-corrupt.json'), '{broken');
  const norms = run(dir);
  assert.equal(norms.find((n) => n.trigger === 'connection')?.occurrences, 3);
  assert.ok(norms.some((n) => n.trigger === 'high-quality-session'));
});

test('session snapshots of one ID do not manufacture independent recurrences', (t) => {
  const dir = fixture(t, []);
  for (let index = 0; index < 3; index++) {
    session(dir, `session-copy-${index}.json`, {
      sessionId: 'same-session',
      errors: ['connection: rejected'],
    });
  }
  assert.equal(run(dir).length, 0);
});

test('numeric error counters and mixed message arrays do not crash session learning', (t) => {
  const dir = fixture(t, []);
  session(dir, 'session-count.json', { sessionId: 'counter', errors: 2, warnings: 1 });
  session(dir, 'session-mixed.json', {
    sessionId: 'mixed',
    errors: [42, null, 'connection: rejected'],
  });
  session(dir, 'session-ok.json', { sessionId: 'valid' });
  assert.ok(run(dir).some((n) => n.trigger === 'high-quality-session'));
});

test('failed Engram subprocess is reported instead of silently claiming a log', (t) => {
  const dir = fixture(t, []);
  const result = runNpxTsxSync(script, [], {
    cwd: dir,
    env: { ...process.env, PATH: '', Path: '' },
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Engram.*skipping log/);
});

function observations(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `observed-${index}`,
    startTime: new Date().toISOString(),
    toolCalls: 10,
    filesRead: 30,
    filesEdited: 1,
    qualityScore: 95,
    errors: ['connection: first', 'connection: repeated'],
    warnings: [],
  }));
}

test('recurrence counts independent sessions rather than repeated errors within one session', () => {
  const norms = analyzePatterns(observations(2), []);
  assert.ok(!norms.some((n) => n.trigger === 'connection'));
});

test('replaying the same observations does not increase confidence', () => {
  const evidence = observations(3);
  const first = analyzePatterns(evidence, []);
  const confidence = first.find((n) => n.trigger === 'connection')!.confidence;
  assert.equal(
    analyzePatterns(evidence, first).find((n) => n.trigger === 'connection')!.confidence,
    confidence,
  );
});

test('new session evidence updates optimization norms so they can reach promotion', () => {
  const first = analyzePatterns(observations(3), []);
  const updated = promoteNorms(analyzePatterns(observations(5), first));
  for (const trigger of ['high-quality-session', 'token-efficiency']) {
    const learned = updated.find((n) => n.trigger === trigger)!;
    assert.equal(learned.occurrences, 5);
    assert.equal(learned.status, 'active');
  }
});

for (const created of [NEWER_ISO, OLDER_ISO, 'invalid']) {
  test(`inbox recurrence keeps the latest valid date (incoming ${created})`, (t) => {
    const dir = fixture(t, [norm()]);
    writeFileSync(
      join(dir, 'knowledge-base/00-inbox/engram-99999-pattern.md'),
      `---\ntype: pattern\ncreated: ${created}\n---\n**Learned**:\n- ${lesson}\n`,
    );
    const learned = run(dir).find((n) => n.id === id)!;
    assert.equal(learned.occurrences, 2);
    assert.equal(
      new Date(learned.lastSeen).getTime(),
      new Date(created === NEWER_ISO ? created : BASE_ISO).getTime(),
    );
    assert.equal(run(dir).find((n) => n.id === id)!.occurrences, 2, 'reread is idempotent');
  });
}

test('signals registered and threshold promotions even when proposed norms outnumber active ones', (t) => {
  const dir = fixture(t, [
    norm({ id: 'registered' }),
    norm({ id: 'threshold', confidence: 80, occurrences: 5 }),
    ...['a', 'b', 'c'].map((key) => norm({ id: key })),
  ]);
  writeFileSync(
    join(dir, 'rules/adaptive/PROMOTED-NORMS.json'),
    JSON.stringify({ promoted: ['registered'] }),
  );
  assert.equal(run(dir).filter((n) => n.status === 'active').length, 2);
  const signalPath = join(dir, '.session/auto-apply/trigger-norms.json');
  assert.ok(existsSync(signalPath), 'new promotions must produce a signal');
  const signal = readFileSync(signalPath, 'utf8');
  assert.equal(JSON.parse(signal).promotedCount, 2);
  run(dir);
  assert.equal(
    readFileSync(signalPath, 'utf8'),
    signal,
    'no new promotion means no rewritten signal',
  );
});

test('existing active norms do not create a promotion signal', (t) => {
  const dir = fixture(t, [norm({ status: 'active', confidence: 80 })]);
  run(dir);
  assert.equal(existsSync(join(dir, '.session/auto-apply/trigger-norms.json')), false);
});

// ─── Recurrencia SEMÁNTICA (2026-11-24) ─────────────────────────────────────
// El agrupamiento era literal: dos lecciones que dicen lo mismo con palabras
// distintas quedaban como dos normas con occurrences=1 y la cola de promoción
// VACÍA ("no recurrentes aún") — un verde falso sobre una recurrencia real.

test('tokens de contenido: sin acentos, sin stopwords y sin números', () => {
  const tokens = semanticTokens('Los gates del PUSH deben ejecutarse con 42 reglas');
  assert.ok(tokens.includes('gates'));
  assert.ok(tokens.includes('pushing') === false);
  assert.ok(!tokens.includes('los'));
  assert.ok(!tokens.includes('con'));
  assert.ok(!tokens.includes('42'));
});

test('dos textos con el mismo significado tienen similitud alta', () => {
  const a = semanticTokens('el gate del pre-push tiene que ejecutarse completo antes de cada push');
  const b = semanticTokens('el gate de pre-push debe ejecutarse completo antes de cada push');
  assert.ok(tokenSimilarity(a, b) >= 0.5, `similitud=${tokenSimilarity(a, b)}`);
});

test('textos sin relación NO se fusionan (anti-fusión espuria)', () => {
  const a = semanticTokens('el cache del pre-push tiene que invalidarse por entorno');
  const b = semanticTokens('la cola de promoción se arma con occurrences mayor o igual a dos');
  assert.equal(findSemanticMatch([{ id: 'x', tokens: a }], b), null);
});

test('la cola de promoción NO queda vacía cuando la recurrencia es semántica', (t) => {
  const dir = fixture(t, []);
  const write = (file: string, body: string) =>
    writeFileSync(
      join(dir, 'knowledge-base/00-inbox', file),
      `---\ntype: pattern\ncreated: ${BASE_ISO}\n---\n**Learned**:\n- ${body}\n`,
    );
  write(
    'engram-90001-pattern.md',
    'El gate del pre-push tiene que ejecutarse completo antes de cada push del stack',
  );
  write(
    'engram-90002-pattern.md',
    'El gate de pre-push debe ejecutarse completo antes de cada push del stack',
  );
  const norms = run(dir);
  const inbox = norms.filter((n) => n.id.startsWith('inbox:'));
  assert.equal(inbox.length, 1, 'las dos redacciones son la misma norma');
  assert.equal(inbox[0].occurrences, 2);
  assert.equal(inbox[0].matchMode, 'semantic');
  const queue = readFileSync(join(dir, 'rules/adaptive/PROMOTION-QUEUE.md'), 'utf8');
  assert.match(queue, /## Candidates \([1-9]/, 'la recurrencia real tiene que entrar a la cola');
  assert.match(queue, /recurrencia=semantic/);
});
