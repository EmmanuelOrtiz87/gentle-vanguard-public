#!/usr/bin/env node
/**
 * Audit direct LLM/provider call sites that should pass user prompts through
 * the shared context optimization helper.
 *
 * This is intentionally conservative: it scans app server code for provider
 * invocation shapes and requires either `optimizeLLMUserPrompt` or
 * `preProcessLLMInput` in the same module, unless the file is an explicit
 * diagnostics/config/probe route.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type Finding = {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
};

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCAN_DIRS = ['apps'];
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.runtime', '.session', 'dist', 'build']);
const SERVER_SOURCE_PATTERNS = [
  /(?:^|\/)server\//,
  /(?:^|\/)api\//,
  /(?:^|\/)src\/server\//,
  /(?:^|\/)src\/api\//,
];
const ALLOWED_FILE_PATTERNS = [
  /(?:^|\/)routes\/llm-config\.ts$/,
  /(?:^|\/)integrations\/provider-hub\.ts$/,
  /(?:^|\/)settings\.ts$/,
  /(?:^|\/)settings-ia\.tsx$/,
  /(?:^|\/).*\.test\.ts$/,
  /(?:^|\/).*\.test\.tsx$/,
  /(?:^|\/)scripts\/diagnose-llm\.ts$/,
];

const PROVIDER_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai-chat-completions', re: /\/chat\/completions\b/g },
  { name: 'gemini-generate-content', re: /generateContent\b/g },
  { name: 'opencode-run', re: /['"]opencode['"][\s\S]{0,900}\b(?:run|--pure)\b/g },
  { name: 'opencode-spawn-run', re: /spawn\([^)]{0,160}\[[^\]]*['"]run['"][^\]]*\]/g },
];

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) yield path;
  }
}

function executableSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\r\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function isAllowedFile(relativeFile: string, source: string): boolean {
  if (ALLOWED_FILE_PATTERNS.some((pattern) => pattern.test(relativeFile))) return true;
  return source.includes('llm-prompt-optimization: ignore');
}

function hasOptimizationHelper(source: string): boolean {
  return /\b(?:optimizeLLMUserPrompt|preProcessLLMInput)\b/.test(source);
}

function scanFile(file: string): Finding[] {
  const relativeFile = relative(ROOT, file).replace(/\\/g, '/');
  if (!SERVER_SOURCE_PATTERNS.some((pattern) => pattern.test(relativeFile))) return [];
  const source = readFileSync(file, 'utf8');
  if (isAllowedFile(relativeFile, source) || hasOptimizationHelper(source)) return [];
  const code = executableSource(source);
  const findings: Finding[] = [];
  for (const pattern of PROVIDER_PATTERNS) {
    for (const match of code.matchAll(pattern.re)) {
      const index = match.index ?? 0;
      const snippet = source.slice(index, Math.min(source.length, index + 220)).split(/\r?\n/)[0] ?? '';
      findings.push({
        file: relativeFile,
        line: lineAt(source, index),
        pattern: pattern.name,
        snippet: snippet.trim().slice(0, 180),
      });
    }
  }
  return findings;
}

function main(): void {
  const json = process.argv.includes('--json');
  const findings = SCAN_DIRS.flatMap((dir) => [...files(join(ROOT, dir))].flatMap(scanFile));
  const report = {
    generatedAt: new Date().toISOString(),
    scanned: SCAN_DIRS,
    total: findings.length,
    findings,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== LLM Prompt Optimization Audit ===');
    console.log(`Scanned: ${SCAN_DIRS.join(', ')} | findings: ${findings.length}`);
    for (const finding of findings) {
      console.log(`  ${finding.pattern}: ${finding.file}:${finding.line}`);
      console.log(`    ${finding.snippet}`);
    }
    if (findings.length > 0) {
      console.log(
        '\nFix: use optimizeLLMUserPrompt() for user prompts before direct provider calls, or add a narrow ignore comment for diagnostics-only probes.',
      );
    }
  }
  process.exitCode = findings.length === 0 ? 0 : 1;
}

main();
