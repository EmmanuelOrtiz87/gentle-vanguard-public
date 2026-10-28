import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const AGENTS = resolve(ROOT, 'AGENTS.md');
// AGENTS.md is the slim daily-injection layer (~120 lines). Since the 2026-10-06
// slim commit (4ae80fc3a) the durable detail of the background-task discipline
// (4 capas + ghost-window warning) lives in the modules manual, and AGENTS.md
// keeps the rule summary plus the explicit pointer. Assert both halves so the
// knowledge cannot silently disappear from either layer.
const MODULES = resolve(ROOT, 'docs', 'stack-manual-modules.md');

function agentsBgSection(): string {
  const src = readFileSync(AGENTS, 'utf-8');
  const bgIdx = src.indexOf('## background tasks');
  assert.ok(bgIdx >= 0, 'AGENTS.md must keep the "## background tasks" section');
  return src.slice(bgIdx, bgIdx + 4000);
}

function modulesBgSection(): string {
  const src = readFileSync(MODULES, 'utf-8');
  const bgIdx = src.indexOf('## background tasks');
  assert.ok(bgIdx >= 0, 'docs/stack-manual-modules.md must own the full bg-tasks section');
  return src.slice(bgIdx, bgIdx + 6000);
}

describe('AGENTS.md BG tasks disciplina', () => {
  it('AGENTS.md exists', () => {
    assert.ok(existsSync(AGENTS));
  });

  it('has a "background tasks — drain discipline" section', () => {
    const src = readFileSync(AGENTS, 'utf-8');
    assert.ok(
      src.includes('## background tasks') && src.includes('drain discipline'),
      'must have the section header',
    );
  });

  it('tabla de decision menciona task_output y task_stop', () => {
    const window = agentsBgSection();
    assert.ok(window.includes('task_output'), 'must document task_output');
    assert.ok(window.includes('task_stop'), 'must document task_stop');
  });

  it('documenta las 4 capas (agente, helper, watchtower, session-close)', () => {
    const agents = agentsBgSection();
    assert.ok(agents.includes('4 capas'), 'AGENTS.md must state there are 4 defense layers');
    assert.ok(
      agents.includes('docs/stack-manual-modules.md'),
      'AGENTS.md must point at the canonical module doc that details the 4 layers',
    );

    const modules = modulesBgSection();
    assert.ok(modules.includes('4 capas'), 'module doc must document the 4 defense layers');
    assert.ok(
      modules.includes('scripts/utilities/background-tasks.ts'),
      'module doc must name the helper CLI path',
    );
    assert.ok(
      modules.includes('checks-bg-tasks.ts'),
      'module doc must name the watchtower check path',
    );
    assert.ok(modules.includes('session-close'), 'module doc must document the session-close net');
  });

  it('warns that the reminder re-fires up to 4 turns', () => {
    const modules = modulesBgSection();
    assert.ok(
      modules.includes('reaparece') || modules.includes('ventana fantasma'),
      'must explain the ghost-window phenomenon',
    );
    assert.match(
      modules,
      /(?:hasta\s+4\s+turnos|4\s+turnos)/i,
      'must warn that the reminder re-fires for up to 4 turns',
    );
  });
});
