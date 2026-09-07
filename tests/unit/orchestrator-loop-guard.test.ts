import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorLoopGuard } from '../../src/core/orchestrator-loop-guard.js';

describe('OrchestratorLoopGuard', () => {
  it('detects intent-loop after 3 identical intents', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 99 });
    g.recordIntent('Déjame verificar que el codemod compila');
    g.recordIntent('Déjame verificar que el codemod compila');
    assert.equal(g.shouldBreak().break, false);
    g.recordIntent('Déjame verificar que el codemod compila');
    const v = g.shouldBreak();
    assert.equal(v.break, true);
    if (v.break) assert.equal(v.kind, 'intent-loop');
  });

  it('detects tool-loop after 3 identical tool calls', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 99 });
    const args = JSON.stringify({ filePath: 'src/tools/version-sync.ts' });
    g.recordToolCall('default.read', args);
    g.recordToolCall('default.read', args);
    g.recordToolCall('default.read', args);
    const v = g.shouldBreak();
    assert.equal(v.break, true);
    if (v.break) assert.equal(v.kind, 'tool-loop');
  });

  it('detects ping-pong alternation', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 99 });
    g.recordToolCall('a', JSON.stringify({ x: 1 }));
    g.recordToolCall('b', JSON.stringify({ x: 2 }));
    g.recordToolCall('a', JSON.stringify({ x: 1 }));
    g.recordToolCall('b', JSON.stringify({ x: 2 }));
    const v = g.shouldBreak();
    assert.equal(v.break, true);
    if (v.break) assert.equal(v.kind, 'ping-pong');
  });

  it('detects stalled-progress without side-effect', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 3 });
    g.recordIntent('a');
    g.recordIntent('b');
    g.recordIntent('c');
    const v = g.shouldBreak();
    assert.equal(v.break, true);
    if (v.break) assert.equal(v.kind, 'stalled-progress');
  });

  it('resets on effect', () => {
    const g = new OrchestratorLoopGuard({ stalledThreshold: 3 });
    g.recordIntent('a');
    g.recordIntent('b');
    g.recordEffect();
    assert.equal(g.shouldBreak().break, false);
  });
});
