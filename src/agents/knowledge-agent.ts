#!/usr/bin/env node
/**
 * KNOWLEDGE Agent (knowledge-agent) - Native Implementation
 *
 * Knowledge keeper — organizational memory, knowledge base operations,
 * note creation, vault sync. Executor logic mirrors config/agent-prompts/KNOWLEDGE.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'knowledge-agent',
  description: 'Knowledge agent — knowledge base operations and memory management',
  promptFile: 'KNOWLEDGE',
  domain: 'knowledge',
  version: '1.0.0',
  temperature: 0.3,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent =
      normalized.includes('adr') || normalized.includes('decision')
        ? 'ADR_NOTE'
        : normalized.includes('bug') || normalized.includes('root cause')
          ? 'BUGFIX_NOTE'
          : normalized.includes('pattern') || normalized.includes('snippet')
            ? 'PATTERN_NOTE'
            : normalized.includes('session') || normalized.includes('summary')
              ? 'SESSION_NOTE'
              : normalized.includes('howto') ||
                  normalized.includes('guide') ||
                  normalized.includes('sop')
                ? 'HOWTO'
                : normalized.includes('sync') || normalized.includes('vault')
                  ? 'VAULT_SYNC'
                  : normalized.includes('search') || normalized.includes('retriev')
                    ? 'SEARCH'
                    : 'GENERAL';

    const session = context?.match(/session:?\s*([^\n,]+)/i)?.[1]?.trim() || 'session-current';
    const related = context?.match(/related:?\s*([^\n,]+)/i)?.[1]?.trim() || '';

    const analysis: Record<string, unknown> = {
      task,
      intent,
      kbStructure: {
        '01-decisions': 'ADRs and design decisions',
        '02-discoveries': 'Technical findings',
        '03-patterns': 'Reusable patterns',
        '04-sessions': 'Session summaries',
        '05-how-to': 'Guides and SOPs',
        '06-references': 'External resources',
      },
      tagging: {
        '#decision': 'Architecture/business decision',
        '#bugfix': 'Root cause analysis',
        '#pattern': 'Reusable code pattern',
        '#discovery': 'Technical learning',
        '#howto': 'Process documentation',
        '#session': 'Session notes',
      },
      criticalRules: [
        'Link everything — notes must reference files, commits, or sessions',
        'Tag appropriately — standardized tags for discoverability',
        'Sync bidirectionally — vault ↔ project must stay aligned',
        'Preserve context — capture why, not just what',
        'Make it searchable — structure for retrieval',
      ],
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const checklist = [
      'Note linked to files/commits/sessions',
      'Standardized tags applied',
      'Context preserved (why, not just what)',
      'Searchable structure',
      'Never delete notes without archiving',
      'Edit history preserved',
      'Sync before session close',
    ];

    const flags: DomainOutput['flags'] = [
      {
        severity: 'info',
        message:
          'Search strategy: tags first (broad) → title keywords (focused) → content (deep) → related links (associative)',
      },
    ];

    const dateStr = new Date().toISOString().slice(0, 10);
    const noteType = intent.replace(/_/g, ' ').toLowerCase();
    const artifacts = [
      {
        name: 'knowledge-note',
        content: `---\ntitle: ${task.slice(0, 60)}\ncreated: ${dateStr}\ntags: [${intent === 'ADR_NOTE' ? '#decision' : intent === 'BUGFIX_NOTE' ? '#bugfix' : intent === 'PATTERN_NOTE' ? '#pattern' : intent === 'SESSION_NOTE' ? '#session' : intent === 'HOWTO' ? '#howto' : '#discovery'}]\nsession: ${session}\nrelated: [${related}]\n---\n\n# ${task}\n\n## Context\n\n## Detail\n\n## Decision/Irreversibility\n\n## Next Steps\n\n## References\n\n- File: \`path/to/file.ts:line\`\n- Commit: \`abc123\`\n- Session: \`${session}\`\n`,
      },
    ];

    return {
      summary: `${noteType} note prepared (${intent}) in knowledge-base structure, session ${session}.`,
      analysis,
      checklist,
      artifacts,
      evidence: ['KNOWLEDGE.md domain prompt loaded', 'Note template + tagging convention applied'],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
