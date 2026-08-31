/**
 * StoragePort contract tests — the SAME suite runs against InMemoryStorage and
 * SqliteDiskStorage. This is the F3.3 acceptance demo: identical consumer
 * assertions pass on both adapters, proving the swap is configuration.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const MOD = await import(pathToFileURL(join(ROOT, 'src/ports/storage-port.ts')).href);
const { InMemoryStorage, SqliteDiskStorage } = MOD;

// ─── Shared consumer suite (the swap demo) ─────────────────────────────────

function contractSuite(name: string, make: () => MOD.StoragePort, cleanup?: () => void) {
  describe(`StoragePort contract — ${name}`, () => {
    let s: MOD.StoragePort;
    before(() => {
      s = make();
    });
    after(() => {
      s.close();
      s.close(); // idempotent
      cleanup?.();
    });

    it('set/get round-trips and reports first insert as non-replace', () => {
      assert.strictEqual(s.set('a', '1'), false);
      assert.strictEqual(s.get('a'), '1');
      assert.strictEqual(s.set('a', '2'), true); // replaced
      assert.strictEqual(s.get('a'), '2');
    });

    it('get on missing key returns undefined', () => {
      assert.strictEqual(s.get('nope'), undefined);
    });

    it('exists / delete', () => {
      s.set('del', 'x');
      assert.ok(s.exists('del'));
      assert.strictEqual(s.delete('del'), true);
      assert.strictEqual(s.delete('del'), false);
      assert.ok(!s.exists('del'));
    });

    it('list with prefix filtering (sorted, literal)', () => {
      s.set('routing/alpha', 'A');
      s.set('routing/beta', 'B');
      s.set('other/gamma', 'C');
      const entries = s.list('routing/');
      assert.deepStrictEqual(
        entries.map((e) => e.key),
        ['routing/alpha', 'routing/beta'],
      );
      assert.deepStrictEqual(entries[0], { key: 'routing/alpha', value: 'A' });
      assert.strictEqual(s.list('').length >= 3, true);
    });

    it('append creates then extends, returning total length', () => {
      assert.strictEqual(s.append('log/1', 'hello'), 5);
      assert.strictEqual(s.append('log/1', ' world'), 11);
      assert.strictEqual(s.get('log/1'), 'hello world');
    });

    it('count with and without prefix', () => {
      s.set('cnt/x', '1');
      s.set('cnt/y', '2');
      assert.strictEqual(s.count('cnt/'), 2);
      assert.ok(s.count('') >= 2);
    });

    it('JSON payloads survive round-trip (consumer pattern)', () => {
      const payload = JSON.stringify({ agents: 21, ok: true, nested: { a: [1, 2, 3] } });
      s.set('session/state', payload);
      assert.deepStrictEqual(JSON.parse(s.get('session/state')!), { agents: 21, ok: true, nested: { a: [1, 2, 3] } });
    });

    it('operations after close throw', () => {
      const dead = make();
      dead.close();
      assert.throws(() => dead.get('x'));
    });
  });
}

contractSuite('InMemoryStorage', () => new InMemoryStorage());

{
  const dir = mkdtempSync(join(tmpdir(), 'ports-storage-'));
  contractSuite(
    'SqliteDiskStorage',
    () => new SqliteDiskStorage({ dbPath: join(dir, 'kv.db') }),
    () => rmSync(dir, { recursive: true, force: true }),
  );
}

// ─── SqliteDiskStorage persistence specifics ───────────────────────────────

describe('SqliteDiskStorage — LIKE metacharacters are literal', () => {
  it('prefixes containing % and _ do not act as wildcards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ports-storage-like-'));
    const s = new SqliteDiskStorage({ dbPath: join(dir, 'kv.db') });
    s.set('rate%limit', 'A');
    s.set('rateXlimit', 'B'); // would match if % acted as wildcard
    s.set('rate_limit', 'C'); // would match if _ acted as wildcard
    assert.deepStrictEqual(
      s.list('rate%').map((e) => e.key),
      ['rate%limit'],
    );
    assert.deepStrictEqual(
      s.list('rate_').map((e) => e.key),
      ['rate_limit'],
    );
    assert.strictEqual(s.count('rate%'), 1);
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('SqliteDiskStorage — durability', () => {
  it('persists across instances (reopen same file)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ports-storage-persist-'));
    const dbPath = join(dir, 'kv.db');
    const a = new SqliteDiskStorage({ dbPath });
    a.set('persist/key', 'survives');
    a.close();
    const b = new SqliteDiskStorage({ dbPath });
    assert.strictEqual(b.get('persist/key'), 'survives');
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
