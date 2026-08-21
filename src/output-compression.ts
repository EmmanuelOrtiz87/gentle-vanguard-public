#!/usr/bin/env node
/**
 * Output Compression Engine — Profile-based response compression
 *
 * Compresses agent responses based on profiles (ultra/lleno/lite/simple)
 * Features: abbreviation expansion/contraction, causal notation, line limiting
 * Configuration-driven from config/output-compression.json
 * Token budget awareness
 *
 * Usage:
 *   npx tsx src/output-compression.ts --input "long response text..." --profile ultra
 *   npx tsx src/output-compression.ts --input "..." --profile simple --max-lines 10
 *   npx tsx src/output-compression.ts --file response.txt --profile ultra
 *   npx tsx src/output-compression.ts --stats
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { getTokenUsage } from './token-usage-reader.js';
import { compressStructural } from './structural-compression.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CompressionProfile = 'ultra' | 'lleno' | 'lite' | 'simple';

export interface ProfileConfig {
  name: CompressionProfile;
  description: string;
  compressionLevel: number;
  maxLines: number;
  maxTokens: number;
  abbreviate: boolean;
  causalNotation: boolean;
  expandContractions: boolean;
  removeFillers: boolean;
  singleLineResponses: boolean;
  guidelines: string[];
}

export interface ChatLevelConfig {
  name: string;
  description: string;
  maxLines: number;
  maxTokens: number;
  enforceLineLimit: boolean;
  enforceTokenLimit: boolean;
  autoEscalate: boolean;
  autoEscalateTriggers?: string[];
  defaultProfile: CompressionProfile;
}

export interface OutputCompressionConfig {
  version: string;
  profiles: Record<CompressionProfile, ProfileConfig>;
  chatLevels: Record<string, ChatLevelConfig>;
  abbreviations: {
    expansion: Record<string, string>;
    contraction: Record<string, string>;
  };
  causalNotation: {
    enabled: boolean;
    patterns: Record<string, string[]>;
    preferSymbols: boolean;
  };
  fillerWords: string[];
  breakGlass: {
    enabled: boolean;
    overrideProfiles: CompressionProfile[];
    maxOverridesPerSession: number;
    maxOverridesPerHour: number;
    cooldownTurns: number;
    requiresReason: boolean;
    auditLog: string;
  };
  autoMode: {
    enabled: boolean;
    thresholds: Record<
      string,
      { budgetPct: number; profile: CompressionProfile; chatLevel: string }
    >;
  };
  metrics: {
    enabled: boolean;
    trackCompressionRatio: boolean;
    trackTokenSavings: boolean;
    trackLineReduction: boolean;
    storagePath: string;
    reportInterval: number;
  };
}

export interface CompressionResult {
  original: string;
  compressed: string;
  profile: CompressionProfile;
  originalChars: number;
  compressedChars: number;
  originalLines: number;
  compressedLines: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  tokenSavings: number;
  lineReduction: number;
  abbreviationsExpanded: number;
  abbreviationsContracted: number;
  fillersRemoved: number;
  causalNotationsApplied: number;
  durationMs: number;
}

export interface CompressionMetrics {
  totalRuns: number;
  totalOriginalChars: number;
  totalCompressedChars: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  averageCompressionRatio: number;
  totalTokenSavings: number;
  byProfile: Record<
    CompressionProfile,
    {
      runs: number;
      avgCompressionRatio: number;
      avgTokenSavings: number;
    }
  >;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'output-compression.json');

// ─── Config Loader ────────────────────────────────────────────────────────────

let _config: OutputCompressionConfig | null = null;

export function getConfig(): OutputCompressionConfig {
  if (_config) return _config;

  if (!existsSync(CONFIG_PATH)) {
    // Return default config if file doesn't exist
    _config = getDefaultConfig();
    return _config;
  }

  try {
    _config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as OutputCompressionConfig;
    return _config;
  } catch (err) {
    console.warn(`[output-compression] Failed to load config: ${err}`);
    _config = getDefaultConfig();
    return _config;
  }
}

function getDefaultConfig(): OutputCompressionConfig {
  return {
    version: '1.0.0',
    profiles: {
      ultra: {
        name: 'ultra',
        description: 'Aggressive compression with abbreviations',
        compressionLevel: 0.9,
        maxLines: 10,
        maxTokens: 500,
        abbreviate: true,
        causalNotation: true,
        expandContractions: false,
        removeFillers: true,
        singleLineResponses: true,
        guidelines: ['Use abbreviations', 'One-word answers when enough'],
      },
      lleno: {
        name: 'lleno',
        description: 'Compressed with fragments accepted',
        compressionLevel: 0.6,
        maxLines: 25,
        maxTokens: 1500,
        abbreviate: true,
        causalNotation: true,
        expandContractions: false,
        removeFillers: true,
        singleLineResponses: false,
        guidelines: ['Complete sentences preferred'],
      },
      lite: {
        name: 'lite',
        description: 'Professional concise language',
        compressionLevel: 0.3,
        maxLines: 50,
        maxTokens: 3000,
        abbreviate: false,
        causalNotation: false,
        expandContractions: true,
        removeFillers: true,
        singleLineResponses: false,
        guidelines: ['No digressions', 'Complete sentences'],
      },
      simple: {
        name: 'simple',
        description: 'Minimum viable detail',
        compressionLevel: 0.8,
        maxLines: 15,
        maxTokens: 750,
        abbreviate: true,
        causalNotation: true,
        expandContractions: false,
        removeFillers: true,
        singleLineResponses: true,
        guidelines: ['No preamble or postamble'],
      },
    },
    chatLevels: {},
    abbreviations: { expansion: {}, contraction: {} },
    causalNotation: { enabled: true, patterns: {}, preferSymbols: true },
    fillerWords: [],
    breakGlass: {
      enabled: true,
      overrideProfiles: ['lleno', 'lite'],
      maxOverridesPerSession: 3,
      maxOverridesPerHour: 2,
      cooldownTurns: 5,
      requiresReason: true,
      auditLog: '.logs/output-compression-breakglass.jsonl',
    },
    autoMode: {
      enabled: true,
      thresholds: {
        critical: { budgetPct: 95, profile: 'ultra', chatLevel: 'chat-compact' },
        high: { budgetPct: 85, profile: 'ultra', chatLevel: 'chat-compact' },
        medium: { budgetPct: 70, profile: 'simple', chatLevel: 'chat-compact' },
        normal: { budgetPct: 50, profile: 'lleno', chatLevel: 'chat-balanced' },
        low: { budgetPct: 0, profile: 'lite', chatLevel: 'chat-balanced' },
      },
    },
    metrics: {
      enabled: true,
      trackCompressionRatio: true,
      trackTokenSavings: true,
      trackLineReduction: true,
      storagePath: '.runtime/output-compression-metrics.json',
      reportInterval: 100,
    },
  };
}

// ─── Token Budget Awareness ───────────────────────────────────────────────────

interface TokenBudgetInfo {
  used: number;
  budget: number;
  percentage: number;
}

export function getTokenBudgetUsage(): TokenBudgetInfo {
  const usage = getTokenUsage();
  return {
    used: usage.used,
    budget: usage.budget,
    percentage: usage.percentage,
  };
}

export function selectProfileForBudget(budgetPct: number): CompressionProfile {
  const config = getConfig();
  if (!config.autoMode?.enabled) return 'lleno';

  const thresholds = Object.entries(config.autoMode.thresholds).sort(
    (a, b) => b[1].budgetPct - a[1].budgetPct,
  );

  for (const [, threshold] of thresholds) {
    if (budgetPct >= threshold.budgetPct) {
      return threshold.profile;
    }
  }

  return 'lite';
}

// ─── Compression Functions ────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  // Simple estimation: chars / 4
  return Math.ceil(text.length / 4);
}

function expandAbbreviations(
  text: string,
  config: OutputCompressionConfig,
): { text: string; count: number } {
  if (!config.abbreviations?.expansion) return { text, count: 0 };

  let count = 0;
  let result = text;

  // Sort by length descending to match longer phrases first
  const expansions = Object.entries(config.abbreviations.expansion).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [abbr, expansion] of expansions) {
    // Match whole word only (case insensitive)
    const regex = new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'gi');
    const matches = result.match(regex);
    if (matches) {
      count += matches.length;
    }
    result = result.replace(regex, expansion);
  }

  return { text: result, count };
}

function contractAbbreviations(
  text: string,
  config: OutputCompressionConfig,
): { text: string; count: number } {
  if (!config.profiles.ultra.abbreviate && !config.profiles.simple.abbreviate) {
    return { text, count: 0 };
  }

  let count = 0;
  let result = text;

  // Sort by length descending to match longer phrases first
  const contractions = Object.entries(config.abbreviations?.contraction ?? {}).sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [phrase, abbr] of contractions) {
    // Match phrase (case insensitive, word boundaries)
    const regex = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi');
    const matches = result.match(regex);
    if (matches) {
      count += matches.length;
    }
    result = result.replace(regex, abbr);
  }

  return { text: result, count };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeFillers(
  text: string,
  config: OutputCompressionConfig,
): { text: string; count: number } {
  if (!config.fillerWords?.length) return { text, count: 0 };

  let count = 0;
  let result = text;

  // Sort by length descending to match longer phrases first
  const fillers = [...config.fillerWords].sort((a, b) => b.length - a.length);

  for (const filler of fillers) {
    const regex = new RegExp(`\\b${escapeRegex(filler.toLowerCase())}\\b\\s*`, 'gi');
    result = result.replace(regex, () => {
      count++;
      return '';
    });
  }

  // Clean up extra whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return { text: result, count };
}

function applyCausalNotation(
  text: string,
  config: OutputCompressionConfig,
): { text: string; count: number } {
  if (!config.causalNotation?.enabled) return { text, count: 0 };

  let count = 0;
  let result = text;

  const patterns = config.causalNotation.patterns ?? {};

  // Replace verbose causal phrases with symbols
  if (patterns.causes) {
    for (const pattern of patterns.causes) {
      if (pattern.length > 2) {
        // Only replace full phrases, not symbols
        const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');
        result = result.replace(regex, () => {
          count++;
          return config.causalNotation.preferSymbols ? '->' : 'causes';
        });
      }
    }
  }

  // "depends on" -> "<-
  if (patterns.depends) {
    for (const pattern of patterns.depends) {
      if (pattern.length > 2) {
        const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');
        result = result.replace(regex, () => {
          count++;
          return config.causalNotation.preferSymbols ? '<-' : 'depends on';
        });
      }
    }
  }

  // "enables" -> "-o->"
  if (patterns.enables) {
    for (const pattern of patterns.enables) {
      if (pattern.length > 3) {
        const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');
        result = result.replace(regex, () => {
          count++;
          return config.causalNotation.preferSymbols ? '-o->' : 'enables';
        });
      }
    }
  }

  // "then" / "followed by" -> "->>"
  if (patterns.sequence) {
    for (const pattern of patterns.sequence) {
      if (pattern.length > 2) {
        const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');
        result = result.replace(regex, () => {
          count++;
          return config.causalNotation.preferSymbols ? '->>' : 'then';
        });
      }
    }
  }

  return { text: result, count };
}

function limitLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;

  // Keep first 70% and last 30% of allowed lines
  const firstCount = Math.floor(maxLines * 0.7);
  const lastCount = maxLines - firstCount;

  const first = lines.slice(0, firstCount);
  const last = lines.slice(-lastCount);

  return [...first, '... (truncated)', ...last].join('\n');
}

function limitTokens(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;

  // Truncate proportionally
  const ratio = maxTokens / estimated;
  const charLimit = Math.floor(text.length * ratio);

  // Try to cut at a sentence boundary
  const truncated = text.slice(0, charLimit);
  const lastSentence = truncated.lastIndexOf('.');
  if (lastSentence > charLimit * 0.8) {
    return truncated.slice(0, lastSentence + 1) + ' ...';
  }

  // Cut at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  return truncated.slice(0, lastSpace) + ' ...';
}

// ─── Core Compression ─────────────────────────────────────────────────────────

export function compressOutput(
  input: string,
  profile: CompressionProfile | 'auto' = 'auto',
  options: {
    maxLines?: number;
    maxTokens?: number;
    expandOnly?: boolean;
    previousTurns?: string[];
    query?: string;
  } = {},
): CompressionResult {
  const startTime = Date.now();
  const config = getConfig();

  // Handle empty input
  if (!input || !input.trim()) {
    return {
      original: input,
      compressed: input,
      profile: profile === 'auto' ? 'lleno' : profile,
      originalChars: input?.length ?? 0,
      compressedChars: input?.length ?? 0,
      originalLines: input?.split('\n').length ?? 0,
      compressedLines: input?.split('\n').length ?? 0,
      originalTokens: 0,
      compressedTokens: 0,
      compressionRatio: 1,
      tokenSavings: 0,
      lineReduction: 0,
      abbreviationsExpanded: 0,
      abbreviationsContracted: 0,
      fillersRemoved: 0,
      causalNotationsApplied: 0,
      durationMs: 0,
    };
  }

  // Auto-select profile based on token budget
  let selectedProfile = profile;
  if (profile === 'auto') {
    const budgetInfo = getTokenBudgetUsage();
    selectedProfile = selectProfileForBudget(budgetInfo.percentage);
  }

  const profileConfig = config.profiles[selectedProfile as CompressionProfile];
  if (!profileConfig) {
    throw new Error(`Unknown profile: ${profile}`);
  }

  const maxLines = options.maxLines ?? profileConfig.maxLines;
  const maxTokens = options.maxTokens ?? profileConfig.maxTokens;

  let compressed = input;
  let abbreviationsExpanded = 0;
  let abbreviationsContracted = 0;
  let fillersRemoved = 0;
  let causalNotationsApplied = 0;

  // Step 0: Structural compression (JSON arrays, logs, prose) — complements
  // the extractive engine below. Only applied when it yields a smaller result.
  const structural = compressStructural(input, {
    query: options.query,
    previousTurns: options.previousTurns,
    mode: 'output',
  });
  if (structural.strategy !== 'none' && structural.compressed.length < input.length) {
    compressed = structural.compressed;
  }

  // Step 1: Expand abbreviations if requested (for lite mode)
  if (options.expandOnly || profileConfig.expandContractions) {
    const result = expandAbbreviations(compressed, config);
    compressed = result.text;
    abbreviationsExpanded = result.count;
  }

  // Step 2: Contract abbreviations (for ultra/simple modes)
  if (!options.expandOnly && profileConfig.abbreviate) {
    const result = contractAbbreviations(compressed, config);
    compressed = result.text;
    abbreviationsContracted = result.count;
  }

  // Step 3: Remove filler words
  if (profileConfig.removeFillers) {
    const result = removeFillers(compressed, config);
    compressed = result.text;
    fillersRemoved = result.count;
  }

  // Step 4: Apply causal notation
  if (profileConfig.causalNotation) {
    const result = applyCausalNotation(compressed, config);
    compressed = result.text;
    causalNotationsApplied = result.count;
  }

  // Step 5: Apply line limiting
  if (maxLines > 0) {
    compressed = limitLines(compressed, maxLines);
  }

  // Step 6: Apply token limiting
  if (maxTokens > 0) {
    compressed = limitTokens(compressed, maxTokens);
  }

  // Calculate metrics
  const originalChars = input.length;
  const compressedChars = compressed.length;
  const originalLines = input.split('\n').length;
  const compressedLines = compressed.split('\n').length;
  const originalTokens = estimateTokens(input);
  const compressedTokens = estimateTokens(compressed);

  const result: CompressionResult = {
    original: input,
    compressed,
    profile: selectedProfile as CompressionProfile,
    originalChars,
    compressedChars,
    originalLines,
    compressedLines,
    originalTokens,
    compressedTokens,
    compressionRatio: originalChars > 0 ? compressedChars / originalChars : 1,
    tokenSavings: originalTokens - compressedTokens,
    lineReduction: originalLines - compressedLines,
    abbreviationsExpanded,
    abbreviationsContracted,
    fillersRemoved,
    causalNotationsApplied,
    durationMs: Date.now() - startTime,
  };

  // Save metrics
  if (config.metrics?.enabled) {
    saveMetrics(result);
  }

  return result;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function loadMetrics(): CompressionMetrics {
  const config = getConfig();
  const metricsPath = join(
    ROOT,
    config.metrics?.storagePath ?? '.runtime/output-compression-metrics.json',
  );

  try {
    if (existsSync(metricsPath)) {
      return JSON.parse(readFileSync(metricsPath, 'utf-8')) as CompressionMetrics;
    }
  } catch {
    /* ignore */
  }

  return {
    totalRuns: 0,
    totalOriginalChars: 0,
    totalCompressedChars: 0,
    totalOriginalTokens: 0,
    totalCompressedTokens: 0,
    averageCompressionRatio: 1,
    totalTokenSavings: 0,
    byProfile: {
      ultra: { runs: 0, avgCompressionRatio: 1, avgTokenSavings: 0 },
      lleno: { runs: 0, avgCompressionRatio: 1, avgTokenSavings: 0 },
      lite: { runs: 0, avgCompressionRatio: 1, avgTokenSavings: 0 },
      simple: { runs: 0, avgCompressionRatio: 1, avgTokenSavings: 0 },
    },
  };
}

function saveMetrics(result: CompressionResult): void {
  try {
    const config = getConfig();
    const metricsPath = join(
      ROOT,
      config.metrics?.storagePath ?? '.runtime/output-compression-metrics.json',
    );
    const metrics = loadMetrics();

    // Update global metrics
    metrics.totalRuns++;
    metrics.totalOriginalChars += result.originalChars;
    metrics.totalCompressedChars += result.compressedChars;
    metrics.totalOriginalTokens += result.originalTokens;
    metrics.totalCompressedTokens += result.compressedTokens;
    metrics.averageCompressionRatio = metrics.totalCompressedChars / metrics.totalOriginalChars;
    metrics.totalTokenSavings += result.tokenSavings;

    // Update per-profile metrics
    const profileMetrics = metrics.byProfile[result.profile];
    if (profileMetrics) {
      profileMetrics.runs++;
      profileMetrics.avgCompressionRatio =
        (profileMetrics.avgCompressionRatio * (profileMetrics.runs - 1) + result.compressionRatio) /
        profileMetrics.runs;
      profileMetrics.avgTokenSavings =
        (profileMetrics.avgTokenSavings * (profileMetrics.runs - 1) + result.tokenSavings) /
        profileMetrics.runs;
    }

    // Ensure directory exists
    ensureDir(metricsPath);
    writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf-8');
  } catch {
    /* metrics are non-critical */
  }
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Break-Glass Audit ────────────────────────────────────────────────────────

export function logBreakGlassOverride(
  reason: string,
  fromProfile: CompressionProfile,
  toProfile: CompressionProfile,
): void {
  const config = getConfig();
  if (!config.breakGlass?.enabled) return;

  const auditPath = join(ROOT, config.breakGlass.auditLog);
  ensureDir(auditPath);

  const entry = {
    timestamp: new Date().toISOString(),
    reason,
    fromProfile,
    toProfile,
  };

  try {
    appendFileSync(auditPath, JSON.stringify(entry) + '\n');
  } catch {
    /* ignore */
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
Output Compression Engine

Usage:
  npx tsx src/output-compression.ts --input "response text" [--profile <name>] [--options]
  npx tsx src/output-compression.ts --file response.txt [--profile <name>]
  npx tsx src/output-compression.ts --stats

Profiles:
  ultra    - Aggressive compression (10 lines, 500 tokens max)
  lleno    - Compressed with fragments (25 lines, 1500 tokens max)
  lite     - Professional concise (50 lines, 3000 tokens max)
  simple   - Minimum viable (15 lines, 750 tokens max)
  auto     - Auto-select based on token budget

Options:
  --input TEXT          Response text to compress
  --file PATH           Read response from file
  --profile NAME        Compression profile (default: auto)
  --max-lines N         Override max lines
  --max-tokens N        Override max tokens
  --expand-only         Only expand abbreviations (no contraction)
  --json                Output as JSON
  --quiet               Suppress extra output

Examples:
  npx tsx src/output-compression.ts --input "Hello world" --profile ultra
  npx tsx src/output-compression.ts --file large-response.md --profile simple --max-lines 5
`);
}

function formatResult(result: CompressionResult): string {
  const savingsPct = ((1 - result.compressionRatio) * 100).toFixed(1);
  const lines: string[] = [
    '',
    '╔══════════════════════════════════════╗',
    '║      Output Compression Report       ║',
    '╚══════════════════════════════════════╝',
    '',
    `  Profile:       ${result.profile}`,
    `  Duration:      ${result.durationMs}ms`,
    '',
    `  Original:      ${result.originalChars.toLocaleString()} chars, ${result.originalLines} lines, ~${result.originalTokens} tokens`,
    `  Compressed:    ${result.compressedChars.toLocaleString()} chars, ${result.compressedLines} lines, ~${result.compressedTokens} tokens`,
    `  Savings:       ${savingsPct}% | ${result.tokenSavings} tokens saved`,
    '',
    `  Transformations:`,
    `    • Abbreviations expanded:  ${result.abbreviationsExpanded}`,
    `    • Abbreviations contracted: ${result.abbreviationsContracted}`,
    `    • Fillers removed:         ${result.fillersRemoved}`,
    `    • Causal notations:        ${result.causalNotationsApplied}`,
    '',
  ];

  if (
    result.compressedLines < result.originalLines ||
    result.compressedChars < result.originalChars
  ) {
    lines.push('  ⚡ Compressed output:', '', result.compressed.slice(0, 500));
    if (result.compressed.length > 500) lines.push('  ... (truncated)');
  }

  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const fileIdx = args.indexOf('--file');
  const profileIdx = args.indexOf('--profile');
  const maxLinesIdx = args.indexOf('--max-lines');
  const maxTokensIdx = args.indexOf('--max-tokens');
  const statsFlag = args.includes('--stats');
  const jsonFlag = args.includes('--json');
  const quietFlag = args.includes('--quiet');
  const expandOnlyFlag = args.includes('--expand-only');

  if (statsFlag) {
    const metrics = loadMetrics();
    if (jsonFlag) {
      console.log(JSON.stringify(metrics, null, 2));
      return;
    }
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║    Output Compression Statistics     ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Total runs:           ${metrics.totalRuns}`);
    console.log(`  Total original:       ${metrics.totalOriginalChars.toLocaleString()} chars`);
    console.log(`  Total compressed:     ${metrics.totalCompressedChars.toLocaleString()} chars`);
    console.log(`  Average ratio:        ${(metrics.averageCompressionRatio * 100).toFixed(1)}%`);
    console.log(`  Total token savings:  ${metrics.totalTokenSavings.toLocaleString()}`);
    console.log('');
    console.log('  By profile:');
    for (const [profile, p] of Object.entries(metrics.byProfile)) {
      if (p.runs > 0) {
        console.log(
          `    ${profile.padEnd(8)} ${p.runs} runs, ${(p.avgCompressionRatio * 100).toFixed(1)}% ratio, ${p.avgTokenSavings.toFixed(0)} avg tokens saved`,
        );
      }
    }
    return;
  }

  let input = '';
  let profile: CompressionProfile | 'auto' = 'auto';
  const options: { maxLines?: number; maxTokens?: number; expandOnly?: boolean } = {};

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

  if (profileIdx >= 0) {
    const p = args[profileIdx + 1];
    if (p === 'ultra' || p === 'lleno' || p === 'lite' || p === 'simple' || p === 'auto') {
      profile = p;
    }
  }

  if (maxLinesIdx >= 0) {
    options.maxLines = parseInt(args[maxLinesIdx + 1] ?? '0', 10);
  }

  if (maxTokensIdx >= 0) {
    options.maxTokens = parseInt(args[maxTokensIdx + 1] ?? '0', 10);
  }

  if (expandOnlyFlag) {
    options.expandOnly = true;
  }

  if (!input) {
    printUsage();
    process.exit(1);
  }

  const result = compressOutput(input, profile, options);

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

// ─── Run CLI if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
