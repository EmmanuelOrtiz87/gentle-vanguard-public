#!/usr/bin/env node
/**
 * MKT Agent (mkt-agent) - Native Implementation
 *
 * Marketing strategist — content strategy, campaigns, and brand positioning.
 * Executor logic mirrors config/agent-prompts/MKT.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'mkt-agent',
  description: 'Marketing agent — content strategy, campaigns, and brand positioning',
  promptFile: 'MKT',
  domain: 'marketing',
  version: '1.0.0',
  temperature: 0.5,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const contentType = normalized.includes('landing')
      ? 'LANDING_PAGE'
      : normalized.includes('email')
        ? 'EMAIL_CAMPAIGN'
        : normalized.includes('blog') || normalized.includes('post')
          ? 'BLOG_POST'
          : normalized.includes('social')
            ? 'SOCIAL_MEDIA'
            : normalized.includes('seo')
              ? 'SEO'
              : normalized.includes('position') || normalized.includes('brand')
                ? 'POSITIONING'
                : 'GENERAL';

    const audience =
      context?.match(/audience:?\s*([^\n,]+)/i)?.[1]?.trim() ||
      'Undefined — must be defined before proceeding';
    const cta = context?.match(/cta:?\s*([^\n,]+)/i)?.[1]?.trim() || 'Not specified';

    const analysis: Record<string, unknown> = {
      task,
      contentType,
      targetAudience: audience,
      primaryCta: cta,
      keyRules: [
        'Lead with value — what is in it for the reader?',
        'Specific over vague: "Increase revenue 23%" beats "grow your business"',
        'Single primary CTA',
        'SEO keywords integrated naturally (title, H1, first paragraph, meta)',
        'Proofread; mobile preview checked',
      ],
      metricsTargets: {
        openRate: { good: '>20%', great: '>30%' },
        clickRate: { good: '>2%', great: '>5%' },
        conversion: { good: '>1%', great: '>3%' },
        timeOnPage: { good: '>2min', great: '>4min' },
        bounceRate: { good: '<50%', great: '<30%' },
      },
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const checklist = [
      'Value proposition clear in first 30 words',
      'Target audience explicitly stated',
      'Single primary CTA defined',
      'SEO keywords integrated naturally',
      'Headline testable (first 5 words carry the hook)',
      'Proofread for typos/grammar',
      'Mobile preview checked',
      'No jargon — speaks human, not corporate',
    ];

    const flags: DomainOutput['flags'] = [];
    if (audience.startsWith('Undefined')) {
      flags.push({
        severity: 'critical',
        message: 'Target audience undefined — refuse to proceed until defined',
      });
    }
    if (cta === 'Not specified') {
      flags.push({
        severity: 'warn',
        message: 'No CTA detected — every piece needs a clear next step',
      });
    }

    const artifacts = [
      {
        name: 'content-brief',
        content:
          `# Content Brief — ${contentType.replace(/_/g, ' ')}\n\n` +
          `**Task:** ${task}\n\n` +
          `**Target audience:** ${audience}\n\n` +
          `**Primary CTA:** ${cta}\n\n` +
          `## Structure\n` +
          (contentType === 'LANDING_PAGE'
            ? '- Above-fold value proposition (10 seconds to understand)\n- Social proof (logos, testimonials, stats)\n- Feature/benefit pairs\n- Risk reversal (guarantees, trials)\n- Single primary CTA\n'
            : contentType === 'EMAIL_CAMPAIGN'
              ? '- Subject line: curiosity + relevance\n- Preview text continuation\n- Single message per email\n- Mobile-first formatting\n- Unsubscribe compliance\n'
              : contentType === 'BLOG_POST'
                ? '- Search intent match\n- Scannable structure (H2s, bullets)\n- Original research or unique angle\n- Internal/external linking\n- Related content recommendations\n'
                : contentType === 'SOCIAL_MEDIA'
                  ? '- Platform-native format\n- Hook in first 3 seconds/words\n- Engagement prompts\n- Consistent voice per platform\n- Timing optimization\n'
                  : '- Clear value proposition\n- Feature/benefit pairs\n- Social proof\n- Risk reversal\n- CTA\n'),
      },
    ];

    return {
      summary: `${contentType.replace(/_/g, ' ')} brief prepared for audience "${audience}" with CTA "${cta}".`,
      analysis,
      checklist,
      artifacts,
      evidence: ['MKT.md domain prompt loaded', 'Metrics targets from MKT.md'],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
