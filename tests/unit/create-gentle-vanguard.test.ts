#!/usr/bin/env node
/**
 * Unit Tests: create-gentle-vanguard (scaffold template)
 * Verifies the pure helpers: ignore-list filtering, name sanitization,
 * base package.json generation and the generated README. No disk I/O.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildBasePackageJson,
  buildReadme,
  filterCopyable,
  isIgnored,
  sanitizeProjectName,
  walkProject,
} from '../../src/ops/create-gentle-vanguard.ts';

describe('create-gentle-vanguard', () => {
  describe('isIgnored', () => {
    it('ignores node_modules, .git and runtime dirs at any depth', () => {
      assert.ok(isIgnored('node_modules/x.js'));
      assert.ok(isIgnored('.git/config'));
      assert.ok(isIgnored('src/node_modules/y.ts'));
      assert.ok(isIgnored('.runtime/dashboard-ports.json'));
      assert.ok(isIgnored('.session/context-log/a/.state.json'));
      assert.ok(isIgnored('.telemetry/spans/span.json'));
      assert.ok(isIgnored('apps/web-dashboard/node_modules/react/index.js'));
    });

    it('ignores generated/build artifacts', () => {
      assert.ok(isIgnored('dist/bundle.js'));
      assert.ok(isIgnored('coverage/lcov.info'));
      assert.ok(isIgnored('graphify-out/graph.json'));
      assert.ok(isIgnored('keys/prod.key'));
    });

    it('ignores lockfiles and local config overrides', () => {
      assert.ok(isIgnored('package-lock.json'));
      assert.ok(isIgnored('.opencode/package-lock.json'));
      assert.ok(isIgnored('config/cloud-agents.local.json'));
      assert.ok(isIgnored('.env'));
    });

    it('keeps source files that must be scaffolded', () => {
      assert.ok(!isIgnored('src/ops/create-gentle-vanguard.ts'));
      assert.ok(!isIgnored('src/core/run-command.ts'));
      assert.ok(!isIgnored('config/orchestrator.json'));
      assert.ok(!isIgnored('package.json'));
      assert.ok(!isIgnored('tests/unit/create-gentle-vanguard.test.ts'));
      assert.ok(!isIgnored('docs/product/README.md'));
      assert.ok(!isIgnored('.env.example'));
      assert.ok(!isIgnored('.opencode/package.json'));
    });

    it('normalizes Windows separators', () => {
      assert.ok(isIgnored('src\\node_modules\\dep\\index.js'));
      assert.ok(!isIgnored('src\\core\\run-command.ts'));
    });
  });

  describe('filterCopyable', () => {
    it('filters out ignored paths and keeps the rest', () => {
      const input = [
        'package.json',
        'src/ops/quick-start.ts',
        'node_modules/react/index.js',
        '.git/config',
        'config/orchestrator.json',
        '.runtime/ports.json',
      ];
      assert.deepStrictEqual(filterCopyable(input), [
        'package.json',
        'src/ops/quick-start.ts',
        'config/orchestrator.json',
      ]);
    });

    it('returns an empty array for an empty input', () => {
      assert.deepStrictEqual(filterCopyable([]), []);
    });
  });

  describe('sanitizeProjectName', () => {
    it('slugs the project name', () => {
      assert.strictEqual(sanitizeProjectName('My Awesome Project'), 'my-awesome-project');
      assert.strictEqual(sanitizeProjectName('  MiProyecto_01 '), 'miproyecto-01');
    });

    it('falls back to a default for empty/invalid names', () => {
      assert.strictEqual(sanitizeProjectName(''), 'gentle-vanguard-app');
      assert.strictEqual(sanitizeProjectName('!!!'), 'gentle-vanguard-app');
    });
  });

  describe('buildBasePackageJson', () => {
    it('uses the project name and includes essential scripts', () => {
      const pkg = buildBasePackageJson('demo-app');
      assert.strictEqual(pkg.name, 'demo-app');
      assert.strictEqual(pkg.type, 'module');
      assert.ok(typeof pkg.scripts === 'object' && pkg.scripts !== null);
      const scripts = pkg.scripts as Record<string, string>;
      assert.strictEqual(scripts.typecheck, 'tsc --noEmit');
      assert.ok(scripts['stack:setup']?.includes('stack-setup.ts'));
      assert.ok(scripts.test?.includes('test-runner-optimized.ts'));
      assert.ok((pkg.dependencies as Record<string, string>).zod !== undefined);
    });
  });

  describe('buildReadme', () => {
    it('mentions the project name and next steps', () => {
      const readme = buildReadme('demo-app');
      assert.ok(readme.includes('# demo-app'));
      assert.ok(readme.includes('npm install'));
      assert.ok(readme.includes('npm run stack:setup'));
    });
  });

  describe('walkProject', () => {
    it('keeps the source root untouched (pure walk over a temp-like entry list)', () => {
      // Walking a non-existent root yields an empty plan instead of crashing.
      assert.deepStrictEqual(walkProject('C:/nonexistent-gentle-vanguard-root'), []);
    });
  });
});
