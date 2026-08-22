#!/usr/bin/env node

import { runNpxTsxSync, runSync } from '../core/run-command.js';
import { resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function resolveRepoRoot(): string {
  const result = runSync('git', ['rev-parse', '--show-toplevel']);
  return result.stdout?.trim() || resolve(__dirname, '..', '..');
}

function main(): number {
  const repoRoot = resolveRepoRoot();
  const result = runNpxTsxSync(
    'src/infrastructure/normative-audit-pipeline.ts',
    ['--mode', 'pre-commit'],
    {
      cwd: repoRoot,
      timeout: 60_000,
      stdio: 'inherit',
    },
  );
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as normativeAuditHook };
