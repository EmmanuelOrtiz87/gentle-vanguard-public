#!/usr/bin/env node
/**
 * agent-governance-integration.ts — Agent Governance Integration Facade
 *
 * Unifies the three native Agent Governance capabilities (ADR-0027/0028/0029)
 * into a single, operable entry point for the Gentle-Vanguard stack:
 *
 *   1. Policy Engine (ADR-0027)      — deterministic fail-closed action gate
 *   2. MCP Security Gateway (ADR-0028) — runtime tool-poisoning/rug-pull scanner
 *   3. OWASP Agentic AI Top 10 (ADR-0029) — compliance mapping + coverage scoring
 *
 * This module does NOT duplicate logic — it delegates to the three source
 * modules and composes their results into a consolidated governance report.
 * It also exposes a programmatic API so the orchestrator / security flow can
 * call a single `checkGovernance()` before executing any agent action.
 *
 * Design principles:
 *   - Surgical: existing modules are untouched; this is a thin composition layer.
 *   - Fail closed: any CRITICAL finding or denied policy blocks the action.
 *   - Operable: `npm run governance:check` runs the full gate from the CLI.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { PolicyEngine, type PolicyEvaluationRequest, type PolicyEvaluationResult } from './policy-engine/policy-engine.js';
import { McpSecurityGateway, type ToolDefinition, type ScanResult } from '../mcp/security-gateway/mcp-security-gateway.js';
import { generateReport, type OwaspReport } from './owasp/owasp-agentic-top10.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GovernanceCheckInput {
  /** The action to evaluate (canonical `{ action, params }` or legacy `{ type, target, tool }`). */
  action?: PolicyEvaluationRequest | Record<string, unknown>;
  /** MCP tool definitions to scan (optional). */
  tools?: ToolDefinition[];
  /** Whether to enforce strict OWASP coverage (default false). */
  strictOwasp?: boolean;
}

export interface GovernanceCheckResult {
  timestamp: string;
  /** Overall verdict: 'allow' | 'deny' | 'review'. */
  verdict: 'allow' | 'deny' | 'review';
  /** True if the action should proceed. */
  proceed: boolean;
  policy: PolicyEvaluationResult | null;
  toolScans: ScanResult[];
  owasp: OwaspReport | null;
  /** Human-readable summary of what was checked. */
  summary: string[];
}

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

export class AgentGovernance {
  private readonly policyEngine: PolicyEngine;
  private readonly securityGateway: McpSecurityGateway;
  private readonly stateDir: string;

  constructor(stateDir?: string) {
    this.policyEngine = new PolicyEngine([join(resolve(process.cwd()), 'config', 'policies', 'gv-core-tool-safety.yaml')]);
    this.securityGateway = new McpSecurityGateway(stateDir ?? join(resolve(process.cwd()), '.runtime', 'mcp-security'));
    this.stateDir = stateDir ?? join(resolve(process.cwd()), '.runtime', 'mcp-security');
  }

  /**
   * Run the full governance gate over an action and/or MCP tools.
   *
   * Verdict logic (fail closed):
   *   - deny   -> policy denied the action, OR any tool scan is unsafe (CRITICAL/HIGH)
   *   - review -> policy requires approval, OR strict OWASP coverage failed
   *   - allow  -> everything passed
   */
  checkGovernance(input: GovernanceCheckInput = {}): GovernanceCheckResult {
    const summary: string[] = [];
    let verdict: GovernanceCheckResult['verdict'] = 'allow';

    // 1. Policy engine
    let policy: PolicyEvaluationResult | null = null;
    if (input.action) {
      policy = this.policyEngine.evaluate(input.action);
      if (policy.action === 'deny') {
        verdict = 'deny';
        summary.push(`POLICY DENY: ${policy.reason ?? 'no policy allows this action'}`);
      } else if (policy.action === 'require_approval') {
        verdict = 'review';
        summary.push(`POLICY REVIEW: action requires human approval`);
      } else {
        summary.push(`POLICY ALLOW: action permitted by ${policy.matchedRule ?? 'default'}`);
      }
    }

    // 2. MCP security gateway
    const toolScans: ScanResult[] = [];
    if (input.tools && input.tools.length > 0) {
      for (const tool of input.tools) {
        const scan = this.securityGateway.scanTool(tool);
        toolScans.push(scan);
        if (!scan.safe) {
          verdict = 'deny';
          summary.push(`TOOL UNSAFE: ${tool.name} (${scan.findings.map((f) => f.type).join(', ')})`);
        }
      }
      if (toolScans.length > 0 && toolScans.every((s) => s.safe)) {
        summary.push(`TOOLS SAFE: ${toolScans.length} tool(s) scanned, no threats`);
      }
    }

    // 3. OWASP coverage
    let owasp: OwaspReport | null = null;
    if (input.strictOwasp) {
      owasp = generateReport(true);
      if (!owasp.strictPass) {
        if (verdict === 'allow') verdict = 'review';
        summary.push(`OWASP STRICT FAIL: coverage ${owasp.overallCoverage}% (< 80%)`);
      } else {
        summary.push(`OWASP STRICT PASS: coverage ${owasp.overallCoverage}%`);
      }
    }

    const proceed = verdict === 'allow';
    return { timestamp: new Date().toISOString(), verdict, proceed, policy, toolScans, owasp, summary };
  }

  /** Persist the last governance check to the state dir for audit. */
  persist(result: GovernanceCheckResult): string {
    if (!existsSync(this.stateDir)) mkdirSync(this.stateDir, { recursive: true });
    const file = join(this.stateDir, 'governance-audit.jsonl');
    writeFileSync(file, JSON.stringify(result) + '\n', { flag: 'a', encoding: 'utf-8' });
    return file;
  }
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

  const gov = new AgentGovernance();

  if (cmd === 'check') {
    const input: GovernanceCheckInput = {};
    if (args.action) {
      try {
        input.action = JSON.parse(args.action) as PolicyEvaluationRequest;
      } catch {
        console.error('ERROR: --action must be valid JSON');
        process.exit(1);
      }
    }
    if (args.tools) {
      try {
        input.tools = JSON.parse(args.tools) as ToolDefinition[];
      } catch {
        console.error('ERROR: --tools must be valid JSON array');
        process.exit(1);
      }
    }
    input.strictOwasp = args.strict === 'true' || args.strict === '1';

    const result = gov.checkGovernance(input);
    const auditFile = gov.persist(result);
    console.log(JSON.stringify({ ...result, auditFile }, null, 2));
    process.exit(result.proceed ? 0 : 1);
  }

  if (cmd === 'owasp') {
    const report = generateReport(args.strict === 'true' || args.strict === '1');
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.error(`Agent Governance Integration
Usage:
  agent-governance-integration check [--action '<json>'] [--tools '<json>'] [--strict true]
  agent-governance-integration owasp [--strict true]
`);
  process.exit(1);
}

// Only run CLI when executed directly (not imported)
if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('agent-governance-integration.ts'))
) {
  main();
}
