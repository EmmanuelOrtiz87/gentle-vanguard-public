import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const AGENTS = resolve(ROOT, 'AGENTS.md');

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
    const src = readFileSync(AGENTS, 'utf-8');
    const bgIdx = src.indexOf('## background tasks');
    const window = src.slice(bgIdx, bgIdx + 4000);
    assert.ok(window.includes('task_output'), 'must document task_output');
    assert.ok(window.includes('task_stop'), 'must document task_stop');
  });

  it('documenta las 4 capas (agente, helper, watchtower, session-close)', () => {
    const src = readFileSync(AGENTS, 'utf-8');
    const bgIdx = src.indexOf('## background tasks');
    const window = src.slice(bgIdx, bgIdx + 4000);
    assert.ok(window.includes('scripts/utilities/background-tasks.ts'), 'helper CLI path');
    assert.ok(window.includes('checks-bg-tasks.ts'), 'watchtower check path');
    assert.ok(window.includes('session-close'), 'session-close safety net');
  });

  it('warns that the reminder re-fires up to 4 turns', () => {
    const src = readFileSync(AGENTS, 'utf-8');
    const bgIdx = src.indexOf('## background tasks');
    const window = src.slice(bgIdx, bgIdx + 4000);
    assert.ok(
      window.includes('reaparece') || window.includes('ventana fantasma'),
      'must explain the ghost-window phenomenon',
    );
  });
});
