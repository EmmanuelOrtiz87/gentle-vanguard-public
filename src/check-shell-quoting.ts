#!/usr/bin/env node

/**
 * check-shell-quoting.ts — Static analyzer for the Windows quoting gotcha.
 *
 * `runSyncShell(cmdString)` executes via `cmd /d /s /c`, where Node's arg
 * re-quoting can strip inner double quotes. Any quoted interpolated argument
 * containing spaces (paths, messages, SQL, queries) silently mis-parses:
 * e.g. `git commit -m "sync: automated"` → pathspec errors, exit 1.
 *
 * This tool flags runSyncShell/template-literal call sites whose command
 * embeds `"...${expr}..."` — candidates for the bug. Array-form runSync()
 * calls are safe and never flagged.
 *
 * Usage:
 *   npx tsx src/check-shell-quoting.ts            # scan src/
 *   npx tsx src/check-shell-quoting.ts --json     # JSON report
 *   npx tsx src/check-shell-quoting.ts --dir src/cli
 *
 * Exit codes: 0 = clean, 1 = findings, 2 = error.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Finding {
  file: string;
  line: number;
  snippet: string;
  risk: 'high' | 'medium' | 'low';
}

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const dirIdx = args.indexOf('--dir');
const rootDir = resolve(dirIdx !== -1 ? args[dirIdx + 1] : 'src');

/** Commands whose arguments are single tokens (PIDs, ports, flags) — low risk. */
const SAFE_COMMANDS = /^(taskkill|netstat|pkill|pgrep|tasklist|start|open|xdg-open|mkdir|rm|del)\b/i;

function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      yield* walkTsFiles(full);
    } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      yield full;
    }
  }
}

/**
 * True when the template literal embeds a double-quoted interpolation,
 * i.e. `"...${...}..."` — the shape that loses its quotes through cmd.
 */
function hasQuotedInterpolation(line: string): boolean {
  return /\\?"[^"\\]*\$\{[^}]+\}[^"\\]*\\?"/.test(line) || /"[^"]*\$\{[^}]+\}[^"]*"/.test(line);
}

function classify(snippet: string): 'high' | 'medium' | 'low' {
  if (SAFE_COMMANDS.test(snippet.replace(/^.*?runSyncShell\(`?/, ''))) return 'low';
  // Interpolations likely to contain spaces: paths into user dirs, messages, sql, queries.
  if (/\$\{\s*(msg|message|query|sql|q|pattern|text|title|name|args)\b/.test(snippet)) return 'high';
  if (/\$\{[^}]*(path|file|dir|bin|script|db)[^}]*\}/.test(snippet)) return 'medium';
  return 'medium';
}

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const file of walkTsFiles(rootDir)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (!line.includes('runSyncShell(')) return;
      if (!hasQuotedInterpolation(line)) return;
      findings.push({
        file: file.replace(/\\/g, '/'),
        line: idx + 1,
        snippet: line.trim().slice(0, 160),
        risk: classify(line),
      });
    });
  }
  return findings;
}

function main(): void {
  const findings = scan();
  if (jsonOut) {
    console.log(JSON.stringify({ scannedDir: rootDir, total: findings.length, findings }, null, 2));
  } else {
    console.log('\n═══ Shell Quoting Audit (runSyncShell + quoted interpolation) ═══');
    const byRisk = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const f of findings) {
      byRisk[f.risk]++;
      const icon = f.risk === 'high' ? '🔴' : f.risk === 'medium' ? '🟡' : '⚪';
      console.log(`  ${icon} ${f.file}:${f.line}`);
      console.log(`      ${f.snippet}`);
    }
    console.log(`\nTotal: ${findings.length} (high: ${byRisk.high}, medium: ${byRisk.medium}, low: ${byRisk.low})`);
    console.log('Fix: convert to array-form runSync(cmd, [args]) — immune to cmd.exe re-quoting.\n');
  }
  process.exit(findings.some((f) => f.risk === 'high') ? 1 : 0);
}

main();
