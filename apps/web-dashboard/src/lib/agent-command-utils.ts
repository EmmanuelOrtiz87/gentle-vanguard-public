import type { UIHint } from '../types/agent';

export function extractMcpText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) return null;
  const texts = r.content
    .filter((c): c is { type: 'text'; text: string } => {
      if (!c || typeof c !== 'object') return false;
      const item = c as Record<string, unknown>;
      return item.type === 'text' && typeof item.text === 'string';
    })
    .map((c) => c.text);
  return texts.length > 0 ? texts.join('\n') : null;
}

export function parseSkillList(result: unknown): string[] {
  const text = extractMcpText(result);
  if (!text) return [];
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*-\s+\*\*([^*]+)\*\*/);
    if (match && match[1]) names.push(match[1].trim());
  }
  return names;
}

export function buildSkillListHint(names: string[], label = 'Skills'): UIHint {
  return { type: 'list', label, items: names };
}
