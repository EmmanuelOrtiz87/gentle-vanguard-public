import { readFileSync } from 'fs';
import type { Logger } from './config.js';
import type { KnowledgeConcept, SynthOutput } from './types.js';

export function extractConceptsFromDigests(digestFiles: string[], log: Logger): KnowledgeConcept[] {
  const concepts: Map<string, KnowledgeConcept> = new Map();
  const conceptPatterns = [
    /## (.+?)(?:\n|$)/g, // markdown headings
    /\*\*(.+?)\*\*/g, // bold text
    /`([a-z-]+)`/gi, // inline code terms
    /([A-Z][a-z]+ [A-Z][a-z]+)/g, // Proper Noun phrases
  ];

  for (const fp of digestFiles) {
    try {
      const content = readFileSync(fp, 'utf-8');
      const date = fp.replace(/.*[\\/](\d{4}-\d{2}-\d{2})\.md$/, '$1');

      for (const pattern of conceptPatterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          const name = match[1].trim();
          if (name.length < 3 || name.length > 60) continue;
          if (/^[0-9\s]+$/.test(name)) continue;

          const id = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          if (!id) continue;

          const existing = concepts.get(id);
          if (existing) {
            existing.frequency++;
            existing.lastSeen = date;
            existing.sources.push(fp);
            if (!existing.relatedConcepts.includes(fp)) {
              // extract nearby concepts as related
            }
          } else {
            concepts.set(id, {
              id,
              name,
              category: 'unknown',
              firstSeen: date,
              lastSeen: date,
              frequency: 1,
              sources: [fp],
              confidence: 0.5,
              relatedConcepts: [],
            });
          }
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  log(`  Extracted ${concepts.size} concepts from digests`);
  return [...concepts.values()].sort((a, b) => b.frequency - a.frequency);
}

export function extractConceptsFromReflections(reflections: SynthOutput[]): KnowledgeConcept[] {
  const concepts: Map<string, KnowledgeConcept> = new Map();

  for (const ref of reflections) {
    const date = ref.timestamp.slice(0, 10);
    for (const p of ref.patterns || []) {
      const id = `pattern:${p.id}`;
      if (!concepts.has(id)) {
        concepts.set(id, {
          id,
          name: p.title,
          category: `pattern:${p.type}`,
          firstSeen: date,
          lastSeen: date,
          frequency: 1,
          sources: [`reflection:${ref.timestamp}`],
          confidence: p.severity === 'critical' ? 0.9 : p.severity === 'warning' ? 0.7 : 0.5,
          relatedConcepts: [],
        });
      } else {
        const c = concepts.get(id);
        if (c) {
          c.frequency++;
          c.lastSeen = date;
          c.sources.push(`reflection:${ref.timestamp}`);
        }
      }
    }

    for (const ins of ref.insights || []) {
      const id = `insight:${ins.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      if (!concepts.has(id)) {
        concepts.set(id, {
          id,
          name: ins.finding,
          category: `insight:${ins.category}`,
          firstSeen: date,
          lastSeen: date,
          frequency: 1,
          sources: [`reflection:${ref.timestamp}`],
          confidence: ins.confidence || 0.5,
          relatedConcepts: [],
        });
      }
    }
  }

  return [...concepts.values()];
}

export function categorizeConcepts(concepts: KnowledgeConcept[]): KnowledgeConcept[] {
  return concepts.map((c) => {
    if (c.category !== 'unknown') return c;

    const name = c.name.toLowerCase();
    if (name.includes('error') || name.includes('bug') || name.includes('fix')) {
      return { ...c, category: 'bugfix', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('config') || name.includes('setting') || name.includes('.json')) {
      return { ...c, category: 'config', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('architect') || name.includes('design') || name.includes('pattern')) {
      return { ...c, category: 'architecture', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('skill') || name.includes('agent') || name.includes('tool')) {
      return { ...c, category: 'skill', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('deploy') || name.includes('pipeline') || name.includes('ci')) {
      return { ...c, category: 'workflow', confidence: Math.min(c.confidence + 0.1, 1) };
    }
    if (name.includes('api') || name.includes('mcp') || name.includes('gateway')) {
      return { ...c, category: 'integration', confidence: Math.min(c.confidence + 0.1, 1) };
    }

    return { ...c, category: 'discovery' };
  });
}
