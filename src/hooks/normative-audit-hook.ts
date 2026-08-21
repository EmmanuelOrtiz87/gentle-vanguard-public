#!/usr/bin/env node

import { runSync } from '../core/run-command.js';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function resolveRepoRoot(): string {
  const result = runSync('git', ['rev-parse', '--show-toplevel']);
  return result.stdout?.trim() || resolve(__dirname, '..', '..');
}

function main(): number {
  const repoRoot = resolveRepoRoot();
  const handlerScript = join(repoRoot, 'scripts', 'utilities', 'utils', 'resilience-handler.ps1');
  const auditScript = join(
    repoRoot,
    'scripts',
    'utilities',
    'utils',
    'normative-audit-pipeline.ps1',
  );

  const scriptBlock = `& '${auditScript.replace(/\\/g, '\\\\')}' -Mode pre-commit`;

  const result = runSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `& '${handlerScript}' -ScriptBlock { ${scriptBlock} } -TimeoutSeconds 60 -OperationName normative-audit -FallbackAction warn_skip`,
    ],
    { stdio: 'inherit' },
  );

  return result.status ?? 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as normativeAuditHook };
