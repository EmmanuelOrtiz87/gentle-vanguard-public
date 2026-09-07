import { describe, it, expect } from 'vitest';
import { extractMcpText, parseSkillList, buildSkillListHint } from './agent-command-utils';

describe('agent-command-utils', () => {
  describe('extractMcpText', () => {
    it('extracts text from MCP content blocks', () => {
      const result = {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: ' world' },
        ],
      };
      expect(extractMcpText(result)).toBe('hello\n world');
    });

    it('returns null for non-object input', () => {
      expect(extractMcpText(null)).toBeNull();
      expect(extractMcpText('nope')).toBeNull();
    });

    it('returns null when there is no text content', () => {
      expect(extractMcpText({ content: [{ type: 'image', data: 'x' }] })).toBeNull();
    });
  });

  describe('parseSkillList', () => {
    it('extracts skill names from markdown bullet lines', () => {
      const result = {
        content: [
          {
            type: 'text',
            text: '**Skills**: 2 / 3\n\n| Agent | Skills |\n|-------|--------|\n\n### Skills\n- **my-skill** (_DEV_) — trigger\n- **other-skill** (_QA_) — a, b',
          },
        ],
      };
      expect(parseSkillList(result)).toEqual(['my-skill', 'other-skill']);
    });

    it('returns empty array when no bullet list is present', () => {
      const result = { content: [{ type: 'text', text: 'No skills found' }] };
      expect(parseSkillList(result)).toEqual([]);
    });
  });

  describe('buildSkillListHint', () => {
    it('builds a list UIHint with items and label', () => {
      const hint = buildSkillListHint(['a', 'b'], 'Available');
      expect(hint).toEqual({ type: 'list', label: 'Available', items: ['a', 'b'] });
    });

    it('uses the default label', () => {
      const hint = buildSkillListHint([]);
      expect(hint).toEqual({ type: 'list', label: 'Skills', items: [] });
    });
  });
});
