#!/usr/bin/env node
/**
 * owasp-agentic-top10.ts — OWASP Agentic AI Top 10 Compliance Mapping (ADR-0029)
 *
 * Formal mapping of the Gentle-Vanguard stack against the OWASP Agentic AI
 * Top 10 (2025) risk categories, with evidence generation and coverage scoring.
 *
 * Inspired by the Microsoft Agent Governance Toolkit's OWASP Agentic Top 10
 * architecture mapping. This module:
 *
 *   1. Defines the 10 OWASP Agentic AI risk categories.
 *   2. Maps each to the specific GV stack components that provide the control.
 *   3. Generates a compliance report with per-category coverage and evidence.
 *   4. Supports a `--strict` mode that fails CI when coverage is insufficient.
 *
 * The 10 categories (OWASP Agentic AI Top 10, 2025):
 *   LLM01:2025  Prompt Injection
 *   LLM02:2025  Sensitive Information Disclosure
 *   LLM03:2025  Supply Chain
 *   LLM04:2025  Data and Model Poisoning
 *   LLM05:2025  Improper Output Handling
 *   LLM06:2025  Excessive Agency
 *   LLM07:2025  System Prompt Leakage
 *   LLM08:2025  Vector and Embedding Weaknesses
 *   LLM09:2025  Misinformation
 *   LLM10:2025  Unbounded Consumption
 *
 * Usage (CLI):
 *   npx tsx src/security/owasp/owasp-agentic-top10.ts report
 *   npx tsx src/security/owasp/owasp-agentic-top10.ts report --strict
 *   npx tsx src/security/owasp/owasp-agentic-top10.ts verify --evidence ./owasp-evidence.json
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoverageLevel = 'full' | 'partial' | 'none';

export interface OwaspCategory {
  id: string;
  title: string;
  description: string;
  /** GV stack components that provide the control. */
  controls: string[];
  /** Coverage level achieved by the current stack. */
  coverage: CoverageLevel;
  /** Evidence: paths/commands that demonstrate the control. */
  evidence: string[];
  /** Gap: what's missing for full coverage. */
  gap?: string;
}

export interface OwaspReport {
  generatedAt: string;
  totalCategories: number;
  fullCoverage: number;
  partialCoverage: number;
  noneCoverage: number;
  overallCoverage: number; // 0-100
  categories: OwaspCategory[];
  strictPass: boolean;
}

// ---------------------------------------------------------------------------
// OWASP Agentic AI Top 10 mapping
// ---------------------------------------------------------------------------

export function buildOwaspMapping(): OwaspCategory[] {
  return [
    {
      id: 'LLM01:2025',
      title: 'Prompt Injection',
      description: 'Manipulation of LLM inputs to override instructions or access unauthorized data.',
      controls: [
        'src/security/prompt-injection-guard.ts',
        'src/security/guardrails/input-moderation.ts',
        'src/security/policy-engine/policy-engine.ts',
        'src/mcp/security-gateway/mcp-security-gateway.ts',
      ],
      coverage: 'full',
      evidence: [
        'prompt-injection-guard.ts — heuristic + pattern detection',
        'input-moderation.ts — jailbreak rail (F3.2)',
        'policy-engine.ts — deterministic fail-closed tool gating',
        'mcp-security-gateway.ts — hidden instruction scanning',
      ],
    },
    {
      id: 'LLM02:2025',
      title: 'Sensitive Information Disclosure',
      description: 'LLM outputs leaking sensitive data (PII, credentials, internal data).',
      controls: [
        'src/security/privacy-gateway.ts',
        'src/security/secret-scanner/scanner.ts',
        'src/security/guardrails/output-moderation.ts',
      ],
      coverage: 'full',
      evidence: [
        'privacy-gateway.ts — PII sanitization',
        'secret-scanner.ts — 80+ credential patterns',
        'output-moderation.ts — output rail',
      ],
    },
    {
      id: 'LLM03:2025',
      title: 'Supply Chain',
      description: 'Vulnerabilities in third-party components, models, or data sources.',
      controls: [
        'src/security/dependency-security-checker.ts',
        'src/security/generate-sbom.ts',
        'src/security/slsa-provenance.ts',
        'src/security/container-scan.ts',
      ],
      coverage: 'full',
      evidence: [
        'dependency-security-checker.ts — vulnerability + license scan',
        'generate-sbom.ts — CycloneDX SBOM',
        'slsa-provenance.ts — SLSA provenance',
        'container-scan.ts — container vulnerability scan',
      ],
    },
    {
      id: 'LLM04:2025',
      title: 'Data and Model Poisoning',
      description: 'Corruption of training data, RAG sources, or fine-tuning data.',
      controls: [
        'src/retrieval/retrieval-grader.ts',
        'src/mcp/security-gateway/mcp-security-gateway.ts',
        'src/security/rag-source-integrity.ts',
      ],
      coverage: 'full',
      evidence: [
        'retrieval-grader.ts — BM25 retrieval grading',
        'mcp-security-gateway.ts — tool poisoning detection',
        'rag-source-integrity.ts — RAG source integrity + provenance chain',
      ],
    },
    {
      id: 'LLM05:2025',
      title: 'Improper Output Handling',
      description: 'LLM output used in unsafe downstream contexts (SQL, shell, HTML).',
      controls: [
        'src/security/guardrails/output-moderation.ts',
        'src/security/policy-engine/policy-engine.ts',
        'src/security/output-encoding.ts',
      ],
      coverage: 'full',
      evidence: [
        'output-moderation.ts — output rail',
        'policy-engine.ts — fail-closed action gating',
        'output-encoding.ts — context-aware encoding (sql/shell/html/htmlAttr/url/json)',
      ],
    },
    {
      id: 'LLM06:2025',
      title: 'Excessive Agency',
      description: 'Agent granted too much autonomy to perform unintended actions.',
      controls: [
        'src/security/policy-engine/policy-engine.ts',
        'src/rdd/rdd-kill-switch.ts',
        'src/security/guardrails/guardrail-orchestrator.ts',
        'src/security/opencode-guards.ts',
      ],
      coverage: 'full',
      evidence: [
        'policy-engine.ts — deterministic action gating',
        'rdd-kill-switch.ts — termination control',
        'guardrail-orchestrator.ts — failure classification + action',
        'opencode-guards.ts — tool allowlist',
      ],
    },
    {
      id: 'LLM07:2025',
      title: 'System Prompt Leakage',
      description: 'Exposure of system prompts, routing logic, or embedded secrets.',
      controls: [
        'src/security/secret-scanner/scanner.ts',
        'src/security/prompt-injection-guard.ts',
        'src/security/system-prompt-redaction.ts',
      ],
      coverage: 'full',
      evidence: [
        'secret-scanner.ts — detects embedded secrets',
        'prompt-injection-guard.ts — detects system prompt reveal attempts',
        'system-prompt-redaction.ts — redaction layer for model responses',
      ],
    },
    {
      id: 'LLM08:2025',
      title: 'Vector and Embedding Weaknesses',
      description: 'Vulnerabilities in vector databases and embedding pipelines.',
      controls: [
        'src/retrieval/retrieval-grader.ts',
        'src/security/embedding-guard.ts',
      ],
      coverage: 'full',
      evidence: [
        'retrieval-grader.ts — BM25 retrieval grading',
        'embedding-guard.ts — embedding-space injection detection + vector store access control',
      ],
    },
    {
      id: 'LLM09:2025',
      title: 'Misinformation',
      description: 'Agent generating false or misleading information presented as fact.',
      controls: [
        'src/retrieval/retrieval-grader.ts',
        'src/review/auto-code-review.ts',
        'src/security/fact-checker.ts',
      ],
      coverage: 'full',
      evidence: [
        'retrieval-grader.ts — retrieval quality grading',
        'auto-code-review.ts — independent verification',
        'fact-checker.ts — claim-source verification (Jaccard overlap)',
      ],
    },
    {
      id: 'LLM10:2025',
      title: 'Unbounded Consumption',
      description: 'Uncontrolled resource consumption (tokens, compute, API calls).',
      controls: [
        'src/tokens/token-budget-guard.ts',
        'config/token-budget-guard.json',
        'src/resilience/circuit-breaker-v2.ts',
      ],
      coverage: 'full',
      evidence: [
        'token-budget-guard.ts — daily/per-session budgets',
        'token-budget-guard.json — 5M daily / 3M per-session',
        'circuit-breaker-v2.ts — resource protection',
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

export function generateReport(strict: boolean): OwaspReport {
  const categories = buildOwaspMapping();
  const full = categories.filter((c) => c.coverage === 'full').length;
  const partial = categories.filter((c) => c.coverage === 'partial').length;
  const none = categories.filter((c) => c.coverage === 'none').length;
  const overall = Math.round(((full * 1 + partial * 0.5 + none * 0) / categories.length) * 100);

  return {
    generatedAt: new Date().toISOString(),
    totalCategories: categories.length,
    fullCoverage: full,
    partialCoverage: partial,
    noneCoverage: none,
    overallCoverage: overall,
    categories,
    strictPass: strict ? overall >= 80 && none === 0 : true,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cmd = process.argv[2];

  if (cmd === 'report') {
    const strict = args.strict === 'true' || args.strict === '1';
    const report = generateReport(strict);
    const outputPath = args.output ?? join(resolve(process.cwd()), '.runtime', 'owasp-agentic-top10.json');
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`OWASP Agentic AI Top 10 report written to ${outputPath}`);
    console.log(`  Coverage: ${report.overallCoverage}% (${report.fullCoverage} full / ${report.partialCoverage} partial / ${report.noneCoverage} none)`);
    if (strict) {
      console.log(`  Strict mode: ${report.strictPass ? 'PASS' : 'FAIL'}`);
      process.exit(report.strictPass ? 0 : 1);
    }
    return;
  }

  if (cmd === 'verify') {
    const evidencePath = args.evidence;
    if (!evidencePath || !existsSync(evidencePath)) {
      console.error('Usage: owasp-agentic-top10.ts verify --evidence <path>');
      process.exit(1);
    }
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8'));
    // Verify each category has evidence
    const report = generateReport(false);
    const missing = report.categories.filter((c) => !evidence[c.id]);
    if (missing.length > 0) {
      console.error(`Missing evidence for: ${missing.map((m) => m.id).join(', ')}`);
      process.exit(1);
    }
    console.log('All OWASP categories have evidence. PASS');
    return;
  }

  console.error('Usage: owasp-agentic-top10.ts <report|verify> [options]');
  process.exit(1);
}

// Only run CLI when executed directly (not imported)
if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('owasp-agentic-top10.ts'))
) {
  main();
}
