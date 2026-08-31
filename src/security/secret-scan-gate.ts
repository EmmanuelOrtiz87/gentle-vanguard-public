#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { scanText, type SecretMatch } from './secret-scanner.js';

interface CliArgs {
  base?: string;
  head?: string;
  staged: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { staged: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staged') result.staged = true;
    if (arg === '--base') result.base = argv[++i];
    if (arg === '--head') result.head = argv[++i];
  }
  return result;
}

function gitDiff(args: CliArgs): string {
  const diffArgs = ['diff', '--no-ext-diff', '--unified=0'];
  if (args.base) {
    if (/^0+$/.test(args.base)) {
      diffArgs.push('--root', args.head ?? 'HEAD');
    } else {
      diffArgs.push(args.base, args.head ?? 'HEAD');
    }
  } else if (args.staged) {
    diffArgs.push('--cached');
  }
  return execFileSync('git', diffArgs, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function addedContent(diff: string): Map<string, string> {
  const files = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of diff.split('\n')) {
    const header = line.match(/^\+\+\+ b\/(.+)$/);
    if (header) {
      current = header[1];
      if (!files.has(current)) files.set(current, []);
      continue;
    }
    if (current && line.startsWith('+') && !line.startsWith('+++')) {
      files.get(current)?.push(line.slice(1));
    }
  }
  return new Map([...files].map(([file, lines]) => [file, lines.join('\n')]));
}

function formatFinding(file: string, match: SecretMatch): string {
  return `- ${file}:${match.line} ${match.pattern.name} [${match.pattern.risk}]`;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  let diff: string;
  try {
    diff = gitDiff(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[secret-scan-gate] unable to read git diff: ${message}`);
    return 2;
  }

  const findings: string[] = [];
  for (const [file, content] of addedContent(diff)) {
    for (const match of scanText(content, { patterns: 'all' })) {
      findings.push(formatFinding(file, match));
    }
  }

  if (findings.length > 0) {
    console.error('[secret-scan-gate] secret-like content found in added lines:');
    for (const finding of findings) console.error(finding);
    console.error(
      '[secret-scan-gate] Values are intentionally not printed. Remove or rotate the credential.',
    );
    return 1;
  }

  console.log('[secret-scan-gate] no secret-like content found in added lines');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { addedContent, main as secretScanGate };
