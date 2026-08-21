#!/usr/bin/env node
/**
 * LEGAL Agent (legal-agent) - Native Implementation
 *
 * Legal and compliance advisor — regulatory frameworks, contract review, DPA.
 * Executor logic mirrors config/agent-prompts/LEGAL.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'legal-agent',
  description: 'Legal agent — compliance, contract review, and regulatory guidance',
  promptFile: 'LEGAL',
  domain: 'legal',
  version: '1.0.0',
  temperature: 0.15,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent =
      normalized.includes('contract') ||
      normalized.includes('agreement') ||
      normalized.includes('dpa')
        ? 'CONTRACT_REVIEW'
        : normalized.includes('gdpr') ||
            normalized.includes('compliance') ||
            normalized.includes('privacy') ||
            normalized.includes('hipaa') ||
            normalized.includes('soc')
          ? 'COMPLIANCE'
          : normalized.includes('incident') || normalized.includes('breach')
            ? 'INCIDENT_RESPONSE'
            : normalized.includes('memo') || normalized.includes('legal memo')
              ? 'LEGAL_MEMO'
              : normalized.includes('escalat')
                ? 'ESCALATION'
                : 'GENERAL';

    const analysis: Record<string, unknown> = {
      task,
      intent,
      criticalRules: [
        'Regulations cited — every claim references applicable regulation',
        'When in doubt, escalate — do not guess on legal matters',
        'Checklist complete — no partial compliance',
        'Documentation — if it is not documented, it did not happen',
        'Updates tracked — laws change; compliance must too',
      ],
      breachTimelines: {
        GDPR: '72 hours (personal data breach)',
        CCPA: 'Without delay (unauthorized access)',
        HIPAA: '60 days (PHI breach >500 people)',
        StateLaws: 'Varies — usually "without delay"',
      },
      immediateEscalation: [
        'Potential data breach',
        'Regulatory inquiry received',
        'Contract dispute',
        'IP infringement claim',
        'Employment lawsuit threatened',
      ],
      prohibitedWithoutApproval: [
        'Delete data subject to litigation hold',
        'Modify signed contracts',
        'Waive indemnification',
        'Accept unlimited liability',
        'Enter regulated business without licensing',
      ],
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const checklist = [
      'Regulations cited for every claim',
      'When in doubt — escalate before proceeding',
      'Checklist complete — no partial compliance',
      'Documentation: date, who, what, why, evidence',
      'Updates tracked — compliance stays current',
      intent === 'CONTRACT_REVIEW'
        ? 'Contract: parties, jurisdiction, governing law, term, consideration'
        : 'Compliance records: privacy policy, ToS, DPAs, security policies',
    ];

    const flags: DomainOutput['flags'] = [
      {
        severity: 'critical',
        message:
          'Legal output is advisory, not legal advice. Escalate to qualified counsel before acting.',
        advisory: true,
      },
    ];
    if (intent === 'INCIDENT_RESPONSE') {
      flags.push({
        severity: 'critical',
        message:
          'Breach response: Contain → Assess → Notify → Document → Remediate → Review. Check regulatory timelines.',
        advisory: true,
      });
    }
    if (intent === 'CONTRACT_REVIEW') {
      flags.push({
        severity: 'warn',
        message:
          'Review key clauses: indemnification, limitation of liability, termination, IP rights, confidentiality, non-compete.',
      });
    }

    const artifacts = [
      {
        name: 'legal-analysis',
        content:
          `# Legal Analysis — ${intent.replace(/_/g, ' ')}\n\n` +
          `**Task:** ${task}\n\n` +
          `## Critical Rules\n\n` +
          `1. Regulations cited — every claim references applicable regulation\n` +
          `2. When in doubt, escalate — do not guess on legal matters\n` +
          `3. Checklist complete — no partial compliance\n` +
          `4. Documentation — if it is not documented, it did not happen\n` +
          `5. Updates tracked — laws change; compliance must too\n\n` +
          `## Regulatory Frameworks\n\n` +
          `- Data privacy: GDPR (EU), CCPA/CPRA (California), LGPD (Brazil), PIPEDA (Canada)\n` +
          `- Industry: HIPAA (healthcare), PCI-DSS (payments), SOC2, ISO 27001\n` +
          `- Export/trade: ITAR, EAR, OFAC sanctions\n\n` +
          `## Breach Notification Timelines\n\n` +
          `| Regulation | Timeline | Trigger |\n|---|---|---|\n` +
          `| GDPR | 72 hours | Personal data breach |\n` +
          `| CCPA | Without delay | Unauthorized access |\n` +
          `| HIPAA | 60 days | PHI breach >500 people |\n` +
          `| State laws | Varies | Usually "without delay" |\n\n` +
          `## Escalation Criteria\n\n` +
          `**Immediate:** potential data breach, regulatory inquiry, contract dispute, IP claim, employment lawsuit.\n` +
          `**Legal review required:** contract modifications, new vendor agreements, compliance-affecting changes, international expansion, M&A.\n\n` +
          `## Prohibited Actions (without explicit legal approval)\n\n` +
          `- Delete data subject to litigation hold\n- Modify signed contracts\n- Waive indemnification\n- Accept unlimited liability\n- Enter regulated business without licensing\n`,
      },
    ];

    return {
      summary: `${intent.replace(/_/g, ' ')} analysis prepared with ${checklist.length} compliance checks. Advisory only — escalate for real legal matters.`,
      analysis,
      checklist,
      artifacts,
      evidence: [
        'LEGAL.md domain prompt loaded',
        'Regulatory frameworks + breach timelines applied',
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
