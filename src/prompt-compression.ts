#!/usr/bin/env node
/**
 * Prompt Compression Engine — skill-aware, extractive compression.
 *
 * Compresses prompts before submission using rule-based extractive techniques:
 * - Deduplication of repeated lines
 * - Boilerplate removal (salutations, filler)
 * - Code block preservation (highest value content)
 * - Skill-aware: each skill configures its compression ratio
 * - Token-budget aware: reads daily budget, adapts compression aggressiveness
 *
 * Usage:
 *   npx tsx src/prompt-compression.ts --input "long prompt text..." --skill react-19
 *   npx tsx src/prompt-compression.ts --input "..." --skill security-skill --max-tokens 2000
 *   npx tsx src/prompt-compression.ts --file prompt.txt --skill testing-skill
 *   npx tsx src/prompt-compression.ts --stats          # show compression metrics
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { getTokenUsage } from './token-usage-reader.js';
import { compressStructural } from './structural-compression.js';

// ---- Types ----

interface CompressionConfig {
  version: string;
  defaultCompressionRatio: number;
  preserveCodeBlocks: boolean;
  minPreservedLines: number;
  maxPreservedLines: number;
  tokenBudgetAware: boolean;
  deduplicateLines: boolean;
  removeBoilerplate: boolean;
  boilerplatePatterns: string[];
  lowInfoPatterns: string[];
  skills: Record<string, SkillCompressionConfig>;
}

interface SkillCompressionConfig {
  compressionRatio: number;
  preserveCodeBlocks: boolean;
  notes?: string;
}

interface CompressionResult {
  original: string;
  compressed: string;
  originalChars: number;
  compressedChars: number;
  originalLines: number;
  compressedLines: number;
  compressionRatio: number;
  skill: string;
  sections: SectionInfo[];
  durationMs: number;
}

interface SectionInfo {
  type: 'code' | 'text' | 'header' | 'list';
  originalLines: number;
  compressedLines: number;
  preserved: boolean;
}

interface CompressionStats {
  totalCompressed: number;
  totalOriginal: number;
  averageRatio: number;
  runs: number;
  bySkill: Record<string, { runs: number; avgRatio: number }>;
}

// ---- Paths ----

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'prompt-compression.json');
const STATS_PATH = join(ROOT, '.runtime', 'prompt-compression-stats.json');

// ---- Config loader (lazy singleton) ----

let _config: CompressionConfig | null = null;

function getConfig(): CompressionConfig {
  if (!_config) {
    if (!existsSync(CONFIG_PATH)) {
      _config = {
        version: '1.0.0',
        defaultCompressionRatio: 0.4,
        preserveCodeBlocks: true,
        minPreservedLines: 10,
        maxPreservedLines: 1000,
        tokenBudgetAware: true,
        deduplicateLines: true,
        removeBoilerplate: true,
        boilerplatePatterns: [
          'por favor',
          'please',
          'thank you',
          'gracias',
          'thanks',
          'saludos',
          'regards',
        ],
        lowInfoPatterns: ['^[-=_*]{3,}$', '^\\s*$'],
        skills: {},
      };
    } else {
      _config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as CompressionConfig;
    }
  }
  return _config;
}

// ---- Skill config lookup ----

function getSkillConfig(skill: string): SkillCompressionConfig {
  const config = getConfig();
  // Exact match
  if (config.skills[skill]) return config.skills[skill];
  // Partial match: check if any configured skill key is contained in the given skill name
  const matchedKey = Object.keys(config.skills).find((k) =>
    skill.toLowerCase().includes(k.toLowerCase()),
  );
  if (matchedKey) return config.skills[matchedKey];
  // Default
  return {
    compressionRatio: config.defaultCompressionRatio,
    preserveCodeBlocks: config.preserveCodeBlocks,
  };
}

// ---- Token budget awareness ----

function getTokenBudgetUsage(): number {
  return getTokenUsage().percentage / 100;
}

function adjustRatioForBudget(baseRatio: number): number {
  const config = getConfig();
  if (!config.tokenBudgetAware) return baseRatio;
  const usage = getTokenBudgetUsage();
  // At 0% usage → use base ratio (no extra compression)
  // At 90%+ usage → double the compression (halve the ratio)
  if (usage >= 0.9) return Math.max(0.05, baseRatio * 0.3);
  if (usage >= 0.7) return Math.max(0.05, baseRatio * 0.5);
  if (usage >= 0.5) return Math.max(0.05, baseRatio * 0.7);
  return baseRatio;
}

// ---- Line deduplication ----

function deduplicateLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    // Only deduplicate non-empty, non-unique lines
    if (trimmed.length > 0 && seen.has(trimmed)) continue;
    if (trimmed.length > 0) seen.add(trimmed);
    result.push(line);
  }
  return result;
}

// ---- Boilerplate removal ----

function isBoilerplate(line: string): boolean {
  const config = getConfig();
  if (!config.removeBoilerplate) return false;
  const lower = line.trim().toLowerCase();
  for (const pattern of config.boilerplatePatterns) {
    if (lower === pattern || lower.startsWith(pattern) || lower.endsWith(pattern)) return true;
  }
  return false;
}

function isLowInfo(line: string): boolean {
  const config = getConfig();
  for (const pattern of config.lowInfoPatterns) {
    try {
      if (new RegExp(pattern).test(line)) return true;
    } catch {
      /* skip invalid patterns */
    }
  }
  return false;
}

// ---- Section parsing ----

interface ParsedSection {
  type: 'code' | 'text' | 'header' | 'list';
  lines: string[];
  startLine: number;
}

function parseSections(input: string): ParsedSection[] {
  const lines = input.split('\n');
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect code block start
    if (line.trimStart().startsWith('```') || line.trimStart().startsWith('~~~')) {
      if (
        current &&
        current.type === 'code' &&
        (line.trimStart() === '```' ||
          line.trimStart() === '~~~' ||
          line.trimStart().startsWith('```') ||
          line.trimStart().startsWith('~~~'))
      ) {
        // Close code block
        current.lines.push(line);
        sections.push(current);
        current = null;
        continue;
      }
      if (current) {
        // Save previous section and start code
        sections.push(current);
      }
      current = { type: 'code', lines: [line], startLine: i };
      continue;
    }

    // Detect headers
    if (/^#{1,6}\s/.test(line.trim())) {
      if (current) sections.push(current);
      current = { type: 'header', lines: [line], startLine: i };
      continue;
    }

    // Detect lists
    if (/^[\s]*[-*+]\s/.test(line.trim()) || /^[\s]*\d+[.)]\s/.test(line.trim())) {
      if (!current || current.type !== 'list') {
        if (current) sections.push(current);
        current = { type: 'list', lines: [line], startLine: i };
        continue;
      }
      current.lines.push(line);
      continue;
    }

    // Text
    if (current && current.type === 'code') {
      // Inside a code block — keep the line in the code section
      current.lines.push(line);
      continue;
    }
    if (current && current.type === 'text') {
      // Continue an existing text section
      current.lines.push(line);
      continue;
    }
    // Header or list section: close it and start a new text section
    if (current) sections.push(current);
    current = { type: 'text', lines: [line], startLine: i };
    continue;
  }

  if (current) sections.push(current);
  return sections;
}

// ---- Core compression ----

function compressPrompt(
  input: string,
  skill: string = 'default',
  options: { previousTurns?: string[]; query?: string } = {},
): CompressionResult {
  const startTime = Date.now();

  if (!input || input.trim().length === 0) {
    return {
      original: input,
      compressed: input,
      originalChars: input?.length ?? 0,
      compressedChars: input?.length ?? 0,
      originalLines: input?.split('\n').length ?? 0,
      compressedLines: input?.split('\n').length ?? 0,
      compressionRatio: 1,
      skill,
      sections: [],
      durationMs: 0,
    };
  }

  const skillConfig = getSkillConfig(skill);
  const baseRatio = skillConfig.compressionRatio;
  const effectiveRatio = adjustRatioForBudget(baseRatio);
  const config = getConfig();
  const maxLines = config.maxPreservedLines;

  // Structural compression (JSON arrays, logs, prose) — complements the
  // extractive section processing below. Applied first when it yields a
  // smaller result, so prompts/delegation prompts also benefit.
  const structural = compressStructural(input, {
    query: options.query,
    previousTurns: options.previousTurns,
    mode: 'input',
  });
  if (structural.strategy !== 'none' && structural.compressed.length < input.length) {
    return {
      original: input,
      compressed: structural.compressed,
      originalChars: input.length,
      compressedChars: structural.compressed.length,
      originalLines: input.split('\n').length,
      compressedLines: structural.compressed.split('\n').length,
      compressionRatio: structural.compressed.length / input.length,
      skill,
      sections: [{ type: 'text', originalLines: 1, compressedLines: 1, preserved: true }],
      durationMs: Date.now() - startTime,
    };
  }

  // Parse sections
  const sections = parseSections(input);
  const sectionInfos: SectionInfo[] = [];

  // Process each section
  const compressedLines: string[] = [];

  for (const section of sections) {
    if (section.type === 'code' && skillConfig.preserveCodeBlocks) {
      // Preserve code blocks entirely
      compressedLines.push(...section.lines);
      sectionInfos.push({
        type: 'code',
        originalLines: section.lines.length,
        compressedLines: section.lines.length,
        preserved: true,
      });
    } else if (section.type === 'header') {
      // Always preserve headers
      compressedLines.push(...section.lines);
      sectionInfos.push({
        type: 'header',
        originalLines: section.lines.length,
        compressedLines: section.lines.length,
        preserved: true,
      });
    } else if (section.type === 'list') {
      // For lists, apply deduplication + compression ratio
      let listLines = [...section.lines];
      if (config.deduplicateLines) {
        listLines = deduplicateLines(listLines);
      }
      if (config.removeBoilerplate) {
        listLines = listLines.filter((l) => !isBoilerplate(l) && !isLowInfo(l));
      }
      // Apply ratio: keep first N lines
      const targetLines = Math.max(1, Math.floor(listLines.length * effectiveRatio));
      const kept = listLines.slice(0, targetLines);
      compressedLines.push(...kept);
      sectionInfos.push({
        type: 'list',
        originalLines: section.lines.length,
        compressedLines: kept.length,
        preserved: kept.length > 0,
      });
    } else {
      // Text section: dedup + boilerplate + ratio
      let textLines = [...section.lines];
      if (config.deduplicateLines) {
        textLines = deduplicateLines(textLines);
      }
      if (config.removeBoilerplate) {
        textLines = textLines.filter((l) => !isBoilerplate(l) && !isLowInfo(l));
      }
      // Apply ratio: keep first and last portions
      const targetLines = Math.max(1, Math.floor(textLines.length * effectiveRatio));
      if (textLines.length <= targetLines) {
        compressedLines.push(...textLines);
        sectionInfos.push({
          type: 'text',
          originalLines: section.lines.length,
          compressedLines: textLines.length,
          preserved: true,
        });
      } else {
        // Keep first 60% of target from start, 40% from end.
        // IMPORTANT: guard against lastCount === 0 — slice(-0) === slice(0)
        // returns the WHOLE array, causing duplicated lines.
        const firstCount = Math.min(textLines.length, Math.ceil(targetLines * 0.6));
        let lastCount = targetLines - firstCount;
        let kept: string[];
        if (lastCount <= 0) {
          kept = textLines.slice(0, firstCount);
        } else {
          // Prevent overlap when firstCount + lastCount exceeds the available lines
          const maxLast = Math.max(0, textLines.length - firstCount);
          lastCount = Math.min(lastCount, maxLast);
          kept = [...textLines.slice(0, firstCount), ...textLines.slice(-lastCount)];
        }
        compressedLines.push(...kept);
        sectionInfos.push({
          type: 'text',
          originalLines: section.lines.length,
          compressedLines: kept.length,
          preserved: true,
        });
      }
    }
  }

  // Enforce max lines limit
  let finalLines = compressedLines;
  if (finalLines.length > maxLines) {
    // Keep header section, first 60% of remaining, last 40% of remaining
    const headerEnd = sections.findIndex((s) => s.type === 'header');
    const nonHeaderLines = finalLines.slice(headerEnd >= 0 ? headerEnd : 0);
    const targetNonHeader = maxLines - (headerEnd >= 0 ? headerEnd : 0);
    if (targetNonHeader > 0 && nonHeaderLines.length > targetNonHeader) {
      const firstCount = Math.ceil(targetNonHeader * 0.6);
      const lastCount = targetNonHeader - firstCount;
      const keptNonHeader = [
        ...nonHeaderLines.slice(0, firstCount),
        ...nonHeaderLines.slice(-lastCount),
      ];
      finalLines = [...finalLines.slice(0, headerEnd >= 0 ? headerEnd : 0), ...keptNonHeader];
    }
  }

  const compressed = finalLines.join('\n');

  return {
    original: input,
    compressed,
    originalChars: input.length,
    compressedChars: compressed.length,
    originalLines: input.split('\n').length,
    compressedLines: finalLines.length,
    compressionRatio: compressed.length > 0 ? compressed.length / input.length : 1,
    skill,
    sections: sectionInfos,
    durationMs: Date.now() - startTime,
  };
}

// ---- Stats persistence ----

function loadStats(): CompressionStats {
  try {
    if (existsSync(STATS_PATH)) {
      return JSON.parse(readFileSync(STATS_PATH, 'utf-8')) as CompressionStats;
    }
  } catch {
    /* ignore */
  }
  return { totalCompressed: 0, totalOriginal: 0, averageRatio: 1, runs: 0, bySkill: {} };
}

function saveStats(result: CompressionResult): void {
  try {
    const stats = loadStats();
    stats.totalOriginal += result.originalChars;
    stats.totalCompressed += result.compressedChars;
    stats.runs++;
    stats.averageRatio = stats.totalOriginal > 0 ? stats.totalCompressed / stats.totalOriginal : 1;

    if (!stats.bySkill[result.skill]) {
      stats.bySkill[result.skill] = { runs: 0, avgRatio: 0 };
    }
    const skillStats = stats.bySkill[result.skill];
    skillStats.runs++;
    skillStats.avgRatio =
      skillStats.avgRatio + (result.compressionRatio - skillStats.avgRatio) / skillStats.runs;

    writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');
  } catch {
    /* stats are non-critical */
  }
}

// ---- Display helpers ----

function compressionBar(ratio: number, width: number = 20): string {
  const filled = Math.round((1 - ratio) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(width - filled, 0));
}

function formatResult(result: CompressionResult): string {
  const savedPct = ((1 - result.compressionRatio) * 100).toFixed(1);
  const lines: string[] = [
    '',
    '╔══════════════════════════════════════╗',
    '║     Prompt Compression Report        ║',
    '╚══════════════════════════════════════╝',
    '',
    `  Skill:         ${result.skill}`,
    `  Original:      ${result.originalChars.toLocaleString()} chars, ${result.originalLines.toLocaleString()} lines`,
    `  Compressed:    ${result.compressedChars.toLocaleString()} chars, ${result.compressedLines.toLocaleString()} lines`,
    `  Savings:       ${savedPct}%  ${compressionBar(result.compressionRatio)}`,
    `  Duration:      ${result.durationMs}ms`,
    '',
    '  Sections:',
  ];

  for (const s of result.sections) {
    const icon =
      s.type === 'code' ? '📄' : s.type === 'header' ? '📌' : s.type === 'list' ? '📋' : '📝';
    const saved =
      s.originalLines > 0 ? ((1 - s.compressedLines / s.originalLines) * 100).toFixed(0) : '0';
    lines.push(
      `    ${icon} ${s.type.padEnd(6)} ${s.originalLines}→${s.compressedLines} lines (-${saved}%)`,
    );
  }

  if (result.compressedLines < result.originalLines) {
    lines.push('', '  ⚡ Compressed output:');
    lines.push(
      '',
      result.compressed.slice(0, 500) +
        (result.compressed.length > 500 ? '\n  ... (truncated)' : ''),
    );
  }

  return lines.join('\n');
}

// ---- CLI ----

function main(): void {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const fileIdx = args.indexOf('--file');
  const skillIdx = args.indexOf('--skill');
  const statsFlag = args.includes('--stats');
  const jsonFlag = args.includes('--json');
  const quietFlag = args.includes('--quiet');

  if (statsFlag) {
    const stats = loadStats();
    if (jsonFlag) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║   Prompt Compression — Statistics    ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Total runs:       ${stats.runs}`);
    console.log(`  Total original:   ${stats.totalOriginal.toLocaleString()} chars`);
    console.log(`  Total compressed: ${stats.totalCompressed.toLocaleString()} chars`);
    console.log(`  Average ratio:    ${(stats.averageRatio * 100).toFixed(1)}%`);
    console.log('');
    console.log('  By skill:');
    for (const [skill, s] of Object.entries(stats.bySkill).sort((a, b) => b[1].runs - a[1].runs)) {
      console.log(`    ${skill.padEnd(20)} ${s.runs} runs, avg ${(s.avgRatio * 100).toFixed(1)}%`);
    }
    return;
  }

  let input = '';
  let skill = 'default';

  if (inputIdx >= 0) {
    input = args[inputIdx + 1] ?? '';
  } else if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1] ?? '';
    if (!filePath || !existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    input = readFileSync(filePath, 'utf-8');
  }

  if (skillIdx >= 0) {
    skill = args[skillIdx + 1] ?? 'default';
  }

  if (!input) {
    // Read from stdin if no input provided
    let stdin = '';
    try {
      const buffer = readFileSync('/dev/stdin', 'utf-8');
      stdin = buffer;
    } catch {
      // Not available on Windows
    }

    if (!stdin) {
      console.error('Usage:');
      console.error(
        '  npx tsx src/prompt-compression.ts --input "prompt text" [--skill <name>] [--json]',
      );
      console.error('  npx tsx src/prompt-compression.ts --file prompt.txt [--skill <name>]');
      console.error('  npx tsx src/prompt-compression.ts --stats');
      console.error('');
      console.error('Options:');
      console.error('  --input TEXT     Prompt text to compress');
      console.error('  --file PATH      Read prompt from file');
      console.error('  --skill NAME     Skill name for compression config (default: general)');
      console.error('  --max-tokens N   Maximum token target (overrides budget awareness)');
      console.error('  --stats          Show compression statistics');
      console.error('  --json           Output as JSON');
      console.error('  --quiet          Suppress extra output');
      process.exit(1);
    }
  }

  const result = compressPrompt(input, skill);
  saveStats(result);

  if (jsonFlag) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!quietFlag) {
    console.log(formatResult(result));
  } else {
    console.log(result.compressed);
  }
}

// ---- Exports for programmatic use ----

export type { CompressionResult, CompressionConfig, SkillCompressionConfig };
export { compressPrompt, getConfig, getSkillConfig, loadStats };

// ---- CLI entry ----

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
