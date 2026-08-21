#!/usr/bin/env node
/**
 * BUS-TELE Agent (bus-tele-agent) - Native Implementation
 *
 * Business intelligence analyst — metrics definition, telemetry validation,
 * data source tracking. Every number must trace to a source.
 * Executor logic mirrors config/agent-prompts/BUS-TELE.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'bus-tele-agent',
  description: 'Business telemetry agent — metrics, data validation, and BI insights',
  promptFile: 'BUS-TELE',
  domain: 'business-telemetry',
  version: '1.0.0',
  temperature: 0.2,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent =
      normalized.includes('metric') || normalized.includes('kpi') || normalized.includes('dau')
        ? 'METRICS'
        : normalized.includes('telemetry') ||
            normalized.includes('event') ||
            normalized.includes('schema')
          ? 'TELEMETRY'
          : normalized.includes('validat') || normalized.includes('pipeline')
            ? 'VALIDATION'
            : normalized.includes('dashboard') || normalized.includes('report')
              ? 'DASHBOARD'
              : normalized.includes('alert')
                ? 'ALERT'
                : 'GENERAL';

    const analysis: Record<string, unknown> = {
      task,
      intent,
      criticalRules: [
        'Source documented — every metric must have a data source',
        'Validation required — spot-check 10% of data points',
        'Context included — metrics without context are dangerous',
        'Timestamps mandatory — when was this captured?',
        'Privacy preserved — no PII in aggregate reports',
      ],
      goodMetrics: [
        'CAC',
        'LTV',
        'Churn rate',
        'NRR',
        'Feature adoption rate',
        'Error rate by service',
      ],
      vanityMetrics: [
        'Total page views (without conversion)',
        'Registered users (without activity)',
        'Downloads (without activations)',
        'Lines of code',
        'Hours worked',
      ],
      metricQualityCheck: [
        'Aligns with business goals?',
        'Drives specific action?',
        'Trends over time meaningfully?',
        'Has a clear owner?',
        'Has dimensional breakdowns?',
      ],
      privacy: {
        PII: 'Name, email, phone, address, SSN — need-to-know, logged access',
        Pseudonymized: 'User ID without mapping — engineering only',
        Aggregate: 'Counts, averages, percentiles — business teams OK',
      },
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const checklist = [
      'Every metric has a documented data source',
      'Spot-check 10% of data points',
      'Context included — no metrics without context',
      'Timestamps present on all captures',
      'No PII in aggregate reports',
      'Metric has a clear owner',
      'Dashboard: title with metric name, time period, unit; 30-day minimum view',
    ];

    const flags: DomainOutput['flags'] = [
      {
        severity: 'info',
        message:
          'Data source tracking: Metric → Source → Calculation → Last Updated → Owner → Validated',
      },
      {
        severity: 'warn',
        message:
          'Avoid alert fatigue: P1 = revenue/major outage, P2 = degraded, P3 = informational. False positive rate <10%.',
      },
    ];

    const artifacts = [
      {
        name: 'telemetry-analysis',
        content:
          `# Business Telemetry — ${intent.replace(/_/g, ' ')}\n\n` +
          `**Task:** ${task}\n\n` +
          `## Critical Rules\n\n` +
          `1. Source documented — every metric must have a data source\n` +
          `2. Validation required — spot-check 10% of data points\n` +
          `3. Context included — metrics without context are dangerous\n` +
          `4. Timestamps mandatory — when was this captured?\n` +
          `5. Privacy preserved — no PII in aggregate reports\n\n` +
          `## Metric Classification\n\n` +
          `**Good (actionable):** CAC, LTV, churn rate, NRR, feature adoption, error rate by service\n` +
          `**Bad (vanity):** page views without conversion, registered without activity, downloads without activation, lines of code, hours worked\n\n` +
          `## Data Source Tracking Template\n\n` +
          `\`\`\`\nMetric: [name]\nSource: [table/event]\nCalculation: [formula]\nLast Updated: [ISO timestamp]\nOwner: [team]\nValidated: [by whom, when]\n\`\`\`\n\n` +
          `## Validation Pipeline\n\n` +
          `1. Schema validation (required fields, types, enums, timestamps)\n` +
          `2. Business rules (no future timestamps, durations >0, valid user IDs, whitelisted events)\n` +
          `3. Statistical anomaly detection (spikes >3 std dev, missing periods, duplicates)\n` +
          `4. Manual spot check (sample 10%, verify against source)\n`,
      },
    ];

    return {
      summary: `${intent.replace(/_/g, ' ')} analysis with ${checklist.length} data-integrity checks. Every number must trace to a source.`,
      analysis,
      checklist,
      artifacts,
      evidence: ['BUS-TELE.md domain prompt loaded', 'Metric quality + privacy rules applied'],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
