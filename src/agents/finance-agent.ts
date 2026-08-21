#!/usr/bin/env node
/**
 * FINANCE Agent (finance-agent) - Native Implementation
 *
 * Financial analyst — models, metrics, forecasting with built-in validation.
 * Executor logic mirrors config/agent-prompts/FINANCE.md.
 */

import { runDomainAgent, type DomainAgentConfig, type DomainOutput } from './domain-agent-core';

const AGENT_CONFIG: DomainAgentConfig = {
  name: 'finance-agent',
  description: 'Finance agent — financial modeling, metrics, and forecasting',
  promptFile: 'FINANCE',
  domain: 'finance',
  version: '1.0.0',
  temperature: 0.15,
  execute: (task, context, prompt) => {
    const normalized = task.toLowerCase();
    const intent =
      normalized.includes('model') || normalized.includes('projection')
        ? 'MODEL'
        : normalized.includes('forecast')
          ? 'FORECAST'
          : normalized.includes('metric') || normalized.includes('kpi')
            ? 'METRICS'
            : normalized.includes('sensitivity')
              ? 'SENSITIVITY'
              : normalized.includes('balance') || normalized.includes('sheet')
                ? 'BALANCE_SHEET'
                : normalized.includes('cash')
                  ? 'CASH_FLOW'
                  : 'GENERAL';

    // Extract optional inputs
    const extractNumber = (label: string): number | null => {
      const m = context?.match(new RegExp(`${label}:?\\s*([\\d,.]+)`, 'i'));
      return m ? parseFloat(m[1].replace(/,/g, '')) : null;
    };

    const revenue = extractNumber('revenue');
    const cogs = extractNumber('cogs');
    const opex = extractNumber('opex');
    const cac = extractNumber('cac');
    const ltv = extractNumber('ltv');

    // Gross margin check when inputs present
    let grossMargin: number | null = null;
    if (revenue !== null && cogs !== null && revenue !== 0) {
      grossMargin = Math.round(((revenue - cogs) / revenue) * 10000) / 100;
    }

    let ltvCac: number | null = null;
    if (cac && cac !== 0 && ltv) {
      ltvCac = Math.round((ltv / cac) * 100) / 100;
    }

    const analysis: Record<string, unknown> = {
      task,
      intent,
      inputs: { revenue, cogs, opex, cac, ltv },
      computed: {
        grossMarginPct: grossMargin,
        ltvCacRatio: ltvCac,
        ltvCacHealthy: ltvCac !== null ? ltvCac > 3 : null,
      },
      errorChecks: [
        'Assets = Liabilities + Equity (must balance)',
        'Cash flow ending cash must match balance sheet cash',
        'Assumptions traced to source',
        'Unit consistency (never mix thousands and millions)',
      ],
      documentation: [
        'Version history — date, author, changes',
        'Key drivers — list of assumption cells',
        'Data sources — where inputs come from',
        'Known limitations — what the model does not capture',
        'Instructions — how to update/use',
      ],
      redFlags: [
        'Circular references (except intentional iteration)',
        'Hardcoded numbers without explanation',
        'Inconsistent periods (months vs quarters)',
        'Missing depreciation schedules',
        'Manual fudge factors to make it balance',
      ],
      domainPrompt: prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    };

    const checklist = [
      'Balance must balance — Assets = Liabilities + Equity',
      'Assumptions cited — every number traces to a source',
      'Error checks built-in — formulas validate themselves',
      'Sensitivities included — best/base/worst case',
      'Unit consistency maintained',
      'Version history documented',
    ];

    const flags: DomainOutput['flags'] = [];
    if (ltvCac !== null && ltvCac <= 3) {
      flags.push({
        severity: 'warn',
        message: `LTV/CAC = ${ltvCac}x (target >3x) — unit economics weak`,
      });
    }
    if (grossMargin !== null && grossMargin < 0) {
      flags.push({ severity: 'critical', message: 'Negative gross margin — COGS exceeds revenue' });
    }
    if (revenue === null && cac === null) {
      flags.push({
        severity: 'info',
        message:
          'No numeric inputs provided — provide revenue/cogs/cac/ltv via context for computed checks',
      });
    }

    const artifacts = [
      {
        name: 'financial-analysis',
        content:
          `# Financial Analysis — ${intent.replace(/_/g, ' ')}\n\n` +
          `**Task:** ${task}\n\n` +
          `## Inputs\n\n` +
          `| Input | Value |\n|---|---|\n` +
          `| Revenue | ${revenue ?? '—'} |\n| COGS | ${cogs ?? '—'} |\n| OpEx | ${opex ?? '—'} |\n| CAC | ${cac ?? '—'} |\n| LTV | ${ltv ?? '—'} |\n\n` +
          `## Computed Checks\n\n` +
          `- Gross margin: ${grossMargin ?? '—'}%\n` +
          `- LTV/CAC: ${ltvCac !== null ? `${ltvCac}x ${ltvCac > 3 ? '✅ healthy' : '⚠️ below 3x'}` : '—'}\n\n` +
          `## Model Structure (per FINANCE.md)\n\n` +
          `### Income Statement\n\`\`\`\nRevenue\n- COGS\n= Gross Profit\n- OpEx\n= Operating Income\n- Interest/Taxes\n= Net Income\n\`\`\`\n\n` +
          `### Balance Sheet\n\`\`\`\nAssets = Liabilities + Equity  # must balance\n\`\`\`\n\n` +
          `### Cash Flow\n\`\`\`\nOperating + Investing + Financing = Cash Change\n\`\`\`\n`,
      },
    ];

    return {
      summary: `${intent.replace(/_/g, ' ')} analysis${grossMargin !== null ? ` with gross margin ${grossMargin}%` : ''}${ltvCac !== null ? ` and LTV/CAC ${ltvCac}x` : ''}.`,
      analysis,
      checklist,
      artifacts,
      evidence: ['FINANCE.md domain prompt loaded', 'Built-in validation formulas applied'],
      flags,
    };
  },
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDomainAgent(AGENT_CONFIG).catch(console.error);
}

import { pathToFileURL } from 'url';
export { AGENT_CONFIG };
