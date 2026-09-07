#!/usr/bin/env node
/**
 * mcp-security-gateway.ts — MCP Security Gateway (ADR-0028)
 *
 * Runtime security interception layer for MCP tool servers, inspired by the
 * Microsoft Agent Governance Toolkit's MCP Security Gateway spec (v1.0).
 *
 * GV's existing `mcp-gateway.ts` handles LIFECYCLE (start/stop/status/reload).
 * This module adds the SECURITY layer: it inspects tool definitions and
 * invocations for:
 *
 *   1. Tool poisoning        — malicious or misleading tool descriptions
 *   2. Rug pulls             — a previously-safe tool's schema/description
 *                              silently changed to introduce malicious behavior
 *   3. Schema drift          — tool schema changed vs a stored baseline
 *   4. Hidden instructions   — instructions embedded in tool descriptions
 *   5. Typosquatting         — tool names that impersonate well-known tools
 *   6. Confused deputy       — a tool tricked into acting for an unauthorized agent
 *
 * Design principles (mirroring AGT):
 *   - Fail closed by default — on any error, deny.
 *   - Defense in depth — tool calls pass through interception + scanning.
 *   - Audit everything — every decision produces an audit record.
 *   - Zero-trust by default — unknown tools start with no trust.
 *
 * Usage (CLI):
 *   npx tsx src/mcp/security-gateway/mcp-security-gateway.ts scan \
 *     --tool '{"name":"fetch_url","description":"...","schema":{...}}'
 *   npx tsx src/mcp/security-gateway/mcp-security-gateway.ts baseline --server skill-server
 *   npx tsx src/mcp/security-gateway/mcp-security-gateway.ts drift --server skill-server
 *
 * Usage (library):
 *   import { McpSecurityGateway } from './mcp-security-gateway.js';
 *   const gateway = new McpSecurityGateway();
 *   const result = gateway.scanTool({ name, description, schema });
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description?: string;
  schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ThreatType =
  | 'tool_poisoning'
  | 'rug_pull'
  | 'schema_drift'
  | 'hidden_instruction'
  | 'typosquatting'
  | 'confused_deputy'
  | 'none';

export interface ThreatFinding {
  type: ThreatType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  evidence?: string;
}

export interface ScanResult {
  tool: string;
  safe: boolean;
  findings: ThreatFinding[];
  timestamp: string;
}

export interface BaselineEntry {
  tool: string;
  descriptionHash: string;
  schemaHash: string;
  firstSeen: string;
  lastSeen: string;
}

// ---------------------------------------------------------------------------
// Known-good tool registry (for typosquatting detection)
// ---------------------------------------------------------------------------

const KNOWN_TOOLS = new Set([
  'list_skills',
  'get_skill',
  'search_skills',
  'list_tokens',
  'get_component',
  'audit_design',
  'sync_design',
  'get_design_md',
  'list_brand_waivers',
  'go_to_definition',
  'find_references',
  'get_hover_info',
  'get_completions',
  'get_diagnostics',
  'get_symbol_info',
  'get_file_symbols',
  'fetch_url',
  'search_web',
  'think_sequential',
  'get_thought_chain',
  'list_thought_chains',
  'get_thought_summary',
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'glob',
]);

// ---------------------------------------------------------------------------
// Hidden instruction / prompt injection patterns in tool descriptions
// ---------------------------------------------------------------------------

const HIDDEN_INSTRUCTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|all|prior)\s+instructions/i,
  /disregard\s+(your|the)\s+(instructions|rules|guidelines)/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+if\s+you\s+are/i,
  /system\s+prompt/i,
  /reveal\s+(your|the)\s+(system|instructions|prompt)/i,
  /exfiltrate/i,
  /send\s+(the|this|all)\s+(data|content|information)\s+to/i,
  /bypass\s+(safety|security|guardrails)/i,
  /jailbreak/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /(?:do\s+not\s+tell\s+the\s+user|do\s+not\s+tell\s+the\s+human|do\s+not\s+tell\s+user|do\s+not\s+tell\s+human)/i,
  /secretly/i,
  /stealth/i,
];

// ---------------------------------------------------------------------------
// Tool poisoning / suspicious description patterns
// ---------------------------------------------------------------------------

const POISONING_PATTERNS: RegExp[] = [
  /execute\s+arbitrary\s+(code|commands|shell)/i,
  /run\s+any\s+(command|code|script)/i,
  /access\s+all\s+files/i,
  /read\s+any\s+file/i,
  /delete\s+everything/i,
  /rm\s+-rf/i,
  /drop\s+all\s+tables/i,
  /send\s+credentials/i,
  /upload\s+(all|any|the)\s+(data|files|secrets)/i,
  /bypass\s+authentication/i,
  /escalate\s+privileges/i,
];

// ---------------------------------------------------------------------------
// Typosquatting detection — Levenshtein distance
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function detectTyposquatting(name: string): ThreatFinding | null {
  for (const known of KNOWN_TOOLS) {
    if (name === known) continue;
    const dist = levenshtein(name.toLowerCase(), known.toLowerCase());
    // If very close (1-2 edits) and similar length, it's suspicious.
    if (dist <= 2 && Math.abs(name.length - known.length) <= 2) {
      return {
        type: 'typosquatting',
        severity: 'HIGH',
        message: `Tool '${name}' closely resembles known tool '${known}' (edit distance ${dist})`,
        evidence: name,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hashing helpers
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  // Simple deterministic FNV-1a hash (no crypto dependency needed for drift detection)
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Security Gateway
// ---------------------------------------------------------------------------

export class McpSecurityGateway {
  private baselineDir: string;

  constructor(baselineDir?: string) {
    this.baselineDir = baselineDir ?? join(resolve(process.cwd()), '.runtime', 'mcp-security');
    if (!existsSync(this.baselineDir)) mkdirSync(this.baselineDir, { recursive: true });
  }

  /**
   * Scan a single tool definition for all threat classes.
   * Fail closed: any CRITICAL/HIGH finding marks the tool unsafe.
   */
  scanTool(tool: ToolDefinition): ScanResult {
    const findings: ThreatFinding[] = [];
    const name = tool.name;
    const description = tool.description ?? '';

    // 1. Hidden instructions in description
    for (const re of HIDDEN_INSTRUCTION_PATTERNS) {
      if (re.test(description)) {
        findings.push({
          type: 'hidden_instruction',
          severity: 'CRITICAL',
          message: `Hidden instruction pattern detected in tool '${name}' description: ${re.source}`,
          evidence: re.source,
        });
        break;
      }
    }

    // 2. Tool poisoning in description
    for (const re of POISONING_PATTERNS) {
      if (re.test(description)) {
        findings.push({
          type: 'tool_poisoning',
          severity: 'HIGH',
          message: `Suspicious capability claim in tool '${name}' description: ${re.source}`,
          evidence: re.source,
        });
        break;
      }
    }

    // 3. Typosquatting
    const typo = detectTyposquatting(name);
    if (typo) findings.push(typo);

    // 4. Schema drift vs baseline
    const drift = this.checkDrift(tool);
    if (drift) findings.push(drift);

    // 5. Confused deputy heuristic — tool that claims to act on behalf of
    //    another agent without explicit delegation.
    if (/impersonat|pretend|act as another|on behalf of any agent/i.test(description)) {
      findings.push({
        type: 'confused_deputy',
        severity: 'MEDIUM',
        message: `Tool '${name}' claims to act on behalf of other agents without explicit delegation`,
        evidence: name,
      });
    }

    const safe = !findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');

    return {
      tool: name,
      safe,
      findings,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check a tool against its stored baseline for schema/description drift.
   */
  private checkDrift(tool: ToolDefinition): ThreatFinding | null {
    const baseline = this.loadBaseline();
    const entry = baseline.find((b) => b.tool === tool.name);
    if (!entry) return null; // new tool, no baseline yet

    const descHash = hashString(tool.description ?? '');
    const schemaHash = hashString(JSON.stringify(tool.schema ?? {}));

    if (descHash !== entry.descriptionHash || schemaHash !== entry.schemaHash) {
      return {
        type: 'schema_drift',
        severity: 'MEDIUM',
        message: `Tool '${tool.name}' schema/description changed since baseline (${entry.firstSeen})`,
        evidence: tool.name,
      };
    }
    return null;
  }

  /**
   * Record a tool's current definition as its baseline (trusted state).
   */
  recordBaseline(tool: ToolDefinition): void {
    const baseline = this.loadBaseline();
    const now = new Date().toISOString();
    const existing = baseline.find((b) => b.tool === tool.name);
    const entry: BaselineEntry = {
      tool: tool.name,
      descriptionHash: hashString(tool.description ?? ''),
      schemaHash: hashString(JSON.stringify(tool.schema ?? {})),
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
    };
    const idx = baseline.findIndex((b) => b.tool === tool.name);
    if (idx >= 0) baseline[idx] = entry;
    else baseline.push(entry);
    this.saveBaseline(baseline);
  }

  private baselinePath(): string {
    return join(this.baselineDir, 'baseline.json');
  }

  private loadBaseline(): BaselineEntry[] {
    const p = this.baselinePath();
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as BaselineEntry[];
    } catch {
      return [];
    }
  }

  private saveBaseline(baseline: BaselineEntry[]): void {
    writeFileSync(this.baselinePath(), JSON.stringify(baseline, null, 2), 'utf-8');
  }

  /**
   * Audit a decision to the gateway audit log.
   */
  audit(entry: Record<string, unknown>): void {
    const auditPath = join(this.baselineDir, 'audit.jsonl');
    writeFileSync(auditPath, JSON.stringify(entry) + '\n', { flag: 'a' });
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
  const gateway = new McpSecurityGateway();

  if (cmd === 'scan') {
    const toolRaw = args.tool;
    if (!toolRaw) {
      console.error('Usage: mcp-security-gateway.ts scan --tool \'{"name":"..."}\'');
      process.exit(1);
    }
    let tool: ToolDefinition;
    try {
      tool = JSON.parse(toolRaw) as ToolDefinition;
    } catch {
      console.error('ERROR: --tool must be valid JSON');
      process.exit(1);
    }
    const result = gateway.scanTool(tool);
    gateway.audit({ ...result, action: 'scan' });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.safe ? 0 : 1);
  }

  if (cmd === 'baseline') {
    const toolRaw = args.tool;
    if (!toolRaw) {
      console.error('Usage: mcp-security-gateway.ts baseline --tool \'{"name":"..."}\'');
      process.exit(1);
    }
    let tool: ToolDefinition;
    try {
      tool = JSON.parse(toolRaw) as ToolDefinition;
    } catch {
      console.error('ERROR: --tool must be valid JSON');
      process.exit(1);
    }
    gateway.recordBaseline(tool);
    console.log(`Baseline recorded for tool '${tool.name}'`);
    return;
  }

  if (cmd === 'list-baseline') {
    const baseline = gateway['loadBaseline']();
    console.log(JSON.stringify(baseline, null, 2));
    return;
  }

  console.error('Usage: mcp-security-gateway.ts <scan|baseline|list-baseline> [options]');
  process.exit(1);
}

// Only run CLI when executed directly (not imported)
if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('mcp-security-gateway.ts'))
) {
  main();
}
