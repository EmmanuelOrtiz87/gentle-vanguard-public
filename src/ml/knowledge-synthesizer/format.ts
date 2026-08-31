import type { KnowledgeConcept, SynthOutput } from './types.js';

export function formatJson(output: SynthOutput): string {
  return JSON.stringify(output, null, 2);
}

export function formatMarkdown(output: SynthOutput): string {
  const lines: string[] = [];
  lines.push(`# Knowledge Synthesis Report`);
  lines.push(``);
  lines.push(`**Generated**: ${output.timestamp}`);
  lines.push(`**Sessions analyzed**: ${output.sessionCount}`);
  lines.push(`**Date range**: ${output.dateRange.from} → ${output.dateRange.to}`);
  lines.push(`**Quality score**: ${output.qualityScore}/100`);
  lines.push(``);

  lines.push(
    `## Knowledge Map (${output.concepts.length} concepts, ${output.relationships.length} relationships)`,
  );
  lines.push(``);
  const byCategory = new Map<string, KnowledgeConcept[]>();
  for (const c of output.concepts) {
    const cat = c.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    const catArr = byCategory.get(cat);
    if (catArr) catArr.push(c);
  }
  for (const [cat, items] of byCategory) {
    lines.push(`### ${cat}`);
    for (const c of items.sort((a, b) => b.frequency - a.frequency).slice(0, 10)) {
      lines.push(`- **${c.name}** — ${c.frequency}x, conf: ${c.confidence}`);
    }
    lines.push(``);
  }

  if (output.trends.length > 0) {
    lines.push(`## Trends (${output.trends.length})`);
    lines.push(``);
    for (const t of output.trends) {
      const icon =
        { growing: '📈', declining: '📉', stable: '➡️', sporadic: '🔄' }[t.trajectory] || '❓';
      lines.push(
        `- ${icon} **${t.concept}** — ${t.trajectory}, accel: ${t.acceleration.toFixed(3)}`,
      );
      lines.push(`  - ${t.recommendation}`);
    }
    lines.push(``);
  }

  if (output.gaps.length > 0) {
    lines.push(`## Gaps (${output.gaps.length})`);
    lines.push(``);
    for (const g of output.gaps) {
      const icon = { high: '🔴', medium: '🟡', low: '🟢' }[g.priority] || '⚪';
      lines.push(`- ${icon} **${g.area}** (${g.priority})`);
      lines.push(`  - ${g.description}`);
      lines.push(`  - Suggested: ${g.suggestedSource}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`_Knowledge Synthesizer v1.0.0_`);
  return lines.join('\n');
}
