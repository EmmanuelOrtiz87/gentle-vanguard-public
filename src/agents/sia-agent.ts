#!/usr/bin/env node
/**
 * SIA Agent (sia-agent) - Native Implementation
 *
 * Self-Improving Agent — iterate deliverables with structured feedback and
 * measurable score improvement. Executor logic mirrors config/agent-prompts/SIA.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'sia-agent',
  description: 'SIA agent — self-improvement iteration with measurable scoring',
  promptFile: 'SIA',
  domain: 'sia',
  version: '1.0.0',
  temperature: 0.2,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent =
      normalized.includes('review') || normalized.includes('feedback')
        ? 'REVIEW'
        : normalized.includes('score') || normalized.includes('score')
          ? 'SCORE'
          : normalized.includes('iterate') || normalized.includes('revise')
            ? 'ITERATE'
            : normalized.includes('escalat')
              ? 'ESCALATE'
              : 'SIA_LOOP';

    // Extract iteration info from context if provided
    const currentScore = context?.match(/score:?\s*(\d+)/i)?.[1];
    const iteration = context?.match(/iteration:?\s*(\d+)/i)?.[1];

    const analysis: Record<string, unknown> = {
      task,
      intent,
      currentScore: currentScore ? parseInt(currentScore, 10) : null,
      iteration: iteration ? parseInt(iteration, 10) : null,
      scoringRubric: {
        Completeness: { weight: '30%', target: 'All reqs met' },
        Correctness: { weight: '30%', target: 'No known bugs' },
        Quality: { weight: '20%', target: 'Good structure' },
        Style: { weight: '10%', target: 'Consistent' },
        Documentation: { weight: '10%', target: 'Adequate' },
      },
      terminationConditions: [
        'Score >= 80 (success)',
        '5 iterations without improvement (escalate)',
        'User accepts "good enough" (override)',
      ],
      criticalRules: [
        'Measurable improvement — score must increase each iteration',
        'Specific feedback — "make it better" is not acceptable',
        'Target defined — what does "good" look like?',
        'Iteration limited — max 5 attempts, then escalate',
        'Evidence required — before/after comparison',
      ],
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const checklist = [
      'Target defined — what does "good" look like?',
      'Initial version generated from spec',
      'Review against criteria (5 dimensions, weighted)',
      'Score calculated — weighted average',
      'Feedback specific, actionable, prioritized (top 3)',
      'Revise and document changes',
      'Before/after delta shown',
    ];

    const flags: DomainOutput['flags'] = [];
    const score = currentScore ? parseInt(currentScore, 10) : null;
    if (score !== null && score >= 80) {
      flags.push({
        severity: 'info',
        message: `Score ${score} >= 80 — iteration complete, no further revision needed.`,
      });
    } else if (score !== null) {
      flags.push({
        severity: 'warn',
        message: `Score ${score} < 80 — continue to feedback. Feedback must be specific, actionable, prioritized (top 3).`,
      });
    }
    if (iteration && parseInt(iteration, 10) >= 5) {
      flags.push({
        severity: 'critical',
        message: 'Iteration 5 reached — escalate to orchestrator if score < 60 or no improvement.',
      });
    }

    const artifacts = [
      {
        name: 'sia-iteration-report',
        content:
          `# SIA Iteration Report — ${intent.replace(/_/g, ' ')}\n\n` +
          `**Task:** ${task}\n\n` +
          `**Current score:** ${score !== null ? `${score}/100` : 'Not yet scored'}\n` +
          `**Iteration:** ${iteration ?? '1'}\n\n` +
          `## Scoring Rubric\n\n` +
          `| Dimension | Weight | Score | Notes |\n|---|---|---|---|\n` +
          `| Completeness | 30% | __/100 | |\n` +
          `| Correctness | 30% | __/100 | |\n` +
          `| Quality | 20% | __/100 | |\n` +
          `| Style | 10% | __/100 | |\n` +
          `| Documentation | 10% | __/100 | |\n` +
          `| **TOTAL** | **100%** | **__/100** | |\n\n` +
          `## Feedback (specific, actionable, prioritized)\n\n` +
          `- [P0 - Must Fix] \n- [P1 - Should Fix] \n- [P2 - Nice to Have] \n\n` +
          `## Delta\n\n` +
          `\`\`\`diff\n- Previous score: __\n+ New score: __\n\`\`\`\n\n` +
          `## Termination\n\n` +
          `- [ ] Score >= 80 (success)\n- [ ] 5 iterations without improvement (escalate)\n- [ ] User accepts "good enough" (override)\n`,
      },
    ];

    return {
      summary: `SIA iteration report${score !== null ? ` (current score ${score}/100)` : ''} with 5-dimension rubric and feedback contract.`,
      analysis,
      checklist,
      artifacts,
      evidence: ['SIA.md domain prompt loaded', 'Scoring rubric + termination conditions applied'],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
