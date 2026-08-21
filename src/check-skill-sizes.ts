#!/usr/bin/env node
/**
 * Check skill file sizes against limits (tokens/lines).
 * TS migration of scripts/utilities/skills/SKILL/check-skill-sizes.ps1
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

/** Scan a single skill directory; returns [{name, lines, tokens, sizeKB, issues}] */
interface OverItem {
  skill: string;
  dir: string;
  lines: number;
  tokens: number;
  sizeKB: number;
  issues: string;
}

function scanDir(
  rootDir: string,
  label: string,
  maxLines: number,
  maxTokens: number,
): { over: OverItem[]; totalFiles: number } {
  if (!existsSync(rootDir)) return { over: [], totalFiles: 0 };

  const over: OverItem[] = [];
  let totalFiles = 0;

  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(rootDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    totalFiles++;
    const stat = statSync(skillMd);
    const content = readFileSync(skillMd, 'utf-8');
    const lines = content.split('\n').length;
    const tokens = Math.round(stat.size / 4);
    if (lines > maxLines || tokens > maxTokens) {
      over.push({
        skill: entry.name,
        dir: label,
        lines,
        tokens,
        sizeKB: Math.round((stat.size / 1024) * 10) / 10,
        issues: [
          lines > maxLines ? `lines:${lines}/${maxLines}` : '',
          tokens > maxTokens ? `tokens:${tokens}/${maxTokens}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      });
    }
  }
  return { over, totalFiles };
}

function main(): void {
  const args = process.argv.slice(2);
  const warnOnly = args.includes('--warn-only') || args.includes('-WarnOnly');
  const opencodeOnly = args.includes('--opencode');
  const maxTokens = args.includes('--max-tokens')
    ? parseInt(args[args.indexOf('--max-tokens') + 1], 10)
    : 1000;
  const maxLines = args.includes('--max-lines')
    ? parseInt(args[args.indexOf('--max-lines') + 1], 10)
    : 150;

  const allOver: OverItem[] = [];
  let allTotal = 0;

  // Always scan .opencode/skills/ (built-in opencode skills)
  const dotResult = scanDir(
    join(ROOT, '.opencode', 'skills'),
    '.opencode/skills',
    maxLines,
    maxTokens,
  );
  allOver.push(...dotResult.over);
  allTotal += dotResult.totalFiles;

  // Also scan skills/ (project-specific skills) unless --opencode-only
  if (!opencodeOnly) {
    const projResult = scanDir(join(ROOT, 'skills'), 'skills', maxLines, maxTokens);
    allOver.push(...projResult.over);
    allTotal += projResult.totalFiles;
  }

  allOver.sort((a, b) => b.tokens - a.tokens);

  if (allOver.length === 0) {
    console.log(
      `[OK] All ${allTotal} skills within limits (${maxLines} lines / ${maxTokens} tokens)`,
    );
    process.exit(0);
  }

  const dirCounts = new Map<string, number>();
  for (const o of allOver) dirCounts.set(o.dir, (dirCounts.get(o.dir) || 0) + 1);
  const summary = [...dirCounts.entries()].map(([d, c]) => `${d}:${c}`).join(' ');

  console.log(
    `[WARN] ${allOver.length} skills exceed limits (max ${maxTokens} tokens / ${maxLines} lines) — ${summary}:`,
  );
  console.table(
    allOver.map((o) => ({
      Dir: o.dir,
      Skill: o.skill,
      Tokens: o.tokens,
      Lines: o.lines,
      'Size(KB)': o.sizeKB,
      Issues: o.issues,
    })),
  );

  if (!warnOnly) {
    console.log('[ACTION] Split large skills: move content to references/ directory');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
