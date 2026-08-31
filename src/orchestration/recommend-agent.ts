#!/usr/bin/env node
/**
 * Recommend Agent — Auto-reassignment bridge for the orchestrator.
 *
 * Consults the adaptive routing table (.session/routing/routing-table.json),
 * built by src/orchestration/adaptive-router.ts from historical execution data, and returns
 * the best agent for a task domain. Enables AUTOMATIC reassignment based on
 * learned performance instead of static/manual routing.
 *
 * Usage:
 *   npx tsx src/orchestration/recommend-agent.ts --domain "code-review"
 *   npx tsx src/orchestration/recommend-agent.ts --task "fix broken ps1 references" --topn 3
 *   npx tsx src/orchestration/recommend-agent.ts --refresh        # rebuild routing table first
 *   npx tsx src/orchestration/recommend-agent.ts --fallback-check # verify fallback logic
 *
 * Output (JSON): { domain, recommended, confidence, alternatives[], source }
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runNpxTsxSync } from '../core/run-command.js';
import {
  DatabaseManager,
  DEFAULT_TENANT_ID,
} from '../../apps/web-dashboard/server/database/manager.js';

const ROOT = resolve(process.cwd());
const ROUTING_TABLE = join(ROOT, '.session', 'routing', 'routing-table.json');
const STATIC_MAP: Record<string, string[]> = {
  'code-review': ['sdd-verify', 'gov-agent', 'sdd-apply'],
  'code-apply': ['sdd-apply', 'sdd-design', 'sdd-verify'],
  requirements: ['sdd-explore', 'session-agent', 'knowledge-agent'],
  architecture: ['sdd-design', 'sdd-explore', 'premortem-agent'],
  testing: ['sdd-verify', 'sdd-apply', 'self-diag-agent'],
  docs: ['doc-agent', 'technical-writer', 'knowledge-agent'],
  ops: ['ops-agent', 'maintenance-agent', 'self-diag-agent'],
  security: ['gov-agent', 'legal-agent', 'premortem-agent'],
  governance: ['gov-agent', 'legal-agent', 'doc-agent'],
  session: ['session-agent', 'maintenance-agent', 'sdd-verify'],
  // Business domains (native agents — cold-start map)
  marketing: ['mkt-agent', 'sales-agent', 'bus-tele-agent'],
  design: ['mkt-agent', 'doc-agent', 'sdd-design'], // visual/decks/brand → deliverable producers
  sales: ['sales-agent', 'mkt-agent', 'finance-agent'],
  finance: ['finance-agent', 'bus-tele-agent', 'sales-agent'],
  legal: ['legal-agent', 'gov-agent', 'doc-agent'],
  hr: ['hr-agent', 'finance-agent', 'legal-agent'],
  'business-telemetry': ['bus-tele-agent', 'finance-agent', 'sia-agent'],
  gitflow: ['gitflow-agent', 'ops-agent', 'self-diag-agent'],
  sia: ['sia-agent', 'knowledge-agent', 'session-agent'],
  general: ['sdd-apply', 'explore', 'general'],
};

interface RoutingTable {
  domainEntries?: Array<{
    domain: string;
    bestAgent: string;
    alternatives?: Array<{ agentId: string; successRate: number }>;
    confidence: number;
  }>;
  overrides?: Array<{
    domainPattern: string;
    targetAgent: string;
    confidence: number;
  }>;
}

export interface NexusRoutingSource {
  getEnabledRoutingRules(tenantId: string): Array<{
    pattern: string;
    target: string;
    priority: number;
    hitCount: number;
    successRate: number;
  }>;
}

function loadRoutingTable(): RoutingTable | null {
  try {
    if (!existsSync(ROUTING_TABLE)) return null;
    return JSON.parse(readFileSync(ROUTING_TABLE, 'utf-8')) as RoutingTable;
  } catch {
    return null;
  }
}

/**
 * Escape regex special chars in a keyword.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keyword matching with false-positive protection.
 * - Keywords <= 3 chars match as WHOLE WORDS only (prevents 'pr' matching
 *   "product", or 'doc' matching "docker").
 * - Longer keywords match as substring OR whole word (covers stems like
 *   "analy" -> analyze/analysis and full words like "campaign").
 */
function taskHasKeyword(normalized: string, kw: string): boolean {
  if (kw.length <= 3) {
    return new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(normalized);
  }
  return normalized.includes(kw) || new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(normalized);
}

function matchDomain(task: string, domainHint: string): string {
  const normalized = task.toLowerCase();
  // ORDER IS CRITICAL: business keywords come FIRST because they are more
  // specific than generic engineering verbs. Without this, "review this
  // contract" hits 'review'→code-review before 'contract'→legal, and
  // "analyze conversion metrics" hits 'analy'→requirements before
  // 'metric'→business-telemetry.
  const pairs: Array<[string, string]> = [
    // ── Business domains (native agents, highest specificity) ──────────────
    // marketing
    ['campaign', 'marketing'],
    ['marketing', 'marketing'],
    ['social media', 'marketing'],
    ['landing', 'marketing'],
    ['content', 'marketing'],
    ['blog', 'marketing'],
    ['advertis', 'marketing'],
    ['seo', 'marketing'],
    ['brand', 'marketing'],
    // sales
    ['pipeline', 'sales'],
    ['prospect', 'sales'],
    ['quote', 'sales'],
    ['sales', 'sales'],
    ['deal', 'sales'],
    ['lead generation', 'sales'],
    // finance
    ['revenue', 'finance'],
    ['forecast', 'finance'],
    ['financ', 'finance'],
    ['budget', 'finance'],
    ['margin', 'finance'],
    ['churn', 'finance'],
    ['investor', 'finance'],
    ['costs', 'finance'],
    ['pricing', 'finance'],
    ['expense', 'finance'],
    // legal
    ['gdpr', 'legal'],
    ['legal', 'legal'],
    ['contract', 'legal'],
    ['liability', 'legal'],
    ['compliance', 'governance'],
    ['regulation', 'legal'],
    // hr
    ['hire', 'hr'],
    ['hiring', 'hr'],
    ['recruit', 'hr'],
    ['job', 'hr'],
    ['interview', 'hr'],
    ['candidate', 'hr'],
    ['onboarding', 'hr'],
    // business-telemetry
    ['metric', 'business-telemetry'],
    ['telemetry', 'business-telemetry'],
    ['analytics', 'business-telemetry'],
    ['kpi', 'business-telemetry'],
    ['conversion', 'business-telemetry'],
    ['business intelligence', 'business-telemetry'],
    // gitflow
    ['branch', 'gitflow'],
    ['commit', 'gitflow'],
    ['pull', 'gitflow'],
    ['merge', 'gitflow'],
    ['rebase', 'gitflow'],
    ['pr ', 'gitflow'],
    ['git', 'gitflow'],
    // sia
    ['iteration', 'sia'],
    ['score', 'sia'],
    ['refine', 'sia'],
    // ── Absorbed cybersecurity domains (ADR-010, high specificity) ───────────
    // Compliance & risk frameworks → governance
    ['nist', 'governance'],
    ['iso 27001', 'governance'],
    ['cmmc', 'governance'],
    ['cyber risk', 'governance'],
    ['risk assessment', 'governance'],
    ['mitre', 'governance'],
    ['c2pa', 'governance'],
    ['provenance', 'governance'],
    // AI/LLM security → security
    ['prompt injection', 'security'],
    ['llm security', 'security'],
    ['jailbreak', 'security'],
    ['garak', 'security'],
    ['promptfoo', 'security'],
    ['guardrail', 'security'],
    ['rag injection', 'security'],
    ['system prompt', 'security'],
    ['mcp server', 'security'],
    ['tool poisoning', 'security'],
    ['agentic', 'security'],
    // Supply chain / SBOM / secrets → security
    ['sbom', 'security'],
    ['supply chain', 'security'],
    ['dependency confusion', 'security'],
    ['secret', 'security'],
    ['secrets', 'security'],
    ['gitleaks', 'security'],
    ['api key', 'security'],
    // API security → security (before generic 'secur')
    ['api security', 'security'],
    ['owasp', 'security'],
    ['websocket', 'security'],
    ['api inventory', 'security'],
    // ── Engineering domains (generic verbs, lower specificity) ──────────────
    // Engineering quality (sdd-apply) — BEFORE 'test' so "debug the failing
    // test" routes to code-apply, not testing.
    ['debug', 'code-apply'],
    ['bug', 'code-apply'],
    ['performance', 'code-apply'],
    ['review', 'code-review'],
    ['refactor', 'code-apply'],
    ['implement', 'code-apply'],
    ['feature', 'code-apply'],
    ['requirement', 'requirements'],
    ['analy', 'requirements'],
    ['architect', 'architecture'],
    ['design', 'architecture'],
    ['test', 'testing'],
    ['document', 'docs'],
    ['docs', 'docs'],
    ['readme', 'docs'],
    ['deploy', 'ops'],
    ['docker', 'ops'],
    ['infra', 'ops'],
    ['secur', 'security'],
    ['audit', 'governance'],
    ['session', 'session'],
    ['roadmap', 'requirements'],
  ];
  if (domainHint) return domainHint;
  for (const [kw, domain] of pairs) {
    if (taskHasKeyword(normalized, kw)) return domain;
  }
  return 'general';
}

function recommend(
  task: string,
  domainHint: string,
  topN: number,
  options: { tenantId?: string; nexus?: NexusRoutingSource } = {},
): unknown {
  const normalizedTask = task.toLowerCase();
  const domain = matchDomain(task, domainHint);
  const tenantId = options.tenantId ?? process.env.GENTLE_VANGUARD_TENANT_ID ?? DEFAULT_TENANT_ID;
  try {
    const nexus = options.nexus ?? DatabaseManager.getInstance();
    const rules = nexus
      .getEnabledRoutingRules(tenantId)
      .filter(
        (rule) =>
          taskHasKeyword(normalizedTask, rule.pattern.toLowerCase()) ||
          taskHasKeyword(domain.toLowerCase(), rule.pattern.toLowerCase()),
      )
      .sort(
        (a, b) =>
          b.priority - a.priority || b.successRate - a.successRate || b.hitCount - a.hitCount,
      );
    const rule = rules[0];
    if (rule) {
      return {
        domain,
        recommended: rule.target,
        confidence: Math.max(0.3, Math.min(1, rule.successRate / 100)),
        alternatives: rules.slice(1, topN).map((candidate) => candidate.target),
        source: 'nexus',
      };
    }
  } catch {
    // Nexus is an optional runtime source; preserve the legacy fallbacks.
  }
  const table = loadRoutingTable();

  // 1. Check overrides (highest priority — learned/high-priority routing).
  //    Overrides are matched against the FULL task text, not the derived
  //    domain, so "gdpr compliance audit" hits the gdpr→legal override even
  //    though matchDomain() would classify it as governance.
  if (table?.overrides) {
    for (const o of table.overrides) {
      const pattern = o.domainPattern.toLowerCase();
      if (
        taskHasKeyword(normalizedTask, pattern) ||
        taskHasKeyword(domain.toLowerCase(), pattern)
      ) {
        return {
          domain,
          recommended: o.targetAgent,
          confidence: o.confidence,
          alternatives: [],
          source: 'override',
        };
      }
    }
  }

  // 2. Check domain entries (learned performance)
  if (table?.domainEntries) {
    const entry = table.domainEntries.find((d) => d.domain.toLowerCase() === domain.toLowerCase());
    if (entry && entry.bestAgent) {
      return {
        domain,
        recommended: entry.bestAgent,
        confidence: entry.confidence,
        alternatives: (entry.alternatives || []).map((a) => a.agentId).slice(0, topN - 1),
        source: 'routing-table',
      };
    }
  }

  // 3. Fallback: static map (cold start)
  const candidates = STATIC_MAP[domain] || STATIC_MAP.general;
  return {
    domain,
    recommended: candidates[0],
    confidence: 0.3,
    alternatives: candidates.slice(1, topN),
    source: 'static-fallback',
  };
}

function parseArgs(argv: string[]): {
  task: string;
  domain: string;
  topN: number;
  refresh: boolean;
} {
  const args = { task: '', domain: '', topN: 3, refresh: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task' && argv[i + 1]) args.task = argv[++i];
    else if (argv[i] === '--domain' && argv[i + 1]) args.domain = argv[++i];
    else if (argv[i] === '--topn' && argv[i + 1]) args.topN = Number(argv[++i]);
    else if (argv[i] === '--refresh') args.refresh = true;
  }
  return args;
}

function main(): void {
  const { task, domain, topN, refresh } = parseArgs(process.argv);

  if (refresh) {
    try {
      runNpxTsxSync('src/orchestration/adaptive-router.ts', ['--build', '--quiet'], {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 30000,
      });
    } catch {
      // refresh failure is non-blocking
    }
  }

  const result = recommend(task, domain, topN);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { recommend };
