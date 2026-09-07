/**
 * Unit tests for the script-path AUTO-HEAL guardrail (src/core/script-path-heal.ts).
 *
 * Verifies the stack's self-improvement behavior: resolver por basename, parcheo
 * en memoria, persistencia con backup .bak, no-touch sobre rutas correctas, y
 * reporte de paths no resolubles — todo mediante un sandbox temporal.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  indexScriptPaths,
  resolveScriptPath,
  healStepScriptPaths,
  type PipelineConfigLike,
} from '../../src/core/script-path-heal.js';

describe('script-path auto-heal', () => {
  let sandbox: string;
  let root: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'gv-heal-'));
    root = resolve(sandbox, 'repo'); // fake project root
    // Seed a real script under a domain folder (simulates the TS migration).
    mkdirSync(join(root, 'src', 'knowledge'), { recursive: true });
    writeFileSync(join(root, 'src', 'knowledge', 'engram-rag-reindex.ts'), 'export {};\n', 'utf-8');
    writeFileSync(join(root, 'src', 'knowledge', 'knowledge-base-init.ts'), 'export {};\n', 'utf-8');
    writeFileSync(join(root, 'src', 'knowxy.ts'), 'export {};\n', 'utf-8'); // top-level, taken LAST
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function makeConfig(steps: { id: string; script: string; enabled?: boolean }[]): PipelineConfigLike {
    return {
      pipeline: {
        steps: steps.map((s) => ({
          id: s.id,
          script: s.script,
          enabled: s.enabled ?? true,
        })),
      },
    };
  }

  describe('indexScriptPaths', () => {
    it('indexes TS files by basename (domain folder + top-level)', () => {
      const index = indexScriptPaths(root, join(root, 'src'));
      assert.ok(index.has('engram-rag-reindex.ts'));
      assert.strictEqual(index.get('engram-rag-reindex.ts'), 'src/knowledge/engram-rag-reindex.ts');
      assert.ok(index.has('knowxy.ts'));
      assert.strictEqual(index.get('knowxy.ts'), 'src/knowxy.ts');
    });

    it('normalizes separators to "/" (cross-platform)', () => {
      const index = indexScriptPaths(root, join(root, 'src'));
      const v = index.get('engram-rag-reindex.ts');
      assert.ok(v);
      assert.ok(!v!.includes('\\'), 'paths must use forward slashes');
    });

    it('does not index non-TS or duplicate basenames', () => {
      writeFileSync(join(root, 'src', 'knowledge', 'keep.txt'), '', 'utf-8');
      const index = indexScriptPaths(root, join(root, 'src'));
      assert.ok(!index.has('keep.txt'));
    });
  });

  describe('resolveScriptPath', () => {
    it('returns the configured path unchanged when it exists', () => {
      const p = 'src/knowledge/engram-rag-reindex.ts';
      assert.strictEqual(resolveScriptPath(root, p), p);
    });

    it('resolves a broken top-level path to the real domain file by basename', () => {
      const p = 'src/engram-rag-reindex.ts';
      assert.strictEqual(
        resolveScriptPath(root, p),
        'src/knowledge/engram-rag-reindex.ts',
      );
    });

    it('falls back to the input when the basename is unknown', () => {
      assert.strictEqual(resolveScriptPath(root, 'src/ghost.ts'), 'src/ghost.ts');
    });
  });

  describe('healStepScriptPaths', () => {
    it('patches in-memory config and persists corrections with .bak backup', () => {
      const configPath = join(root, 'config', 'session-autostart.config.json');
      mkdirSync(join(root, 'config'), { recursive: true });
      const broken = makeConfig([{ id: 'engram-auto-reindex', script: 'src/engram-rag-reindex.ts' }]);
      writeFileSync(configPath, JSON.stringify(broken, null, 2) + '\n', 'utf-8');

      // Load the config fresh (as the pipeline would) so the file is the source of truth.
      const loaded = JSON.parse(readFileSync(configPath, 'utf-8')) as PipelineConfigLike;
      const result = healStepScriptPaths(root, loaded, { configPath });

      assert.strictEqual(result.healed, 1);
      assert.strictEqual(result.persisted, 1);
      assert.strictEqual(loaded.pipeline.steps[0].script, 'src/knowledge/engram-rag-reindex.ts');
      assert.deepStrictEqual(result.patches, [
        { id: 'engram-auto-reindex', from: 'src/engram-rag-reindex.ts', to: 'src/knowledge/engram-rag-reindex.ts' },
      ]);
      assert.strictEqual(result.stillMissing.length, 0);

      // Persisted + backup
      const onDisk = JSON.parse(readFileSync(configPath, 'utf-8')) as PipelineConfigLike;
      assert.strictEqual(onDisk.pipeline.steps[0].script, 'src/knowledge/engram-rag-reindex.ts');
      assert.ok(existsSync(`${configPath}.bak`), '.bak backup written');
    });

    it('is a no-touch when all configured paths already exist', () => {
      const ok = makeConfig([{ id: 'a', script: 'src/knowledge/knowledge-base-init.ts' }]);
      const result = healStepScriptPaths(root, ok);
      assert.strictEqual(result.healed, 0);
      assert.strictEqual(result.persisted, 0);
      assert.strictEqual(result.patches.length, 0);
      assert.strictEqual(ok.pipeline.steps[0].script, 'src/knowledge/knowledge-base-init.ts');
    });

    it('reports unresolved paths to the report file without aborting', () => {
      const reportPath = join(root, '.runtime', 'autostart-missing-scripts.json');
      const config = makeConfig([
        { id: 'ghost-1', script: 'src/ghost.ts' },
        { id: 'good', script: 'src/knowledge/engram-rag-reindex.ts' },
      ]);
      const result = healStepScriptPaths(root, config, { reportPath });

      assert.strictEqual(result.healed, 0);
      assert.deepStrictEqual(result.stillMissing, [{ id: 'ghost-1', script: 'src/ghost.ts' }]);
      assert.ok(existsSync(reportPath), 'report file written');
      const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
      assert.strictEqual(report.missing[0].id, 'ghost-1');
    });

    it('respects enabled=false (disabled steps are not healed or flagged)', () => {
      const config = makeConfig([{ id: 'off', script: 'src/nope.ts', enabled: false }]);
      const result = healStepScriptPaths(root, config);
      assert.strictEqual(result.healed, 0);
      assert.strictEqual(result.stillMissing.length, 0);
    });

    it('handles a missing configPath gracefully (in-memory heal only)', () => {
      const config = makeConfig([{ id: 'x', script: 'src/engram-rag-reindex.ts' }]);
      const result = healStepScriptPaths(root, config, {});
      assert.strictEqual(result.healed, 1);
      assert.strictEqual(result.persisted, 0); // no configPath → nothing persisted
      assert.strictEqual(config.pipeline.steps[0].script, 'src/knowledge/engram-rag-reindex.ts');
    });
  });
});