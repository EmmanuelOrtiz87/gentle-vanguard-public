#!/usr/bin/env node
/**
 * Loop Guard Service - Persisted loop detection for session-based workflows
 *
 * This service provides a persistent loop guard that survives across turns
 * within the same session. It integrates with OrchestratorLoopGuard and
 * persists state to session-current.json.
 *
 * Usage:
 *   npx tsx src/core/loop-guard-service.ts record-intent "my intent"
 *   npx tsx src/core/loop-guard-service.ts record-tool "read" '{"filePath": "foo.ts"}'
 *   npx tsx src/core/loop-guard-service.ts check
 *   npx tsx src/core/loop-guard-service.ts snapshot
 *   npx tsx src/core/loop-guard-service.ts reset
 *
 * Integration in workflows:
 *   import { LoopGuardService } from './loop-guard-service.js';
 *   const guard = new LoopGuardService(sessionDir);
 *   guard.recordIntent('my intent text');
 *   guard.recordToolCall('read', '{"filePath": "foo.ts"}');
 *   const verdict = guard.shouldBreak();
 *   if (verdict.break) {
 *     // handle loop detection
 *     console.log('Loop detected:', verdict.kind);
 *   }
 * @example
 *   // Basic usage
 *   const guard = new LoopGuardService();
 *   guard.recordIntent('analyze requirements');
 *   guard.recordToolCall('read', '{"filePath": "src/main.ts"}');
 *   const verdict = guard.shouldBreak();
 *   if (verdict.break) {
 *     console.log('Loop detected:', verdict.kind);
 *   }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { OrchestratorLoopGuard, type GuardVerdict } from './orchestrator-loop-guard.js';

const ROOT = resolve(process.cwd());
const SESSION_DIR = join(ROOT, '.session');
const LOOP_GUARD_STATE_FILE = join(SESSION_DIR, 'loop-guard-state.json');

export interface LoopGuardState {
  intents: string[];
  tools: string[];
  stepsSinceEffect: number;
  lastCheck: string;
  breakCount: number;
}

/**
 * Loop Guard Service with session persistence
 */
export class LoopGuardService {
  private guard: OrchestratorLoopGuard;
  private state: LoopGuardState;
  private sessionDir: string;

  constructor(sessionDir: string = SESSION_DIR) {
    this.sessionDir = sessionDir;
    this.guard = new OrchestratorLoopGuard();
    this.state = this.loadState();
    this.restoreFromState();
  }

  /**
   * Load state from session file
   */
  private loadState(): LoopGuardState {
    const defaultState: LoopGuardState = {
      intents: [],
      tools: [],
      stepsSinceEffect: 0,
      lastCheck: new Date().toISOString(),
      breakCount: 0,
    };

    if (!existsSync(LOOP_GUARD_STATE_FILE)) {
      return defaultState;
    }

    try {
      const content = readFileSync(LOOP_GUARD_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      return { ...defaultState, ...parsed };
    } catch {
      return defaultState;
    }
  }

  /**
   * Restore guard state from persisted state
   */
  private restoreFromState(): void {
    // Record intents
    for (const intent of this.state.intents) {
      this.guard.recordIntent(intent);
    }
    // Record tools (we can't fully restore, but we track stepsSinceEffect)
    for (const tool of this.state.tools) {
      // Reconstruct from fingerprint: "tool::key,key::val|val"
      const parts = tool.split('::');
      if (parts.length >= 1) {
        const toolName = parts[0];
        const argsJson = parts.slice(2).join('::') || '{}';
        this.guard.recordToolCall(toolName, argsJson);
      }
    }
    // Restore stepsSinceEffect by calling recordEffect N times
    for (let i = 0; i < this.state.stepsSinceEffect; i++) {
      // Can't directly set, but we can simulate by NOT calling recordEffect
      // The guard will increment on each recordIntent/recordToolCall
    }
    // Manual restore for stepsSinceEffect (private property hack for reset)
    (this.guard as any).stepsSinceEffect = this.state.stepsSinceEffect;
  }

  /**
   * Save state to session file
   */
  private saveState(): void {
    const snapshot = this.guard.snapshot();
    this.state = {
      intents: snapshot.intents,
      tools: snapshot.tools,
      stepsSinceEffect: snapshot.stepsSinceEffect,
      lastCheck: new Date().toISOString(),
      breakCount: this.state.breakCount,
    };
    mkdirSync(this.sessionDir, { recursive: true });
    writeFileSync(LOOP_GUARD_STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  /**
   * Record an intent (user/agent message before action)
   */
  recordIntent(intent: string): void {
    this.guard.recordIntent(intent);
    this.saveState();
  }

  /**
   * Record a tool call
   */
  recordToolCall(tool: string, argsJson: string): void {
    this.guard.recordToolCall(tool, argsJson);
    this.saveState();
  }

  /**
   * Record that a side-effect happened (progress made)
   */
  recordEffect(): void {
    this.guard.recordEffect();
    this.saveState();
  }

  /**
   * Check if we should break the loop
   */
  shouldBreak(): GuardVerdict {
    const verdict = this.guard.shouldBreak();
    if (verdict.break) {
      this.state.breakCount++;
      this.saveState();
    }
    return verdict;
  }

  /**
   * Get current snapshot for diagnostics
   */
  snapshot(): LoopGuardState & { guard: ReturnType<OrchestratorLoopGuard['snapshot']> } {
    return {
      ...this.state,
      guard: this.guard.snapshot(),
    };
  }

  /**
   * Reset the guard state
   */
  reset(): void {
    this.guard.reset();
    this.state = {
      intents: [],
      tools: [],
      stepsSinceEffect: 0,
      lastCheck: new Date().toISOString(),
      breakCount: 0,
    };
    this.saveState();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalBreaks: number;
    intentCount: number;
    toolCount: number;
    stepsStalled: number;
  } {
    return {
      totalBreaks: this.state.breakCount,
      intentCount: this.state.intents.length,
      toolCount: this.state.tools.length,
      stepsStalled: this.state.stepsSinceEffect,
    };
  }
}

// CLI
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const service = new LoopGuardService();

  if (command === 'record-intent') {
    const intent = args.slice(1).join(' ');
    service.recordIntent(intent);
    console.log(`[LOOP-GUARD] Intent recorded: "${intent.slice(0, 50)}..."`);
  } else if (command === 'record-tool') {
    const tool = args[1];
    const argsJson = args.slice(2).join(' ');
    service.recordToolCall(tool, argsJson);
    console.log(`[LOOP-GUARD] Tool recorded: ${tool}`);
  } else if (command === 'record-effect') {
    service.recordEffect();
    console.log(`[LOOP-GUARD] Effect recorded`);
  } else if (command === 'check') {
    const verdict = service.shouldBreak();
    console.log(JSON.stringify(verdict, null, 2));
    if (verdict.break) {
      console.error(`[LOOP-GUARD] LOOP DETECTED: ${verdict.kind}`);
      process.exit(1);
    }
  } else if (command === 'snapshot') {
    console.log(JSON.stringify(service.snapshot(), null, 2));
  } else if (command === 'stats') {
    console.log(JSON.stringify(service.getStats(), null, 2));
  } else if (command === 'reset') {
    service.reset();
    console.log('[LOOP-GUARD] State reset');
  } else {
    console.log('Loop Guard Service');
    console.log('');
    console.log('Commands:');
    console.log('  record-intent <text>  - Record an intent message');
    console.log('  record-tool <tool> <argsJson> - Record a tool call');
    console.log('  record-effect        - Record progress (side-effect)');
    console.log('  check                - Check if loop detected');
    console.log('  snapshot             - Get current state');
    console.log('  stats                - Get statistics');
    console.log('  reset                - Reset state');
    console.log('');
    console.log('Integration:');
    console.log('  import { LoopGuardService } from "./loop-guard-service.js"');
    console.log('  const guard = new LoopGuardService()');
    console.log('  guard.recordIntent("my intent")');
    console.log('  guard.recordToolCall("read", \'{"filePath": "foo.ts"}\')');
    console.log('  const v = guard.shouldBreak()');
  }
}

// Run CLI if executed directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
