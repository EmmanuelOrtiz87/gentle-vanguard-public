import { describe, it, expect } from 'vitest';
import { OrchestratorLoopGuard } from '../../src/core/orchestrator-loop-guard.js';

describe('OrchestratorLoopGuard', () => {
  it('detects intent-loop after 3 identical intents', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 99 });
    g.recordIntent('Déjame verificar que el codemod compila');
    g.recordIntent('Déjame verificar que el codemod compila');
    expect(g.shouldBreak().break).toBe(false);
    g.recordIntent('Déjame verificar que el codemod compila');
    const v = g.shouldBreak();
    expect(v.break).toBe(true);
    if (v.break) expect(v.kind).toBe('intent-loop');
  });

  it('detects tool-loop after 3 identical tool calls', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 99 });
    const args = JSON.stringify({ filePath: 'src/tools/version-sync.ts' });
    g.recordToolCall('default.read', args);
    g.recordToolCall('default.read', args);
    g.recordToolCall('default.read', args);
    const v = g.shouldBreak();
    expect(v.break).toBe(true);
    if (v.break) expect(v.kind).toBe('tool-loop');
  });

  it('detects ping-pong alternation', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 99 });
    g.recordToolCall('a', JSON.stringify({ x: 1 }));
    g.recordToolCall('b', JSON.stringify({ x: 2 }));
    g.recordToolCall('a', JSON.stringify({ x: 1 }));
    g.recordToolCall('b', JSON.stringify({ x: 2 }));
    const v = g.shouldBreak();
    expect(v.break).toBe(true);
    if (v.break) expect(v.kind).toBe('ping-pong');
  });

  it('detects stalled-progress without side-effect', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 3 });
    g.recordIntent('a');
    g.recordIntent('b');
    g.recordIntent('c');
    const v = g.shouldBreak();
    expect(v.break).toBe(true);
    if (v.break) expect(v.kind).toBe('stalled-progress');
  });

  it('resets on effect', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 3 });
    g.recordIntent('a');
    g.recordIntent('b');
    g.recordEffect();
    expect(g.shouldBreak().break).toBe(false);
  });
});
