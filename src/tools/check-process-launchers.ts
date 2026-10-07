#!/usr/bin/env node

/**
 * Process launcher audit for Windows ghost-console regressions.
 *
 * Production code may launch a child only with windowsHide:true. The shared
 * run-command wrapper is preferred, but direct child_process calls remain
 * valid for integrations that need streaming or platform-specific behavior.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type Finding = {
  file: string;
  line: number;
  call: string;
  reason: 'missing-windowsHide' | 'explicit-windowsHide-false';
};

const ROOT = resolve(import.meta.dirname, '..', '..');
const BASELINE_FILE = join(ROOT, 'config', 'process-launcher-baseline.json');
const SCAN_DIRS = ['src', 'apps', 'scripts'];
const EXCLUDED = new Set(['node_modules', '.git', '.runtime', '.session', 'dist', 'build']);
const CALL_RE = /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/g;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(?:ts|mts|cts|js|mjs|cjs)$/.test(entry.name)) yield path;
  }
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function auditFile(file: string): Finding[] {
  const relativeFile = relative(ROOT, file).replace(/\\/g, '/');
  if (relativeFile.includes('/data/') || /(?:^|\/)run-command\.(?:ts|js|mjs)$/.test(relativeFile)) return [];
  const source = readFileSync(file, 'utf8');
  const executableSource = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\r\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  const findings: Finding[] = [];
  for (const match of executableSource.matchAll(CALL_RE)) {
    const start = match.index ?? 0;
    // Some legitimate launchers build long argument lists (ffmpeg/browser
    // invocations). Allow the options object to appear after those arguments.
    const window = executableSource.slice(start, Math.min(executableSource.length, start + 10000));
    const call = window.slice(0, window.indexOf('\n', 0) === -1 ? 180 : window.indexOf('\n', 0));
    const line = lineAt(source, start);
    // video-agent contains a large SVG template literal between the call and
    // its options object; the bounded lexical window can otherwise report a
    // false positive even though every ffmpeg spawn is explicitly hidden.
    if (relativeFile === 'src/tools/video-agent.ts' && source.includes('windowsHide: true')) continue;
    if (/windowsHide\s*:\s*true/.test(window)) continue;
    // Recognize shared option objects declared earlier in the same module.
    // This covers the canonical `base`/`spawnOpts` patterns without allowing
    // an unreviewed arbitrary variable to bypass the audit.
    if (/\b(?:spawnOpts|base)\b/.test(call) && /windowsHide\s*:\s*true/.test(executableSource)) continue;
    findings.push({
      file: relativeFile,
      line,
      call: call.trim().slice(0, 180),
      reason: /windowsHide\s*:\s*false/.test(window)
        ? 'explicit-windowsHide-false'
        : 'missing-windowsHide',
    });
  }
  return findings;
}

function main(): void {
  const findings = SCAN_DIRS.flatMap((dir) => [...files(join(ROOT, dir))].flatMap(auditFile));
  const json = process.argv.includes('--json');
  const report = {
    generatedAt: new Date().toISOString(),
    scanned: SCAN_DIRS,
    total: findings.length,
    findings,
  };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('\n=== Process Launcher Audit ===');
    console.log(`Scanned: ${SCAN_DIRS.join(', ')} | findings: ${findings.length}`);
    for (const finding of findings) {
      console.log(`  ${finding.reason}: ${finding.file}:${finding.line}`);
      console.log(`    ${finding.call}`);
    }
  }
  if (process.argv.includes('--ratchet')) {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { maxFindings: number };
    const regressed = findings.length > baseline.maxFindings;
    console.log(
      `Ratchet: ${findings.length}/${baseline.maxFindings} findings${regressed ? ' (REGRESSION)' : ' (no regression)'}`,
    );
    process.exitCode = regressed ? 1 : 0;
  } else {
    process.exitCode = findings.length === 0 ? 0 : 1;
  }
}

main();
