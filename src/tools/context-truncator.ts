#!/usr/bin/env node
/**
 * Context Truncator — Sliding Window for Conversation History
 *
 * Reduces token consumption from accumulated conversation history.
 * Problem: Each turn sends the full history (100+ messages = millions of tokens)
 * Solution: Truncate to last N messages + summarize older context
 *
 * Usage:
 *   npx tsx src/tools/context-truncator.ts --history <json> --max-turns 10 --max-tokens 8000
 *   npx tsx src/tools/context-truncator.ts --auto                    # Auto-apply from state
 *   npx tsx src/tools/context-truncator.ts --monitor                 # Monitor and alert
 *   npx tsx src/tools/context-truncator.ts --info                    # Show current context size
 */

import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';

// Paths
const ROOT = resolve(process.cwd());
const STATE_DIR = join(ROOT, '.session', 'context-log');
const LOG_FILE = join(ROOT, '.runtime', 'context-truncator.log');

// Default config
const DEFAULT_CONFIG = {
  maxTurns: 10,
  maxTokens: 8000,
  minTurns: 3,
  summaryThreshold: 15, // Start summarizing if >15 turns
  compressionRatio: 0.3, // Compress older turns to 30% of original
  preserveSystemMessages: true,
  preserveFirstUserMessage: true, // Keep original user request
};

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  timestamp?: string;
}

interface TruncationResult {
  originalCount: number;
  truncatedCount: number;
  originalTokens: number;
  estimatedTokens: number;
  savedTokens: number;
  summary: string;
  removedIndexes: number[];
}

// Simple tokenizer (rough approximation: 1 token ≈ 4 chars for English/Spanish)
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(join(ROOT, '.runtime'), { recursive: true });
    const fs = require('fs');
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch {
    /* non-fatal */
  }
}

/**
 * Summarize older messages into a compact summary
 */
function summarizeMessages(messages: Message[]): string {
  const userMsgs = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content.substring(0, 100) + (m.content.length > 100 ? '...' : ''));
  const assistantSummary = messages
    .filter((m) => m.role === 'assistant' && m.content)
    .map((m) => {
      const content = m.content || '';
      if (content.includes('[Tool Call]')) return '[Used tools]';
      return content.substring(0, 80) + (content.length > 80 ? '...' : '');
    })
    .slice(0, 3);

  return (
    `[Context: ${messages.length} previous messages summarized]\n` +
    `User requests: ${userMsgs.slice(0, 3).join(' | ') || 'N/A'}\n` +
    `Assistant actions: ${assistantSummary.join(' | ') || 'N/A'}`
  );
}

/**
 * Truncate conversation history using sliding window + summarization
 */
export function truncateHistory(
  messages: Message[],
  config: Partial<typeof DEFAULT_CONFIG> = {},
): TruncationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const originalCount = messages.length;
  const originalTokens = messages.reduce((acc, m) => acc + estimateTokens(m.content || ''), 0);

  // Identify critical messages that must be preserved
  const criticalIndexes: number[] = [];

  messages.forEach((m, i) => {
    if (cfg.preserveSystemMessages && m.role === 'system') {
      criticalIndexes.push(i);
    }
    if (
      cfg.preserveFirstUserMessage &&
      m.role === 'user' &&
      criticalIndexes.filter((j) => messages[j]?.role === 'user').length === 0
    ) {
      criticalIndexes.push(i);
    }
  });

  // Always keep last N turns
  const recentStartIndex = Math.max(0, messages.length - cfg.maxTurns);

  // If under limits, no truncation needed
  if (messages.length <= cfg.maxTurns && originalTokens <= cfg.maxTokens) {
    return {
      originalCount,
      truncatedCount: originalCount,
      originalTokens,
      estimatedTokens: originalTokens,
      savedTokens: 0,
      summary: '',
      removedIndexes: [],
    };
  }

  // If way over threshold, summarize the middle section
  const resultMessages: Message[] = [];
  const removedIndexes: number[] = [];

  // Keep critical messages first
  const criticalMessages = criticalIndexes
    .filter((i) => i < recentStartIndex)
    .map((i) => messages[i]);
  resultMessages.push(...criticalMessages);

  // Find middle section to summarize
  const middleStart = Math.max(
    criticalIndexes.length > 0 ? Math.max(...criticalIndexes) + 1 : 0,
    cfg.minTurns,
  );
  const middleEnd = Math.max(recentStartIndex, middleStart + 1);

  if (middleEnd > middleStart && messages.length > cfg.summaryThreshold) {
    const middleMessages = messages.slice(middleStart, middleEnd);
    const summary = summarizeMessages(middleMessages);
    resultMessages.push({
      role: 'system',
      content: summary,
      timestamp: new Date().toISOString(),
    });
    for (let i = middleStart; i < middleEnd; i++) removedIndexes.push(i);
  }

  // Add recent messages
  const recentMessages = messages.slice(recentStartIndex);
  resultMessages.push(...recentMessages);

  const estimatedTokens = resultMessages.reduce(
    (acc, m) => acc + estimateTokens(m.content || ''),
    0,
  );

  return {
    originalCount,
    truncatedCount: resultMessages.length,
    originalTokens,
    estimatedTokens,
    savedTokens: originalTokens - estimatedTokens,
    summary: resultMessages.length > criticalMessages.length ? '[Summarized context applied]' : '',
    removedIndexes,
    truncatedMessages: resultMessages, // Internal use
  } as TruncationResult;
}

/**
 * Read current session messages from state
 */
function readCurrentSession(): { sessionId: string; messages: Message[] } | null {
  try {
    const entries = readdirSync(STATE_DIR, { withFileTypes: true });
    const sessions = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();

    if (sessions.length === 0) return null;

    const latestSession = sessions[0];
    const statePath = join(STATE_DIR, latestSession, '.state.json');

    if (!existsSync(statePath)) return null;

    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    return {
      sessionId: latestSession,
      messages: state.messages || [],
    };
  } catch (e) {
    log(`Error reading session: ${e}`);
    return null;
  }
}

/**
 * Get current context size without truncating
 */
function getContextInfo(): void {
  const session = readCurrentSession();
  if (!session) {
    console.log('No active session found');
    return;
  }

  const messages = session.messages;
  const tokens = messages.reduce((acc, m) => acc + estimateTokens(m.content || ''), 0);

  console.log(`\n=== Context Info: ${session.sessionId} ===`);
  console.log(`Messages: ${messages.length}`);
  console.log(`Estimated tokens: ${tokens.toLocaleString()}`);
  console.log(`Config max turns: ${DEFAULT_CONFIG.maxTurns}`);
  console.log(`Config max tokens: ${DEFAULT_CONFIG.maxTokens.toLocaleString()}`);

  if (messages.length > DEFAULT_CONFIG.maxTurns) {
    console.log(`⚠️ WARNING: ${messages.length - DEFAULT_CONFIG.maxTurns} turns over limit`);
  }
  if (tokens > DEFAULT_CONFIG.maxTokens) {
    console.log(
      `⚠️ WARNING: ${(tokens - DEFAULT_CONFIG.maxTokens).toLocaleString()} tokens over limit`,
    );
  }
}

/**
 * Monitor and auto-truncate if needed
 */
function monitorAndTruncate(): void {
  const session = readCurrentSession();
  if (!session) {
    log('No session to monitor');
    return;
  }

  const result = truncateHistory(session.messages);

  if (result.savedTokens > 0) {
    log(
      `[${session.sessionId}] Truncated ${result.originalCount} → ${result.truncatedCount} messages`,
    );
    log(
      `Saved ~${result.savedTokens.toLocaleString()} tokens (${((result.savedTokens / result.originalTokens) * 100).toFixed(1)}%)`,
    );
  } else {
    log(
      `[${session.sessionId}] Context within limits: ${result.originalTokens.toLocaleString()} tokens`,
    );
  }
}

// CLI
function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Context Truncator — Sliding Window for Conversation History

Usage:
  npx tsx src/tools/context-truncator.ts --info          # Show current context size
  npx tsx src/tools/context-truncator.ts --monitor       # Monitor and auto-truncate
  npx tsx src/tools/context-truncator.ts --config          # Show default config

Config (DEFAULT):
  maxTurns: ${DEFAULT_CONFIG.maxTurns}
  maxTokens: ${DEFAULT_CONFIG.maxTokens.toLocaleString()}
  minTurns: ${DEFAULT_CONFIG.minTurns}
  summaryThreshold: ${DEFAULT_CONFIG.summaryThreshold}
`);
    return;
  }

  if (args.includes('--info')) {
    getContextInfo();
    return;
  }

  if (args.includes('--monitor')) {
    monitorAndTruncate();
    return;
  }

  if (args.includes('--config')) {
    console.log('Default config:\n' + JSON.stringify(DEFAULT_CONFIG, null, 2));
    return;
  }

  // Default: show info
  getContextInfo();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { DEFAULT_CONFIG };
