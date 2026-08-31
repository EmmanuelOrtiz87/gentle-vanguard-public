#!/usr/bin/env node
/**
 * Orchestrator Loop Guard — native anti-loop protection for Gentle-Vanguard
 *
 * WHY: The orchestrator (and any agent) can enter a degenerative planning loop:
 *      repeating the same intent text ("déjame verificar X") without emitting
 *      a tool call, or repeating identical tool calls whose output never changes.
 *      This was observed in F2.3 sessions (2026-08-31): 30+ identical intent lines
 *      without state change.
 *
 * WHAT: A pure, stateful guard that tracks the last N actions and detects:
 *   1. intent-loop     — same normalized intent ≥3 times consecutively
 *   2. tool-loop       — same tool+args fingerprint ≥3 times
 *   3. ping-pong       — A-B-A-B alternation (2 distinct states)
 *   4. stalled-progress — N steps without file/write/commit/check side-effect
 *
 * USAGE:
 *   const guard = new OrchestratorLoopGuard();
 *   guard.recordIntent("verificar version-sync.ts");
 *   const v = guard.shouldBreak(); // { break: false }
 *   guard.recordToolCall("default.read", JSON.stringify({filePath: "src/tools/version-sync.ts"}));
 *   // If break:true, orchestrator must: 1) emit a different tool, 2) ask clarification, or 3) abort.
 *
 * INTEGRATION:
 *   - Wired into session-autostart as a soft check (log WARN, no abort).
 *   - Wired into watchtower component `orchestrator-loop-guard` (health check: file present + tests green).
 *   - Future: orchestrator main loop can instantiate and check before each turn.
 *
 * TEST: tests/unit/orchestrator-loop-guard.test.ts
 */

import { pathToFileURL } from 'url';

export interface GuardOptions {
  /** consecutive identical intents to trigger break (default 3) */
  intentThreshold: number;
  /** consecutive identical tool fingerprints to trigger break (default 3) */
  toolThreshold: number;
  /** steps without side-effect to trigger stalled (default 8) */
  stalledThreshold: number;
  /** history window */
  historySize: number;
}

export const DEFAULT_GUARD_OPTIONS: GuardOptions = {
  intentThreshold: 3,
  toolThreshold: 3,
  stalledThreshold: 8,
  historySize: 20,
};

export type GuardVerdict =
  | { break: false }
  | {
      break: true;
      kind: 'intent-loop' | 'tool-loop' | 'ping-pong' | 'stalled-progress';
      reason: string;
      action: string;
    };

function normalizeIntent(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
}

function fingerprintTool(tool: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson);
    // stable fingerprint: tool + sorted keys + first 60 chars of values
    const keys = Object.keys(args).sort().join(',');
    const vals = Object.values(args)
      .map((v) => String(v).slice(0, 60))
      .join('|');
    return `${tool}::${keys}::${vals.slice(0, 120)}`;
  } catch {
    return `${tool}::${argsJson.slice(0, 120)}`;
  }
}

export class OrchestratorLoopGuard {
  private intents: string[] = [];
  private tools: string[] = [];
  private stepsSinceEffect = 0;
  private readonly opts: GuardOptions;

  constructor(opts: Partial<GuardOptions> = {}) {
    this.opts = { ...DEFAULT_GUARD_OPTIONS, ...opts };
  }

  /** Record an intent line (the text the agent says before acting). */
  recordIntent(raw: string): void {
    const norm = normalizeIntent(raw);
    if (!norm) return;
    this.intents.push(norm);
    if (this.intents.length > this.opts.historySize) this.intents.shift();
    this.stepsSinceEffect += 1;
  }

  /** Record a tool call. Call this when a tool is actually emitted. */
  recordToolCall(tool: string, argsJson: string): void {
    const fp = fingerprintTool(tool, argsJson);
    this.tools.push(fp);
    if (this.tools.length > this.opts.historySize) this.tools.shift();
    // Heuristic: these tools are side-effects that indicate progress
    const isEffect = /write|edit|bash|commit|push|publish/.test(tool);
    if (isEffect) this.stepsSinceEffect = 0;
    else this.stepsSinceEffect += 1;
  }

  /** Record that a side-effect happened (file changed, check passed). */
  recordEffect(): void {
    this.stepsSinceEffect = 0;
  }

  shouldBreak(): GuardVerdict {
    // 1. intent-loop
    if (this.intents.length >= this.opts.intentThreshold) {
      const tail = this.intents.slice(-this.opts.intentThreshold);
      if (tail.every((v) => v === tail[0])) {
        return {
          break: true,
          kind: 'intent-loop',
          reason: `intent-loop: "${tail[0].slice(0, 60)}" repeated ${this.opts.intentThreshold}x without tool execution`,
          action:
            'Emit a tool call immediately or ask for clarification — do not generate more intent text.',
        };
      }
    }

    // 2. tool-loop
    if (this.tools.length >= this.opts.toolThreshold) {
      const tail = this.tools.slice(-this.opts.toolThreshold);
      if (tail.every((v) => v === tail[0])) {
        return {
          break: true,
          kind: 'tool-loop',
          reason: `tool-loop: ${tail[0].slice(0, 80)} repeated ${this.opts.toolThreshold}x with identical output`,
          action:
            'Change arguments, read a different file, or escalate — retrying same tool will not progress.',
        };
      }
    }

    // 3. ping-pong A B A B
    if (this.tools.length >= 4) {
      const t = this.tools.slice(-4);
      if (t[0] === t[2] && t[1] === t[3] && t[0] !== t[1]) {
        return {
          break: true,
          kind: 'ping-pong',
          reason: `ping-pong: alternating ${t[0].slice(0, 40)} <-> ${t[1].slice(0, 40)}`,
          action: 'Break the cycle: consolidate into a single tool call or request human decision.',
        };
      }
    }
    if (this.intents.length >= 4) {
      const t = this.intents.slice(-4);
      if (t[0] === t[2] && t[1] === t[3] && t[0] !== t[1]) {
        return {
          break: true,
          kind: 'ping-pong',
          reason: `ping-pong intent: "${t[0].slice(0, 40)}" <-> "${t[1].slice(0, 40)}"`,
          action: 'Stop alternating intents — execute a tool or ask clarification.',
        };
      }
    }

    // 4. stalled-progress
    if (this.stepsSinceEffect >= this.opts.stalledThreshold) {
      return {
        break: true,
        kind: 'stalled-progress',
        reason: `stalled-progress: ${this.stepsSinceEffect} steps without side-effect (write/edit/bash/commit)`,
        action:
          'Force a side-effect: run a check, write a file, or report status and ask next step.',
      };
    }

    return { break: false };
  }

  /** For diagnostics / watchtower */
  snapshot(): { intents: string[]; tools: string[]; stepsSinceEffect: number } {
    return {
      intents: [...this.intents],
      tools: [...this.tools],
      stepsSinceEffect: this.stepsSinceEffect,
    };
  }

  reset(): void {
    this.intents = [];
    this.tools = [];
    this.stepsSinceEffect = 0;
  }
}

// CLI for manual testing
function main(): void {
  const guard = new OrchestratorLoopGuard();
  // Simulate the observed loop
  for (let i = 0; i < 3; i++) guard.recordIntent('Déjame verificar que el codemod compila');
  const v = guard.shouldBreak();
  console.log(JSON.stringify(v, null, 2));
  if (v.break) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { normalizeIntent, fingerprintTool };
