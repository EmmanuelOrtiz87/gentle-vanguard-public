#!/usr/bin/env node
/**
 * Structural Compression Engine — absorbs Headroom compression strategies in pure TS.
 *
 * Complements the existing extractive compression (prompt-compression.ts /
 * output-compression.ts) with STRUCTURAL compression that the rule-based engine
 * does not handle:
 *
 *   1. SmartCrusher      — JSON array compression with statistical decision
 *   2. Tabular compaction — lossless JSON tabular → CSV with schema declaration
 *   3. LogCompressor     — log / stack-trace collapse (build/test outputs)
 *   4. TextCrusher       — prose scoring with BM25 query relevance + shingle dedup
 *   5. CrossCompression  — cross-turn byte dedup (repeated tool output)
 *
 * All strategies are pure algorithms (regex + statistics + hashing). No ML, no
 * Python/Rust sidecar. Config-driven from config/structural-compression.json.
 *
 * Usage:
 *   npx tsx src/structural-compression.ts --input "..." [--query "..."]
 *   npx tsx src/structural-compression.ts --file response.json
 *   npx tsx src/structural-compression.ts --stats
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';

const ROOT = resolve(process.env.GENTLE_VANGUARD_BASE_DIR ?? process.cwd());
const CONFIG_PATH = join(ROOT, 'config', 'structural-compression.json');

// ─── Types ────────────────────────────────────────────────────────────────────

export type StructuralKind = 'json' | 'tabular' | 'log' | 'prose' | 'code' | 'none';

export interface StructuralConfig {
  version: string;
  enabled: boolean;
  input: {
    enabled: boolean;
    allowLossy: boolean;
  };
  output: {
    enabled: boolean;
    allowLossy: boolean;
  };
  smartCrusher: {
    enabled: boolean;
    maxItemsAfterCrush: number;
    losslessMinSavingsRatio: number;
    relevanceThreshold: number;
  };
  tabular: {
    enabled: boolean;
    minRows: number;
    minSavingsRatio: number;
  };
  logCompressor: {
    enabled: boolean;
    maxErrors: number;
    maxWarnings: number;
    maxStackTraces: number;
    contextLines: number;
    collapseFrames: boolean;
  };
  textCrusher: {
    enabled: boolean;
    targetRatio: number;
    minSegmentLength: number;
    nearDupThreshold: number;
    useBm25: boolean;
  };
  crossCompression: {
    enabled: boolean;
    minLines: number;
    minChars: number;
  };
  metrics: {
    enabled: boolean;
    storagePath: string;
  };
}

export interface StructuralResult {
  kind: StructuralKind;
  original: string;
  compressed: string;
  originalChars: number;
  compressedChars: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  tokenSavings: number;
  strategy: string;
  details: Record<string, unknown>;
  durationMs: number;
}

interface CompressOptions {
  query?: string;
  previousTurns?: string[];
  /** 'input' = prompt path (lossless-only by default); 'output' = response path (lossy OK). */
  mode?: 'input' | 'output';
}

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: StructuralConfig = {
  version: '1.1.0',
  enabled: true,
  input: {
    enabled: true,
    allowLossy: false,
  },
  output: {
    enabled: true,
    allowLossy: true,
  },
  smartCrusher: {
    enabled: true,
    maxItemsAfterCrush: 20,
    losslessMinSavingsRatio: 0.15,
    relevanceThreshold: 0.2,
  },
  tabular: {
    enabled: true,
    minRows: 5,
    minSavingsRatio: 0.15,
  },
  logCompressor: {
    enabled: true,
    maxErrors: 20,
    maxWarnings: 15,
    maxStackTraces: 5,
    contextLines: 2,
    collapseFrames: true,
  },
  textCrusher: {
    enabled: true,
    targetRatio: 0.5,
    minSegmentLength: 40,
    nearDupThreshold: 0.8,
    useBm25: true,
  },
  crossCompression: {
    enabled: true,
    minLines: 3,
    minChars: 40,
  },
  metrics: {
    enabled: true,
    storagePath: '.runtime/structural-compression-metrics.json',
  },
};

// ─── Config loader ────────────────────────────────────────────────────────────

let _config: StructuralConfig | null = null;

function getConfig(): StructuralConfig {
  if (!_config) {
    let loaded: StructuralConfig = DEFAULT_CONFIG;
    if (existsSync(CONFIG_PATH)) {
      try {
        loaded = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) };
      } catch {
        /* fall back to defaults */
      }
    }
    _config = loaded;
  }
  return _config;
}

// ─── Token estimation (chars/4, aligned with stack) ───────────────────────────

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

// ─── BM25 scorer (query relevance) ────────────────────────────────────────────
// Port of headroom bm25.rs: k1=1.5, b=0.75, idf=ln(2), normalize ≤ max_score(10),
// +0.3 bonus for tokens ≥ 8 chars.

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const BM25_IDF = Math.log(2);
const BM25_MAX_SCORE = 10;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[A-Za-z0-9_]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[0].toLowerCase());
  }
  return tokens;
}

function bm25Score(query: string, doc: string): number {
  if (!query || !doc) return 0;
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const dTokens = tokenize(doc);
  if (dTokens.length === 0) return 0;

  const docLen = dTokens.length;
  const avgDocLen = Math.max(docLen, 1);
  const freq = new Map<string, number>();
  for (const t of dTokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  let score = 0;
  for (const qt of qTokens) {
    const tf = freq.get(qt) ?? 0;
    if (tf === 0) continue;
    const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    let s = (tf / denom) * BM25_IDF;
    if (qt.length >= 8) s += 0.3;
    score += s;
  }
  return Math.min(score, BM25_MAX_SCORE);
}

// ─── SmartCrusher: JSON array compression ─────────────────────────────────────

function isScoreLike(name: string): boolean {
  return /(score|rating|rank|relevance|confidence|probability|pct|percent)/i.test(name);
}

function detectArrayPattern(
  rows: Record<string, unknown>[],
): 'time_series' | 'logs' | 'search_results' | 'generic' {
  if (rows.length === 0) return 'generic';
  const first = rows[0];
  const keys = Object.keys(first);
  const hasTime = keys.some((k) => /(time|date|ts|timestamp|created|updated)/i.test(k));
  const hasMessage = keys.some((k) => /(msg|message|log|text|content)/i.test(k));
  const hasScore = keys.some((k) => isScoreLike(k));
  if (hasTime && hasMessage) return 'logs';
  if (hasScore) return 'search_results';
  if (hasTime) return 'time_series';
  return 'generic';
}

function crushJsonArray(
  rows: Record<string, unknown>[],
  opts: { maxItemsAfterCrush: number },
): { kept: Record<string, unknown>[]; dropped: number; strategy: string } {
  if (rows.length <= opts.maxItemsAfterCrush) {
    return { kept: rows, dropped: 0, strategy: 'skip' };
  }
  const kind = detectArrayPattern(rows);
  const keys = Object.keys(rows[0] ?? {});
  const scoreKey = keys.find((k) => isScoreLike(k));

  // Preserve outliers: rows whose numeric field deviates > 2 std from mean
  const numericKeys = keys.filter((k) => typeof rows[0]?.[k] === 'number');
  const outlierIdx = new Set<number>();
  for (const nk of numericKeys) {
    const vals = rows.map((r) => Number(r[nk]) || 0);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      vals.forEach((v, i) => {
        if (Math.abs(v - mean) > 2 * std) outlierIdx.add(i);
      });
    }
  }

  // Anchor: first and last rows always kept
  const keep = new Set<number>([0, rows.length - 1]);
  outlierIdx.forEach((i) => keep.add(i));

  // Score-based selection for search_results / generic
  if (scoreKey) {
    const scored = rows
      .map((r, i) => ({ i, score: Number(r[scoreKey]) || 0 }))
      .sort((a, b) => b.score - a.score);
    const budget = Math.max(1, Math.floor(opts.maxItemsAfterCrush * 0.7));
    for (const s of scored.slice(0, budget)) keep.add(s.i);
  } else {
    // Evenly sample the remainder
    const budget = Math.max(1, opts.maxItemsAfterCrush - keep.size);
    let idx = 0;
    let added = 0;
    for (let i = 0; i < rows.length && added < budget; i++) {
      if (keep.has(i)) continue;
      if (idx % Math.max(1, Math.floor(rows.length / budget)) === 0) {
        keep.add(i);
        added++;
      }
      idx++;
    }
  }

  const kept = rows.filter((_, i) => keep.has(i));
  return { kept, dropped: rows.length - kept.length, strategy: kind };
}

// ─── 2. Tabular compaction (lossless JSON → CSV with schema) ──────────────────

function compactTabular(rows: Record<string, unknown>[]): string | null {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]);
  if (keys.length === 0) return null;

  const colTypes: Record<string, string> = {};
  for (const k of keys) {
    const t = typeof rows[0][k];
    colTypes[k] = t === 'number' ? 'num' : t === 'boolean' ? 'bool' : 'str';
  }

  const schema = `[${rows.length}]{${keys.map((k) => `${k}:${colTypes[k]}`).join(',')}}`;
  const header = keys.join(',');
  const lines = rows.map((r) =>
    keys
      .map((k) => {
        const v = r[k];
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.length > 80 || /^data:|base64|^[A-Za-z0-9+/]{40,}={0,2}$/.test(s)) {
          return `<<ccr:${sha256(s)},${s.length}>>`;
        }
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(','),
  );

  const csv = [schema, header, ...lines].join('\n');
  const raw = JSON.stringify(rows);
  if (csv.length >= raw.length * (1 - 0.15)) return null; // not enough savings
  return csv;
}

// ─── 3. LogCompressor: log / stack-trace collapse ─────────────────────────────

const STACK_FRAME_RE = /^\s*at\s+.*\(.*:\d+:\d+\)$|^\s*at\s+.*:\d+:\d+$|^\s+at\s+/;
const LOG_LEVEL_RE =
  /^\s*\[?(ERROR|FAIL|WARN|WARNING|INFO|DEBUG|TRACE|error|fail|warn|info|debug|trace)\]?\s*[:.-]?\s*/;
const ERROR_KEYWORD_RE = /(error|failed|failure|exception|panic|assert|traceback|fatal|crash)/i;

function collapseStackTraces(text: string, maxStackTraces: number): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let traceCount = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (STACK_FRAME_RE.test(line)) {
      const start = i;
      let runLen = 0;
      while (i < lines.length && STACK_FRAME_RE.test(lines[i])) {
        runLen++;
        i++;
      }
      if (traceCount < maxStackTraces) {
        out.push(lines[start]);
        if (runLen > 2) out.push(`[... ${runLen - 2} frames collapsed]`);
        out.push(lines[i - 1]);
      } else {
        out.push(`[${runLen} frames collapsed]`);
      }
      traceCount++;
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

function compressLogs(text: string, cfg: StructuralConfig['logCompressor']): string {
  const lines = text.split('\n');
  const errors: string[] = [];
  const warnings: string[] = [];
  const other: string[] = [];
  const seenWarnings = new Set<string>();

  for (const line of lines) {
    const levelMatch = line.match(LOG_LEVEL_RE);
    const level = levelMatch ? levelMatch[1].toUpperCase() : '';
    if (level === 'ERROR' || level === 'FAIL' || ERROR_KEYWORD_RE.test(line)) {
      if (errors.length < cfg.maxErrors) errors.push(line);
    } else if (level === 'WARN' || level === 'WARNING') {
      const norm = line.replace(/\d+/g, 'N').slice(0, 80);
      if (!seenWarnings.has(norm) && warnings.length < cfg.maxWarnings) {
        seenWarnings.add(norm);
        warnings.push(line);
      }
    } else {
      other.push(line);
    }
  }

  const kept = [...errors, ...warnings, ...other];
  let result = kept.join('\n');
  if (cfg.collapseFrames) result = collapseStackTraces(result, cfg.maxStackTraces);
  return result;
}

// ─── 4. TextCrusher: prose scoring with BM25 + shingle dedup ──────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordShingles(text: string, n = 3): Set<string> {
  const words = tokenize(text);
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(' '));
  }
  return shingles;
}

function compressProse(text: string, query: string, opts: StructuralConfig['textCrusher']): string {
  const segments = splitSentences(text);
  if (segments.length <= 1) return text;

  const scored = segments.map((seg, i) => {
    const recency = (i + 1) / segments.length;
    const relevance = opts.useBm25 ? bm25Score(query, seg) : 0;
    const salience = /(\d+)|(error|failed|warning|traceback|assert|todo|fixme)/i.test(seg) ? 1 : 0;
    let score = 0.5 * recency + 0.3 * Math.min(relevance / 5, 1) + 0.2 * salience;
    if (seg.length < opts.minSegmentLength) score *= 0.25;
    return { seg, score, i };
  });

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const kept = new Set<number>();
  const seenShingles = new Set<string>();
  const targetCount = Math.max(1, Math.ceil(segments.length * opts.targetRatio));

  for (const s of sorted) {
    if (kept.size >= targetCount) break;
    const shingles = wordShingles(s.seg);
    let isNearDup = false;
    for (const sh of shingles) {
      if (seenShingles.has(sh)) {
        isNearDup = true;
        break;
      }
    }
    if (isNearDup) continue;
    shingles.forEach((sh) => seenShingles.add(sh));
    kept.add(s.i);
  }

  return segments
    .map((seg, i) => (kept.has(i) ? seg : null))
    .filter((s): s is string => s !== null)
    .join('\n');
}

// ─── 5. CrossCompression: cross-turn dedup ────────────────────────────────────

function crossTurnCompress(
  text: string,
  previousTurns: string[],
  opts: StructuralConfig['crossCompression'],
): string {
  if (!previousTurns || previousTurns.length === 0) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let matched = false;
    for (const prev of previousTurns) {
      const prevLines = prev.split('\n');
      const idx = prevLines.indexOf(line);
      if (idx >= 0) {
        let run = 1;
        while (
          i + run < lines.length &&
          idx + run < prevLines.length &&
          lines[i + run] === prevLines[idx + run]
        ) {
          run++;
        }
        if (run >= opts.minLines && line.length * run >= opts.minChars) {
          out.push(`[←${run} lines repeated from previous turn]`);
          i += run;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

// ─── Orchestrator: detect + compress ──────────────────────────────────────────

export function detectKind(input: string): StructuralKind {
  const trimmed = input.trim();
  if (!trimmed) return 'none';

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (first && typeof first === 'object' && !Array.isArray(first)) return 'tabular';
        return 'json';
      }
    } catch {
      /* not valid JSON */
    }
  }

  const lines = trimmed.split('\n');
  const logLike = lines.filter((l) => LOG_LEVEL_RE.test(l) || STACK_FRAME_RE.test(l)).length;
  if (logLike / Math.max(lines.length, 1) > 0.15) return 'log';

  if (/(^|\n)\s*(function|const|let|class|def|import|export|interface|type)\s/.test(trimmed)) {
    return 'code';
  }

  if (lines.length > 3 && trimmed.length > 200) return 'prose';

  return 'none';
}

export function compressStructural(input: string, options: CompressOptions = {}): StructuralResult {
  const startTime = Date.now();
  const config = getConfig();
  if (!config.enabled || !input || !input.trim()) {
    return {
      kind: 'none',
      original: input,
      compressed: input,
      originalChars: input?.length ?? 0,
      compressedChars: input?.length ?? 0,
      originalTokens: estimateTokens(input),
      compressedTokens: estimateTokens(input),
      compressionRatio: 1,
      tokenSavings: 0,
      strategy: 'none',
      details: {},
      durationMs: 0,
    };
  }

  const kind = detectKind(input);
  let compressed = input;
  let strategy = 'none';
  const details: Record<string, unknown> = { kind };

  // SAFETY: determine whether lossy strategies are allowed for this path.
  // input mode is lossless-only by default (protects model reasoning); output
  // mode may use lossy strategies (model already reasoned).
  const mode = options.mode ?? 'output';
  const allowLossy = mode === 'output' ? config.output.allowLossy : config.input.allowLossy;

  try {
    if (kind === 'tabular') {
      const rows = JSON.parse(input) as Record<string, unknown>[];
      if (allowLossy) {
        const crushed = crushJsonArray(rows, {
          maxItemsAfterCrush: config.smartCrusher.maxItemsAfterCrush,
        });
        if (crushed.dropped > 0) {
          compressed = JSON.stringify(crushed.kept);
          strategy = 'smart-crusher';
          details.dropped = crushed.dropped;
          details.strategy = crushed.strategy;
        } else {
          const csv = compactTabular(rows);
          if (csv) {
            compressed = csv;
            strategy = 'tabular-compaction';
            details.rows = rows.length;
          }
        }
      } else {
        // Lossless-only: tabular compaction preserves all rows as CSV+schema.
        const csv = compactTabular(rows);
        if (csv) {
          compressed = csv;
          strategy = 'tabular-compaction';
          details.rows = rows.length;
        }
      }
    } else if (kind === 'log') {
      if (allowLossy) {
        compressed = compressLogs(input, config.logCompressor);
        strategy = 'log-compressor';
        details.collapsed = input.split('\n').length - compressed.split('\n').length;
      }
      // In input mode, logs are left intact (lossy collapse could hide errors).
    } else if (kind === 'prose') {
      if (allowLossy) {
        compressed = compressProse(input, options.query ?? '', config.textCrusher);
        strategy = 'text-crusher';
        details.segments = input.split('\n').length;
      }
      // In input mode, prose is left intact (lossy dropping could hide context).
    }

    if (config.crossCompression.enabled && options.previousTurns?.length) {
      const deduped = crossTurnCompress(compressed, options.previousTurns, config.crossCompression);
      if (deduped.length < compressed.length) {
        compressed = deduped;
        strategy = strategy === 'none' ? 'cross-dedup' : `${strategy}+cross-dedup`;
      }
    }
  } catch (err) {
    compressed = input;
    strategy = 'none';
    details.error = String(err);
  }

  const originalChars = input.length;
  const compressedChars = compressed.length;
  const originalTokens = estimateTokens(input);
  const compressedTokens = estimateTokens(compressed);

  const result: StructuralResult = {
    kind,
    original: input,
    compressed,
    originalChars,
    compressedChars,
    originalTokens,
    compressedTokens,
    compressionRatio: originalChars > 0 ? compressedChars / originalChars : 1,
    tokenSavings: originalTokens - compressedTokens,
    strategy,
    details,
    durationMs: Date.now() - startTime,
  };

  if (config.metrics.enabled) recordMetrics(result);
  return result;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function recordMetrics(result: StructuralResult): void {
  try {
    const cfg = getConfig();
    const path = join(ROOT, cfg.metrics.storagePath);
    mkdirSync(dirname(path), { recursive: true });
    let stats: {
      runs: number;
      totalSaved: number;
      totalOriginal: number;
      byStrategy: Record<string, number>;
    } = { runs: 0, totalSaved: 0, totalOriginal: 0, byStrategy: {} };
    if (existsSync(path)) {
      try {
        stats = JSON.parse(readFileSync(path, 'utf-8'));
      } catch {
        /* reset */
      }
    }
    stats.runs++;
    stats.totalSaved += result.tokenSavings;
    stats.totalOriginal += result.originalTokens;
    stats.byStrategy[result.strategy] = (stats.byStrategy[result.strategy] ?? 0) + 1;
    writeFileSync(path, JSON.stringify(stats, null, 2));
  } catch {
    /* metrics are best-effort */
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let input = '';
  let query = '';
  let file = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') input = args[++i] ?? '';
    else if (args[i] === '--query') query = args[++i] ?? '';
    else if (args[i] === '--file') file = args[++i] ?? '';
    else if (args[i] === '--stats') {
      const p = join(ROOT, getConfig().metrics.storagePath);
      if (existsSync(p)) console.log(readFileSync(p, 'utf-8'));
      else console.log('{}');
      process.exit(0);
    }
  }

  if (file) input = readFileSync(file, 'utf-8');
  if (!input) {
    console.error(
      'Usage: npx tsx src/structural-compression.ts --input "..." [--query "..."] [--file path] [--stats]',
    );
    process.exit(1);
  }

  const result = compressStructural(input, { query });
  console.log(
    JSON.stringify(
      {
        kind: result.kind,
        strategy: result.strategy,
        originalChars: result.originalChars,
        compressedChars: result.compressedChars,
        originalTokens: result.originalTokens,
        compressedTokens: result.compressedTokens,
        compressionRatio: result.compressionRatio,
        tokenSavings: result.tokenSavings,
        details: result.details,
        durationMs: result.durationMs,
        compressed: result.compressed,
      },
      null,
      2,
    ),
  );
}
