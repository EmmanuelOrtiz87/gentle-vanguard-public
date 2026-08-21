#!/usr/bin/env node
/**
 * HR Agent (hr-agent) - Native Implementation
 *
 * People operations — inclusive hiring, structured interviews, compliance.
 * Executor logic mirrors config/agent-prompts/HR.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'hr-agent',
  description: 'HR agent — people operations, hiring, and compliance',
  promptFile: 'HR',
  domain: 'hr',
  version: '1.0.0',
  temperature: 0.3,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent =
      normalized.includes('job') || normalized.includes('description') || normalized.includes('jd')
        ? 'JOB_DESCRIPTION'
        : normalized.includes('interview')
          ? 'INTERVIEW'
          : normalized.includes('onboard')
            ? 'ONBOARDING'
            : normalized.includes('remote') || normalized.includes('policy')
              ? 'POLICY'
              : normalized.includes('compliance')
                ? 'COMPLIANCE'
                : 'GENERAL';

    const analysis: Record<string, unknown> = {
      task,
      intent,
      criticalRules: [
        'Inclusive language — bias-free job descriptions',
        'Structured interviews — same questions for all candidates',
        'Documentation — every decision traceable',
        'Compliance — labor laws non-negotiable',
        'Privacy — candidate data protected',
      ],
      inclusiveLanguage: [
        { avoid: 'Young and energetic', use: 'Fast-paced environment' },
        { avoid: 'Digital native', use: 'Proficiency with digital tools' },
        { avoid: 'English major', use: 'Strong written communication' },
        { avoid: 'Cultural fit', use: 'Values alignment' },
      ],
      scoringRubric: {
        dimensions: ['Technical skill', 'Communication', 'Problem solving', 'Culture add'],
        scale: '1-Poor to 4-Excellent',
      },
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const checklist = [
      'Gender-neutral language (no "rockstar", "ninja")',
      'Requirements vs preferred separated',
      'Salary range included',
      'Remote/hybrid status clear',
      'EEO statement included',
      'Accessibility accommodations noted',
      'Experience years justified (not arbitrary)',
      'No prohibited questions (age, marital status, religion)',
      'Process owner, steps, decision criteria, escalation path documented',
    ];

    const flags: DomainOutput['flags'] = [
      {
        severity: 'info',
        message:
          'HR processes must be documented: process owner, steps with timeline, decision criteria, escalation path, audit trail, retention period',
      },
    ];
    if (normalized.includes('job') || normalized.includes('descrip')) {
      flags.push({
        severity: 'warn',
        message: 'Verify inclusive language table before publishing (HR.md §Inclusive Language)',
      });
    }

    const artifacts = [
      {
        name: 'hr-workflow',
        content:
          `# HR Workflow — ${intent.replace(/_/g, ' ')}\n\n` +
          `**Task:** ${task}\n\n` +
          `## Critical Rules\n\n` +
          `1. Inclusive language — job descriptions must use bias-free language\n` +
          `2. Structured interviews — same questions for all candidates\n` +
          `3. Documentation — every decision traceable\n` +
          `4. Compliance — labor laws non-negotiable\n` +
          `5. Privacy — candidate data protected\n\n` +
          `## Job Description Checklist (pre-publish)\n\n` +
          `- [ ] Gender-neutral language\n- [ ] Requirements vs preferred separated\n- [ ] Salary range included\n- [ ] Remote/hybrid status clear\n- [ ] EEO statement included\n- [ ] Accessibility accommodations noted\n\n` +
          `## Interview Structure\n\n` +
          `- Opening (5 min): welcome, expectations, comfort\n` +
          `- Consistent questions (30 min): same for all candidates\n` +
          `- Scoring rubric: Technical skill / Communication / Problem solving / Culture add (1-4)\n` +
          `- Closing (5 min): candidate questions, timeline, thank you\n` +
          `\n## Red Flags\n\n` +
          `- Asking prohibited questions\n- Inconsistent process across similar roles\n- No documentation of decisions\n- Pressure to hire specific candidate\n- Salary discussions without consistency\n`,
      },
    ];

    return {
      summary: `${intent.replace(/_/g, ' ')} workflow prepared with ${checklist.length} compliance checklist items.`,
      analysis,
      checklist,
      artifacts,
      evidence: [
        'HR.md domain prompt loaded',
        'Inclusive language + compliance checklists applied',
      ],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
