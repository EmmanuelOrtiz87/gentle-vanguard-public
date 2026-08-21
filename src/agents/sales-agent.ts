#!/usr/bin/env node
/**
 * SALES Agent (sales-agent) - Native Implementation
 *
 * Sales strategist — opportunity qualification (MEDDIC) and deal structuring.
 * Executor logic mirrors config/agent-prompts/SALES.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'sales-agent',
  description: 'Sales agent — MEDDIC qualification, pipeline, and deal structure',
  promptFile: 'SALES',
  domain: 'sales',
  version: '1.0.0',
  temperature: 0.4,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent = normalized.includes('qualif')
      ? 'QUALIFY'
      : normalized.includes('pipeline') || normalized.includes('forecast')
        ? 'PIPELINE'
        : normalized.includes('outreach') || normalized.includes('email')
          ? 'OUTREACH'
          : normalized.includes('account') || normalized.includes('plan')
            ? 'ACCOUNT_PLAN'
            : normalized.includes('deal') || normalized.includes('review')
              ? 'DEAL_REVIEW'
              : 'GENERAL';

    // Extract optional MEDDIC context hints: metric, buyer, champion, pain
    const extract = (label: string): string =>
      context?.match(new RegExp(`${label}:?\\s*([^\\n,]+)`, 'i'))?.[1]?.trim() ||
      'Not captured — required';

    const meddic = {
      Metrics: extract('metric'),
      EconomicBuyer: extract('buyer'),
      DecisionCriteria: extract('criteria'),
      DecisionProcess: extract('process'),
      IdentifyPain: extract('pain'),
      Champion: extract('champion'),
    };

    const analysis: Record<string, unknown> = {
      task,
      intent,
      meddic,
      pipelineStages: [
        '1. Prospect — Identified, not contacted',
        '2. Contacted — Outreach sent',
        '3. Qualified — MEDDIC complete',
        '4. Proposal — Formal offer presented',
        '5. Negotiation — Terms discussion',
        '6. Closed-Won — Contract signed',
        '7. Closed-Lost — Lost to competitor/no decision',
      ],
      forecastCategories: {
        Commit: { probability: '90%', criteria: 'Paperwork signed, verbal confirmation' },
        BestCase: { probability: '50%', criteria: 'MEDDIC complete, proposal sent' },
        Pipeline: { probability: '25%', criteria: 'Qualified opportunity, next steps set' },
        Upside: { probability: '10%', criteria: 'Early stage, interest shown' },
      },
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const incomplete = Object.entries(meddic)
      .filter(([, v]) => v === 'Not captured — required')
      .map(([k]) => k);

    const checklist = [
      'MEDDIC qualification documented',
      'Champion identified and engaged',
      'Economic buyer contacted',
      'Decision criteria documented',
      'Next action defined with date',
      'Multi-threaded (never single-threaded deals)',
      'Compelling event with date identified',
    ];

    const flags: DomainOutput['flags'] = [];
    if (incomplete.length > 0) {
      flags.push({
        severity: incomplete.length >= 3 ? 'critical' : 'warn',
        message: `MEDDIC incomplete: missing ${incomplete.join(', ')}. Qualify first — no unqualified meetings.`,
      });
    }

    const artifacts = [
      {
        name: 'deal-qualification',
        content:
          `# Deal Qualification — ${intent}\n\n` +
          `**Task:** ${task}\n\n` +
          `## MEDDIC\n\n` +
          Object.entries(meddic)
            .map(([k, v]) => `- **${k}:** ${v}`)
            .join('\n') +
          '\n\n' +
          `## Required Evidence\n\n` +
          `- MEDDIC qualification documented\n- Champion identified and engaged\n- Economic buyer contacted\n- Decision criteria documented\n- Next action defined with date\n`,
      },
    ];

    return {
      summary: `${intent.replace(/_/g, ' ')} analysis with MEDDIC ${incomplete.length === 0 ? 'complete' : `incomplete (${incomplete.length} gaps: ${incomplete.join(', ')})`}.`,
      analysis,
      checklist,
      artifacts,
      evidence: ['SALES.md domain prompt loaded', 'MEDDIC framework applied'],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
