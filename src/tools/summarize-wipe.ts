#!/usr/bin/env node
/**
 * Summarize & Wipe — Context Compaction Engine.
 *
 * When token budget is running low, this engine compacts the session context:
 *   1. SUMMARIZE — Reads current session context, checks token budget,
 *      produces a compact summary via the semantic router.
 *   2. WIPE — After summarization, removes old context files to free tokens.
 *   3. RESTORE — Loads the most recent compacted context back into the session.
 *   4. CHECK — Reports current token usage vs thresholds.
 *   5. AUTO — Runs summarize+wipe if usage exceeds soft threshold.
 *
 * Pipeline step: lazy (non-blocking) in session-autostart.config.json.
 *
 * Usage:
 *   npx tsx src/tools/summarize-wipe.ts check
 *   npx tsx src/tools/summarize-wipe.ts summarize
 *   npx tsx src/tools/summarize-wipe.ts wipe
 *   npx tsx src/tools/summarize-wipe.ts restore
 *   npx tsx src/tools/summarize-wipe.ts auto
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Configuration ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');

interface SwConfig {
  sessionDir: string;
  compactedDir: string;
  tokenBudgetFile: string;
  softThresholdPct: number;
  hardThresholdPct: number;
  dailyBudgetTokens: number;
  maxCompactions: number;
}

const DEFAULT_CONFIG: SwConfig = {
  sessionDir: join(ROOT, '.session'),
  compactedDir: join(ROOT, '.session', 'compacted'),
  tokenBudgetFile: join(ROOT, '.session', 'token-budget.json'),
  softThresholdPct: 70,
  hardThresholdPct: 90,
  dailyBudgetTokens: 30000,
  maxCompactions: 10,
};

// ── Logging ──────────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.log(`[${ts}] [${level}] [summarize-wipe] ${msg}${metaStr}`);
}

// ── Token Budget ─────────────────────────────────────────────────────────────

interface TokenUsage {
  used: number;
  dailyBudget: number;
  softThreshold: number;
  hardThreshold: number;
  pctUsed: number;
}

function readTokenUsage(config: SwConfig): TokenUsage {
  // Try to read from token-budget file
  if (existsSync(config.tokenBudgetFile)) {
    try {
      const raw = JSON.parse(readFileSync(config.tokenBudgetFile, 'utf-8'));
      const used = raw.used ?? raw.consumed ?? raw.tokensUsed ?? 0;
      const dailyBudget = raw.daily_budget ?? raw.dailyBudget ?? config.dailyBudgetTokens;
      const softThreshold = raw.soft_threshold_pct ?? config.softThresholdPct;
      const hardThreshold = raw.hard_threshold_pct ?? config.hardThresholdPct;
      const pctUsed = dailyBudget > 0 ? Math.round((used / dailyBudget) * 100) : 0;
      return { used, dailyBudget, softThreshold, hardThreshold, pctUsed };
    } catch {
      // file exists but corrupt
    }
  }

  // Try token-budget-guard config
  const guardConfig = join(ROOT, 'config', 'token-budget-guard.json');
  if (existsSync(guardConfig)) {
    try {
      const raw = JSON.parse(readFileSync(guardConfig, 'utf-8'));
      const tb = raw?.tokenBudget?.limits;
      if (tb) {
        const dailyBudget = tb.daily ?? config.dailyBudgetTokens;
        const softThreshold = tb.softThreshold ?? config.softThresholdPct;
        const hardThreshold = tb.hardThreshold ?? config.hardThresholdPct;
        return { used: 0, dailyBudget, softThreshold, hardThreshold, pctUsed: 0 };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    used: 0,
    dailyBudget: config.dailyBudgetTokens,
    softThreshold: config.softThresholdPct,
    hardThreshold: config.hardThresholdPct,
    pctUsed: 0,
  };
}

function estimateContextTokens(config: SwConfig): number {
  let total = 0;
  if (!existsSync(config.sessionDir)) return 0;

  try {
    const files = readdirSync(config.sessionDir, { recursive: true }) as string[];
    for (const file of files) {
      const fullPath = join(config.sessionDir, file.toString());
      if (!fullPath.endsWith('.json') && !fullPath.endsWith('.md') && !fullPath.endsWith('.txt'))
        continue;
      try {
        const stat = readFileSync(fullPath, 'utf-8');
        total += stat.length;
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* ignore */
  }

  // Rough estimate: ~4 chars per token
  return Math.round(total / 4);
}

// ── Compaction ───────────────────────────────────────────────────────────────

interface CompactionRecord {
  id: string;
  timestamp: string;
  summaryFile: string;
  originalTokens: number;
  summaryTokens: number;
  tokenReduction: number;
  reductionPct: number;
  fileCount: number;
}

function generateCompactionId(): string {
  return `compaction-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function doSummarize(config: SwConfig): CompactionRecord | null {
  const id = generateCompactionId();
  ensureDir(config.compactedDir);

  const sessionFiles = collectSessionFiles(config);
  if (sessionFiles.length === 0) {
    log('WARN', 'No session files to compact');
    return null;
  }

  const originalTokens = estimateContextTokens(config);

  // Build context summary
  const contextSummary: string[] = [
    `# Compacted Session Context — ${new Date().toISOString()}`,
    ``,
    `## Original Stats`,
    `- Files: ${sessionFiles.length}`,
    `- Estimated tokens: ~${originalTokens.toLocaleString()}`,
    ``,
    `## File Inventory`,
  ];

  for (const file of sessionFiles) {
    const relPath = file.replace(ROOT, '').replace(/^[/\\]/, '');
    const content = readFileSync(file, 'utf-8');
    const tokenEst = Math.round(content.length / 4);

    // Extract key lines (first 3 content lines + last line)
    const lines = content.split('\n').filter((l) => l.trim());
    const keyLines: string[] = [];
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      keyLines.push(lines[i].trim());
    }
    if (lines.length > 3) {
      keyLines.push(`...(${lines.length - 3} more lines)...`);
      keyLines.push(lines[lines.length - 1].trim());
    }

    contextSummary.push(`\n### ${relPath} (~${tokenEst.toLocaleString()} tokens)`);
    for (const kl of keyLines) {
      contextSummary.push(`  ${kl}`);
    }
  }

  const summaryContent = contextSummary.join('\n');
  const summaryTokens = Math.round(summaryContent.length / 4);
  const summaryFile = join(config.compactedDir, `${id}.md`);
  writeFileSync(summaryFile, summaryContent, 'utf-8');

  // Write metadata
  const metadata: CompactionRecord = {
    id,
    timestamp: new Date().toISOString(),
    summaryFile,
    originalTokens,
    summaryTokens,
    tokenReduction: originalTokens - summaryTokens,
    reductionPct:
      originalTokens > 0
        ? Math.round(((originalTokens - summaryTokens) / originalTokens) * 100)
        : 0,
    fileCount: sessionFiles.length,
  };

  const metaFile = join(config.compactedDir, `${id}.json`);
  writeFileSync(metaFile, JSON.stringify(metadata, null, 2), 'utf-8');

  log('INFO', 'Compaction created', {
    id,
    originalTokens,
    summaryTokens,
    reductionPct: metadata.reductionPct,
    fileCount: sessionFiles.length,
  });

  return metadata;
}

function collectSessionFiles(config: SwConfig): string[] {
  if (!existsSync(config.sessionDir)) return [];
  const files: string[] = [];

  try {
    const entries = readdirSync(config.sessionDir, { recursive: true }) as string[];
    for (const entry of entries) {
      const fullPath = join(config.sessionDir, entry.toString());
      if (existsSync(fullPath) && !fullPath.startsWith(config.compactedDir)) {
        try {
          const stat = readFileSync(fullPath, 'utf-8');
          if (stat.trim().length > 0) files.push(fullPath);
        } catch {
          /* skip unreadable */
        }
      }
    }
  } catch {
    /* ignore */
  }

  return files;
}

function doWipe(config: SwConfig, exceptId?: string): number {
  if (!existsSync(config.sessionDir)) return 0;
  let wiped = 0;

  try {
    const entries = readdirSync(config.sessionDir, { recursive: true }) as string[];
    for (const entry of entries) {
      const fullPath = join(config.sessionDir, entry.toString());
      if (fullPath.startsWith(config.compactedDir)) continue;
      if (exceptId && fullPath.includes(exceptId)) continue;

      try {
        const stat = readFileSync(fullPath, 'utf-8');
        if (stat.trim().length > 0) {
          unlinkSync(fullPath);
          wiped++;
        }
      } catch {
        /* skip locked files */
      }
    }
  } catch {
    /* ignore */
  }

  log('INFO', 'Wiped session files', { count: wiped, exceptId: exceptId ?? 'none' });
  return wiped;
}

function doRestore(config: SwConfig): string | null {
  if (!existsSync(config.compactedDir)) {
    log('WARN', 'No compacted directory found');
    return null;
  }

  try {
    const files = readdirSync(config.compactedDir)
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .sort()
      .reverse();

    if (files.length === 0) {
      log('WARN', 'No compactions found to restore');
      return null;
    }

    const latest = files[0];
    const meta = JSON.parse(
      readFileSync(join(config.compactedDir, latest), 'utf-8'),
    ) as CompactionRecord;

    if (!existsSync(meta.summaryFile)) {
      log('WARN', 'Summary file not found', { path: meta.summaryFile });
      return null;
    }

    const summaryContent = readFileSync(meta.summaryFile, 'utf-8');

    // Write compacted context back to session
    const restoreFile = join(config.sessionDir, 'compacted-context.md');
    writeFileSync(restoreFile, summaryContent, 'utf-8');

    log('INFO', 'Restored compacted context', {
      compactionId: meta.id,
      size: summaryContent.length,
      restoreFile,
    });

    return restoreFile;
  } catch (err) {
    log('ERROR', 'Restore failed', { error: String(err) });
    return null;
  }
}

function listCompactions(config: SwConfig): CompactionRecord[] {
  if (!existsSync(config.compactedDir)) return [];

  try {
    const files = readdirSync(config.compactedDir)
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .sort()
      .reverse();

    return files
      .map((f) => {
        try {
          return JSON.parse(
            readFileSync(join(config.compactedDir, f), 'utf-8'),
          ) as CompactionRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is CompactionRecord => r !== null);
  } catch {
    return [];
  }
}

// ── CLI Actions ──────────────────────────────────────────────────────────────

function actionCheck(config: SwConfig): void {
  const usage = readTokenUsage(config);
  const estimatedTokens = estimateContextTokens(config);

  console.log(`\n📊 **Token Usage Report**`);
  console.log(`   Used today:     ${usage.used.toLocaleString()} tokens`);
  console.log(`   Daily budget:   ${usage.dailyBudget.toLocaleString()} tokens`);
  console.log(`   Usage:          ${usage.pctUsed}%`);
  console.log(`   Soft threshold: ${usage.softThreshold}%`);
  console.log(`   Hard threshold: ${usage.hardThreshold}%`);

  if (usage.pctUsed >= usage.hardThreshold) {
    console.log(`   ⚠ Status: **CRITICAL** — Hard threshold exceeded!`);
  } else if (usage.pctUsed >= usage.softThreshold) {
    console.log(`   ⚠ Status: **WARNING** — Above soft threshold`);
  } else {
    console.log(`   ✅ Status: **OK** — Within budget`);
  }

  console.log(`\n📁 Session context:`);
  console.log(`   Estimated tokens: ~${estimatedTokens.toLocaleString()}`);

  if (existsSync(config.compactedDir)) {
    const compactions = listCompactions(config);
    console.log(`   Compactions:     ${compactions.length}`);
    if (compactions.length > 0) {
      const latest = compactions[0];
      console.log(`   Latest:          ${latest.timestamp} (${latest.reductionPct}% reduction)`);
    }
  } else {
    console.log(`   Compactions:     0`);
  }
}

function actionSummarize(config: SwConfig): void {
  log('INFO', 'Starting summarization');

  const usage = readTokenUsage(config);
  const estimatedTokens = estimateContextTokens(config);

  if (usage.pctUsed < usage.softThreshold && estimatedTokens < 1000) {
    log('INFO', 'Token usage within budget, no compaction needed', {
      pctUsed: usage.pctUsed,
      estimatedTokens,
    });
    return;
  }

  const result = doSummarize(config);
  if (result) {
    console.log(`\n✅ **Compaction Complete**`);
    console.log(`   ID:          ${result.id}`);
    console.log(`   Original:    ~${result.originalTokens.toLocaleString()} tokens`);
    console.log(`   Summary:     ~${result.summaryTokens.toLocaleString()} tokens`);
    console.log(`   Reduction:   ${result.reductionPct}%`);
    console.log(`   Files:       ${result.fileCount}`);
    console.log(`   Summary:     ${result.summaryFile}`);
  }
}

function actionWipe(config: SwConfig): void {
  log('INFO', 'Wiping session context');

  const compactions = listCompactions(config);
  const latestId = compactions.length > 0 ? compactions[0].id : undefined;

  const wiped = doWipe(config, latestId);
  console.log(`\n🧹 **Wipe Complete**`);
  console.log(`   Files removed: ${wiped}`);
  if (latestId) {
    console.log(`   Preserved:     Compaction ${latestId}`);
  }
}

function actionRestore(config: SwConfig): void {
  log('INFO', 'Restoring compacted context');

  const result = doRestore(config);
  if (result) {
    console.log(`\n📂 **Restore Complete**`);
    console.log(`   Restored to: ${result}`);
  } else {
    console.log('\n❌ No compacted context available to restore');
  }
}

function actionAuto(config: SwConfig): void {
  log('INFO', 'Auto compaction check');

  const usage = readTokenUsage(config);
  const estimatedTokens = estimateContextTokens(config);

  console.log(`\n🔄 **Auto Compaction Check**`);
  console.log(`   Token usage: ${usage.pctUsed}% (threshold: ${usage.softThreshold}%)`);
  console.log(`   Session tokens: ~${estimatedTokens.toLocaleString()}`);

  if (usage.pctUsed >= usage.softThreshold || estimatedTokens > 5000) {
    console.log(`   → Compaction triggered`);

    const result = doSummarize(config);
    if (result) {
      const wiped = doWipe(config, result.id);
      console.log(
        `   ✅ Compaction ${result.id}: ${result.reductionPct}% reduction, ${wiped} files wiped`,
      );
    }
  } else {
    console.log(`   → No compaction needed`);
  }

  // Prune old compactions
  const all = listCompactions(config);
  if (all.length > config.maxCompactions) {
    const toRemove = all.slice(config.maxCompactions);
    for (const old of toRemove) {
      try {
        if (existsSync(old.summaryFile)) unlinkSync(old.summaryFile);
        const metaFile = join(config.compactedDir, `${old.id}.json`);
        if (existsSync(metaFile)) unlinkSync(metaFile);
      } catch {
        /* ignore */
      }
    }
    console.log(
      `   🧹 Pruned ${toRemove.length} old compactions (keeping ${config.maxCompactions})`,
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
Usage: npx tsx src/tools/summarize-wipe.ts <action>

Actions:
  check      Check current token usage and compaction status
  summarize  Compact session context into a summary file
  wipe       Remove old session files (preserving latest compaction)
  restore    Restore most recent compacted context back to session
  auto       Auto: compact if usage exceeds threshold, then wipe

Options:
  --help     Show this help
`);
}

async function main(): Promise<void> {
  const config = { ...DEFAULT_CONFIG };
  const args = process.argv.slice(2);
  const action = args[0] || 'check';

  if (action === '--help' || action === 'help') {
    printHelp();
    return;
  }

  switch (action) {
    case 'check':
      actionCheck(config);
      break;
    case 'summarize':
      actionSummarize(config);
      break;
    case 'wipe':
      actionWipe(config);
      break;
    case 'restore':
      actionRestore(config);
      break;
    case 'auto':
      actionAuto(config);
      break;
    default:
      console.log(`Unknown action: ${action}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  log('ERROR', 'Fatal error', { error: String(err) });
  process.exit(1);
});

// ── Exports (for pipeline integration) ───────────────────────────────────────

export { doSummarize, doWipe, doRestore, listCompactions, readTokenUsage, estimateContextTokens };
export type { SwConfig, TokenUsage, CompactionRecord };
