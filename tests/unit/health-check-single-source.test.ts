import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CANONICAL = resolve(ROOT, 'src', 'core', 'health-check.ts');

describe('health-check single source', () => {
  it('canonical exists', () => {
    assert.ok(existsSync(CANONICAL));
  });

  it('no health-check fork survives in src/core', () => {
    const forks = readdirSync(resolve(ROOT, 'src', 'core')).filter((name) =>
      /^health-check-.+\.ts$/.test(name),
    );
    assert.deepStrictEqual(forks, []);
  });

  it('npm scripts point to the canonical file', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.strictEqual(pkg.scripts['health:check'], 'npx tsx src/core/health-check.ts');
    assert.strictEqual(
      pkg.scripts['health:check:quiet'],
      'npx tsx src/core/health-check.ts --quiet',
    );
    assert.strictEqual(pkg.scripts['health:check:fast'], undefined);
  });

  it('keeps parallel execution and incremental compile wiring', () => {
    const src = readFileSync(CANONICAL, 'utf8');
    assert.match(src, /PARALLEL_COMPONENTS/);
    assert.match(src, /--incremental/);
    assert.match(src, /tsc-health\.tsbuildinfo/);
  });

  it('no source references the dead path src/health-check.ts', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts')) {
          const text = readFileSync(full, 'utf8');
          if (/'src',\s*'health-check\.ts'|"src\/health-check\.ts"/.test(text)) {
            offenders.push(full.slice(ROOT.length + 1));
          }
        }
      }
    };
    walk(resolve(ROOT, 'src'));
    assert.deepStrictEqual(offenders, []);
  });
});
