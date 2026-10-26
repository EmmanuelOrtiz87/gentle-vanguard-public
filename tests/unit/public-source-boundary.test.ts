import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { removePrivatePublicSources } from '../../src/infrastructure/public-source-boundary.js';

describe('public source boundary', () => {
  it('removes private-only TypeScript modules while preserving public source', () => {
    const target = mkdtempSync(join(tmpdir(), 'gv-public-source-'));
    try {
      for (const relative of [
        'src/atlassian-kit/index.ts',
        'src/content-operations/import-campaign.ts',
        'src/rdd/rdd-core.ts',
        'src/tools/verify-native-design.ts',
      ]) {
        const path = join(target, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, 'private');
      }
      const publicPath = join(target, 'src/tools/public-tool.ts');
      writeFileSync(publicPath, 'export const publicTool = true;');

      removePrivatePublicSources(target);

      expect(() => readFileSync(join(target, 'src/atlassian-kit/index.ts'))).toThrow();
      expect(() =>
        readFileSync(join(target, 'src/content-operations/import-campaign.ts')),
      ).toThrow();
      expect(() => readFileSync(join(target, 'src/rdd/rdd-core.ts'))).toThrow();
      expect(() => readFileSync(join(target, 'src/tools/verify-native-design.ts'))).toThrow();
      expect(readFileSync(publicPath, 'utf8')).toContain('publicTool');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
