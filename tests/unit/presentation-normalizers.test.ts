import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runSync } from '../../src/core/run-command.js';

for (const script of ['normalize-doc-html.ts', 'normalize-doc-shell.ts']) {
  test(`${script} preserves content and uses the Architecture shell idempotently`, () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-doc-normalizer-'));
    try {
      const docs = join(root, 'docs/presentations');
      mkdirSync(docs, { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"version":"4.3.0"}');
      writeFileSync(join(docs, 'architecture.html'), '<html><head><title>Architecture</title></head><body><header class="gv-topbar"><nav id="official-architecture">Architecture</nav></header><main>Reference</main></body></html>');
      writeFileSync(join(docs, 'index.html'), '<html><head><title>Index</title></head><body><nav>Old index menu</nav><main>Index</main><footer>Old footer</footer></body></html>');
      const target = join(docs, 'sample.html');
      writeFileSync(target, '<html><head><title>Sample</title></head><body><header>Old header</header><main><h1>Keep this content</h1></main><footer>Old footer</footer></body></html>');
      const run = () => {
        const result = runSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('src/tools', script)], { cwd: root });
        assert.equal(result.status, 0, result.stderr);
        return readFileSync(target, 'utf8');
      };
      const html = run();
      assert.match(html, /id="official-architecture"/);
      assert.match(html, /Keep this content/);
      assert.match(html, /v4\.3\.0/);
      assert.doesNotMatch(html, /Old footer|Old header|Old index menu/);
      assert.match(html, /assets\/js\/presentation-shell\.js/);
      assert.equal(run(), html);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
