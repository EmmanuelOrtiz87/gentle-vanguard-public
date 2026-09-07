#!/usr/bin/env node
/**
 * Policy Engine Core — Deterministic Policy Enforcement
 *
 * Intercepts tool calls BEFORE execution and evaluates them against
 * declarative policies. Actions denied by policy are STRUCTURALLY
 * IMPOSSIBLE to execute.
 *
 * USAGE:
 *   import { govern, PolicyEngine } from './policy-engine.js';
 *
 *   // Single statement API
 *   const safeTool = govern(myTool, { policyPath: 'policies/shell.yaml' });
 *
 *   // Programmatic API
 *   const engine = new PolicyEngine(['policies/*.yaml']);
 *   const result = engine.evaluate({ action: 'shell_exec', params: { cmd: 'ls' }});
 *   if (result.action === 'deny') throw new GovernanceDenied(result.reason);
 *
 * ARCHITECTURE:
 *   ┌─────────────┐    ┌──────────────┐    ┌────────────────┐
 *   │ Tool Call   │───▶│ Policy Check │───▶│ Allow / Deny   │
 *   └─────────────┘    └──────────────┘    └────────────────┘
 *
 * DESIGN PRINCIPLES:
 *   - Fail-closed: policy parse error → DENY
 *   - Deterministic: same input → same output (no LLM involved)
 *   - Observable: every decision logged to audit trail
 *   - Composable: policies can import and extend other policies
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export type PolicyAction = 'allow' | 'deny' | 'require_approval' | 'audit';

export interface PolicyRule {
  /** Human-readable rule name */
  name: string;

  /** CEL (Common Expression Language) condition */
  condition: string;

  /** Action when condition matches */
  action: PolicyAction;

  /** Optional approvers for require_approval */
  approvers?: string[];

  /** Human-readable description */
  description?: string;

  /** Rule priority (higher = evaluated first) */
  priority?: number;

  /** Whether this rule can override default */
  overrideDefault?: boolean;
}

export interface Policy {
  apiVersion: string;
  kind: 'Policy';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: {
    /** Default action when no rules match */
    defaultAction: PolicyAction;

    /** Ordered list of rules (evaluated top-down) */
    rules: PolicyRule[];

    /** Inherited policies to include */
    extends?: string[];
  };
}

export interface PolicyEvaluationRequest {
  /** Tool/action name */
  action: string;

  /** Tool parameters */
  params: Record<string, unknown>;

  /** Request context (user, time, etc.) */
  context?: PolicyContext;

  /** Unique request ID for tracing */
  requestId?: string;
}

export interface PolicyContext {
  /** User making the request */
  user?: string;

  /** Timestamp */
  timestamp?: string;

  /** Source process/pid */
  source?: string;

  /** Extra context fields */
  [key: string]: unknown;
}

export interface PolicyEvaluationResult {
  /** Final decision */
  action: PolicyAction;

  /** Matching rule (if any) */
  matchedRule?: string;

  /** Human-readable explanation */
  reason: string;

  /** Request was evaluated */
  evaluated: boolean;

  /** Unique decision ID for audit */
  decisionId: string;

  /** Timestamp of evaluation */
  timestamp: string;

  /** Approvers required (if action=require_approval) */
  approvers?: string[];

  /** Policy version used */
  policyVersion: string;

  /** Legacy aliases (backward compat with pre-ADR API): derived from `action`. */
  allowed?: boolean;
  denied?: boolean;
  requiresApproval?: boolean;
}

export interface GovernOptions {
  /** Path to policy YAML file */
  policyPath?: string;

  /** Inline policy object */
  policy?: Policy;

  /** Optional audit log path */
  auditLogPath?: string;

  /** Whether to cache parsed policies */
  cachePolicies?: boolean;

  /** Custom rule evaluators */
  customEvaluators?: Record<string, RuleEvaluator>;
}

export type RuleEvaluator = (condition: string, request: PolicyEvaluationRequest) => boolean;

// Custom error for policy violations
export class GovernanceDenied extends Error {
  constructor(
    message: string,
    public readonly rule: string,
    public readonly decisionId: string,
    public readonly request?: PolicyEvaluationRequest,
  ) {
    super(message);
    this.name = 'GovernanceDenied';
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(CURRENT_DIR, '..', '..', '..');
const DEFAULT_AUDIT_LOG = join(ROOT, '.runtime', 'policy-audit.jsonl');
const POLICY_CACHE = new Map<string, { policy: Policy; hash: string; mtime: number }>();

// Built-in rule evaluators (CEL-like expressions)
const BUILTIN_EVALUATORS: Record<string, RuleEvaluator> = {
  // Simple equality: action.type == 'send_email'
  'action\.type\s*==?\s*[\'"]([^\'"]+)[\'"]': (condition, request) => {
    const match = condition.match(/action\.type\s*==?\s*[\'"]([^\'"]+)[\'"]/);
    if (!match) return false;
    return request.action === match[1];
  },

  // In array: action.type in ['drop', 'delete']
  'action\.type\s+in\s+\[([^\]]+)\]': (condition, request) => {
    const match = condition.match(/action\.type\s+in\s+\[([^\]]+)\]/);
    if (!match) return false;
    const values = match[1].split(',').map((v) => v.trim().replace(/['"]/g, ''));
    return values.includes(request.action);
  },

  // Contains: user.role contains 'admin'
  'contains\(([\w.]+),\s*[\'"]([^\'"]+)[\'"]\)': (condition, request) => {
    const match = condition.match(/contains\(([\w.]+),\s*[\'"]([^\'"]+)[\'"]\)/);
    if (!match) return false;
    const path = match[1].split('.');
    const search = match[2];
    let value: unknown = request;
    for (const key of path) {
      value = (value as Record<string, unknown>)?.[key];
    }
    if (typeof value === 'string') return value.includes(search);
    if (Array.isArray(value)) return value.some((item) => String(item).includes(search));
    return false;
  },

  // Regex match: params.cmd matches '/rm\s+-rf/'
  'matches?\(([\w.]+),\s*\/([^\/]+)\/\)': (condition, request) => {
    const match = condition.match(/matches?\(([\w.]+),\s*\/([^\/]+)\/\)/);
    if (!match) return false;
    const path = match[1].split('.');
    const pattern = new RegExp(match[2]);
    let value: unknown = request;
    for (const key of path) {
      value = (value as Record<string, unknown>)?.[key];
    }
    return typeof value === 'string' && pattern.test(value);
  },

  // Starts with: action.name startsWith 'dangerous_'
  'startsWith\(([\w.]+),\s*[\'"]([^\'"]+)[\'"]\)': (condition, request) => {
    const match = condition.match(/startsWith\(([\w.]+),\s*[\'"]([^\'"]+)[\'"]\)/);
    if (!match) return false;
    const path = match[1].split('.');
    const prefix = match[2];
    let value: unknown = request;
    for (const key of path) {
      value = (value as Record<string, unknown>)?.[key];
    }
    return typeof value === 'string' && value.startsWith(prefix);
  },

  // Greater than: params.port > 1024
  '([\w.]+)\s*>\s*(\d+)': (condition, request) => {
    const match = condition.match(/([\w.]+)\s*>\s*(\d+)/);
    if (!match) return false;
    const path = match[1].split('.');
    const threshold = parseInt(match[2], 10);
    let value: unknown = request;
    for (const key of path) {
      value = (value as Record<string, unknown>)?.[key];
    }
    return typeof value === 'number' && value > threshold;
  },
};

// =============================================================================
// LEGACY-COMPAT LAYER (pre-ADR API: { type, target, tool } + evaluateCondition)
// =============================================================================

/** Legacy action shape used by tests and older callers. */
export interface LegacyAction {
  type?: string;
  target?: string;
  tool?: string;
  [key: string]: unknown;
}

/**
 * Normalize any caller input (new `{ action, params }` or legacy
 * `{ type, target, tool }`) into a canonical PolicyEvaluationRequest.
 * Always fail-closed: unknown shapes map to a deny-safe request.
 */
export function normalizeRequest(
  input: PolicyEvaluationRequest | Record<string, unknown>,
): PolicyEvaluationRequest {
  const rec = (input ?? {}) as Record<string, unknown>;
  if (typeof rec.action === 'string') {
    const params = (rec.params as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...params };
    // Promote legacy top-level fields into params so conditions resolve.
    for (const k of ['type', 'target', 'tool']) {
      if (rec[k] !== undefined && merged[k] === undefined) merged[k] = rec[k];
    }
    // Mirror canonical action into params for `action.type`-style conditions.
    if (merged.type === undefined) merged.type = rec.action;
    return {
      action: rec.action,
      params: merged,
      context: rec.context as PolicyEvaluationRequest['context'],
      requestId: rec.requestId as string | undefined,
    };
  }
  const type = typeof rec.type === 'string' ? (rec.type as string) : 'unknown';
  const params: Record<string, unknown> = { type };
  for (const k of ['target', 'tool']) {
    if (rec[k] !== undefined) params[k] = rec[k];
  }
  // Carry any extra legacy fields through.
  for (const [k, v] of Object.entries(rec)) {
    if (!(k in params) && k !== 'type') params[k] = v;
  }
  return { action: type, params };
}

/** Build the `{ type, target, tool }` view that legacy conditions address. */
function toConditionView(request: PolicyEvaluationRequest): Record<string, unknown> {
  const p = request.params ?? {};
  return {
    type: request.action ?? (p.type as string | undefined),
    target: p.target,
    tool: p.tool,
    action: request.action,
    params: p,
  };
}

function getViewValue(path: string, view: Record<string, unknown>): unknown {
  // `action.type` / `action.target` / `action.tool` address the legacy view.
  const normalized = path.startsWith('action.') ? path.slice('action.'.length) : path;
  const keys = normalized.split('.');
  let value: unknown = view;
  for (const key of keys) {
    value = (value as Record<string, unknown>)?.[key];
  }
  return value;
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter((v) => v.length > 0);
}

function evalSingleCondition(condition: string, view: Record<string, unknown>): boolean | null {
  const cond = condition.trim();

  // `X not in [...]`
  let m = cond.match(/^([\w.]+)\s+not\s+in\s+\[([^\]]*)\]$/);
  if (m) {
    const value = getViewValue(m[1], view);
    return !parseList(m[2]).includes(String(value));
  }

  // `X in [...]`
  m = cond.match(/^([\w.]+)\s+in\s+\[([^\]]*)\]$/);
  if (m) {
    const value = getViewValue(m[1], view);
    return parseList(m[2]).includes(String(value));
  }

  // `X matches 'regex'`
  m = cond.match(/^([\w.]+)\s+matches\s+'([^']*)'$/);
  if (m) {
    const value = getViewValue(m[1], view);
    if (typeof value !== 'string') return false;
    try {
      return new RegExp(m[2]).test(value);
    } catch {
      return false;
    }
  }

  // `X == 'v'` / `X != 'v'`
  m = cond.match(/^([\w.]+)\s*(==|===|!=|!==)\s*'([^']*)'$/);
  if (m) {
    const value = getViewValue(m[1], view);
    const expected = m[3];
    const eq = String(value) === expected;
    return m[2].startsWith('!') ? !eq : eq;
  }

  // Unsupported predicate -> fail closed (no match). Covers `>`, `startsWith()`, etc.
  return null;
}

/**
 * Evaluate a legacy CEL-like condition string against a `{ type, target, tool }`
 * action object. Supports `in`, `not in`, `==`, `!=`, `matches` plus `and`/`or`
 * combinators. Unknown predicates return false (fail closed).
 */
export function evaluateCondition(
  condition: string,
  action: Record<string, unknown>,
): boolean {
  const view: Record<string, unknown> = { ...(action ?? {}) };
  const orParts = condition.split(/\s+or\s+/);
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateCondition(part, action));
  }
  const andParts = condition.split(/\s+and\s+/);
  if (andParts.length > 1) {
    return andParts.every((part) => {
      const r = evalSingleCondition(part, view);
      return r === true;
    });
  }
  return evalSingleCondition(condition, view) === true;
}

/** Load the declarative default config (`config/policy-engine.json`). */
export function loadDefaultConfig(): { policies: unknown[]; failClosed: boolean; defaultAction: string } {
  try {
    const raw = readFileSync(join(ROOT, 'config', 'policy-engine.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { policies?: unknown[]; failClosed?: boolean; defaultAction?: string };
    return {
      policies: Array.isArray(parsed.policies) ? parsed.policies : [],
      failClosed: parsed.failClosed !== false,
      defaultAction: typeof parsed.defaultAction === 'string' ? parsed.defaultAction : 'deny',
    };
  } catch {
    return { policies: [], failClosed: true, defaultAction: 'deny' };
  }
}

// =============================================================================
// AUDIT LOGGING
// =============================================================================

function initializeAuditLog(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function logAuditDecision(result: PolicyEvaluationResult, request: PolicyEvaluationRequest, logPath: string): void {
  const entry = {
    timestamp: new Date().toISOString(),
    decisionId: result.decisionId,
    action: result.action,
    matchedRule: result.matchedRule,
    reason: result.reason,
    policyVersion: result.policyVersion,
    request: {
      action: request.action,
      params: request.params,
      context: request.context,
      requestId: request.requestId,
    },
  };

  try {
    writeFileSync(logPath, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch {
    // Non-blocking: audit failure shouldn't prevent execution
    console.warn('[PolicyEngine] Failed to write audit log:', logPath);
  }
}

// =============================================================================
// POLICY LOADING & PARSING
// =============================================================================

export function loadPolicy(path: string): Policy {
  // Check cache
  const cached = POLICY_CACHE.get(path);
  const stats = existsSync(path) ? readFileSync(path) : null;
  const mtime = stats ? Date.now() : 0;

  if (cached && cached.mtime === mtime) {
    return cached.policy;
  }

  // Load and parse
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to load policy: ${path} - ${error}`);
  }

  // Parse YAML (simplified - use regex for basic structure)
  const policy = parseYamlPolicy(content, path);

  // Update cache
  const hash = createHash('sha256').update(content).digest('hex');
  POLICY_CACHE.set(path, { policy, hash, mtime });

  return policy;
}

function parseYamlPolicy(content: string, path: string): Policy {
  // Simplified YAML parser for policy structure
  // In production, use a proper YAML parser like js-yaml

  const lines = content.split('\n');
  let currentRule: Partial<PolicyRule> = {};
  let inRules = false;

  const policy: Policy = {
    apiVersion: '',
    kind: 'Policy',
    metadata: { name: '' },
    spec: {
      defaultAction: 'allow',
      rules: [],
    },
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Top-level fields
    if (trimmed.startsWith('apiVersion:')) {
      policy.apiVersion = trimmed.split(':')[1].trim();
    } else if (trimmed.startsWith('name:')) {
      policy.metadata.name = trimmed.split(':')[1].trim().replace(/['"]/g, '');
    } else if (trimmed.startsWith('defaultAction:')) {
      const action = trimmed.split(':')[1].trim().toLowerCase() as PolicyAction;
      if (['allow', 'deny', 'require_approval', 'audit'].includes(action)) {
        policy.spec.defaultAction = action;
      }
    } else if (trimmed === 'rules:') {
      inRules = true;
    } else if (inRules) {
      // Parse rules
      if (trimmed.startsWith('- name:')) {
        // Save previous rule if exists
        if (currentRule.name) {
          policy.spec.rules.push(currentRule as PolicyRule);
        }
        currentRule = { name: trimmed.split(':')[1].trim().replace(/['"]/g, '') };
      } else if (trimmed.startsWith('condition:')) {
        currentRule.condition = trimmed.split(':').slice(1).join(':').trim();
      } else if (trimmed.startsWith('action:')) {
        const action = trimmed.split(':')[1].trim().toLowerCase() as PolicyAction;
        currentRule.action = action;
      } else if (trimmed.startsWith('description:')) {
        currentRule.description = trimmed.split(':').slice(1).join(':').trim().replace(/^['"]|[\'"]$/g, '');
      } else if (trimmed.startsWith('priority:')) {
        currentRule.priority = parseInt(trimmed.split(':')[1].trim(), 10) || 0;
      } else if (trimmed.startsWith('approvers:')) {
        // Handle inline approvers: ["user1", "user2"]
        const match = trimmed.match(/\[([^\]]+)\]/);
        if (match) {
          currentRule.approvers = match[1].split(',').map((a) => a.trim().replace(/['"]/g, ''));
        }
      } else if (trimmed.startsWith('- ') && currentRule.approvers) {
        // Handle list format approvers
        const approver = trimmed.replace(/^- /, '').trim().replace(/['"]/g, '');
        if (!currentRule.approvers.includes(approver)) {
          currentRule.approvers.push(approver);
        }
      }
    }
  }

  // Save last rule
  if (currentRule.name) {
    policy.spec.rules.push(currentRule as PolicyRule);
  }

  // Sort rules by priority (higher first)
  policy.spec.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Validate
  if (!policy.apiVersion || !policy.metadata.name) {
    throw new Error(`Invalid policy file: ${path} - missing required fields`);
  }

  return policy;
}

// =============================================================================
// POLICY ENGINE CLASS
// =============================================================================

export class PolicyEngine {
  private policies: Map<string, Policy> = new Map();
  private auditLogPath: string;
  private customEvaluators: Record<string, RuleEvaluator>;

  constructor(
    policyPaths?: string[],
    options: Omit<GovernOptions, 'policyPath'> = {},
  ) {
    this.auditLogPath = options.auditLogPath || DEFAULT_AUDIT_LOG;
    this.customEvaluators = { ...BUILTIN_EVALUATORS, ...(options.customEvaluators || {}) };

    // Initialize audit log
    initializeAuditLog(this.auditLogPath);

    // Default to the native core tool-safety policy when no paths are given
    // (backward compat: `new PolicyEngine()` keeps working).
    const paths = policyPaths && policyPaths.length > 0
      ? policyPaths
      : [join(ROOT, 'config', 'policies', 'gv-core-tool-safety.yaml')];

    // Load all policies
    for (const path of paths) {
      this.loadPolicyFromPath(path);
    }
  }

  private loadPolicyFromPath(path: string): void {
    try {
      const policy = loadPolicy(path);
      this.policies.set(policy.metadata.name, policy);
    } catch (error) {
      console.error(`[PolicyEngine] Failed to load policy ${path}:`, error);
      // Fail-open warning: log error but don't crash
    }
  }

  /**
   * Evaluate a tool call against loaded policies.
   * Accepts both the canonical `{ action, params }` shape and the legacy
   * `{ type, target, tool }` shape (normalized internally, fail closed).
   */
  evaluate(request: PolicyEvaluationRequest | Record<string, unknown>): PolicyEvaluationResult {
    const normalized = normalizeRequest(request);
    const decisionId = `dec-${createHash('sha256').update(Date.now().toString()).digest('hex').slice(0, 16)}`;

    // Default result (fail-closed: deny if no policies)
    let result: PolicyEvaluationResult = {
      action: this.policies.size === 0 ? 'allow' : 'deny',
      reason: this.policies.size === 0
        ? 'No policies configured - defaulting to allow'
        : 'No policies matched - fail-closed',
      evaluated: true,
      decisionId,
      timestamp: new Date().toISOString(),
      policyVersion: 'none',
    };

    // Evaluate against all policies
    for (const [name, policy] of this.policies) {
      const policyResult = this.evaluateAgainstPolicy(policy, normalized);

      // If policy denies, use that result
      if (policyResult.action === 'deny') {
        result = { ...policyResult, decisionId, policyVersion: name, timestamp: new Date().toISOString() };
        break;
      }

      // If policy requires approval
      if (policyResult.action === 'require_approval') {
        result = { ...policyResult, decisionId, policyVersion: name, timestamp: new Date().toISOString() };
        // Continue to check for stricter policies
        continue;
      }

      // Policy allows - update result (but keep checking)
      if (policyResult.action === 'allow' && result.action !== 'require_approval') {
        result = { ...policyResult, decisionId, policyVersion: name, timestamp: new Date().toISOString() };
      }
    }

    // Legacy aliases so pre-ADR callers keep working.
    result.allowed = result.action === 'allow';
    result.denied = result.action === 'deny';
    result.requiresApproval = result.action === 'require_approval';

    // Log to audit
    logAuditDecision(result, normalized, this.auditLogPath);

    return result;
  }

  private evaluateAgainstPolicy(policy: Policy, request: PolicyEvaluationRequest): Omit<Partial<PolicyEvaluationResult>, 'action' | 'reason' | 'evaluated'> & { action: PolicyAction; reason: string; evaluated: boolean } {
    // Check each rule in priority order
    for (const rule of policy.spec.rules) {
      if (this.evaluateRule(rule, request)) {
        return {
          action: rule.action,
          matchedRule: rule.name,
          reason: rule.description || `Matched rule: ${rule.name}`,
          evaluated: true,
          approvers: rule.approvers,
        };
      }
    }

    // No rules matched - use default
    return {
      action: policy.spec.defaultAction,
      reason: `No rules matched - default action: ${policy.spec.defaultAction}`,
      evaluated: true,
    };
  }

  private evaluateRule(rule: PolicyRule, request: PolicyEvaluationRequest): boolean {
    const condition = rule.condition;

    // Primary: unified legacy-condition evaluator against the
    // `{ type, target, tool }` view (handles in / not in / == / matches / and / or).
    try {
      if (evaluateCondition(condition, toConditionView(request))) {
        return true;
      }
    } catch {
      // Fall through to evaluator chain below.
    }

    // Compound conditions (and/or) are fully decided by the unified evaluator
    // above. Falling through here would let single-clause evaluators match only
    // the first clause and ignore the rest (fail-open) — never allow that.
    if (/\s+(and|or)\s+/.test(condition)) {
      return false;
    }

    // Try each evaluator
    for (const evaluator of Object.values(this.customEvaluators)) {
      try {
        if (evaluator(condition, request)) {
          return true;
        }
      } catch {
        // Evaluator doesn't match this condition, try next
        continue;
      }
    }

    // Try advanced expression evaluation
    return this.evaluateExpression(condition, request);
  }

  private evaluateExpression(condition: string, request: PolicyEvaluationRequest): boolean {
    // Simple expression evaluation
    // Supports: action.type, params.*, context.*

    // Handle 'true' / 'false' literals
    if (condition.trim() === 'true') return true;
    if (condition.trim() === 'false') return false;

    // Handle basic comparisons
    const parts = condition.split(/\s+/);
    if (parts.length === 3) {
      const [left, op, right] = parts;
      const leftVal = this.getValueFromRequest(left, request);
      const rightVal = right.replace(/['"]/g, ''); // Remove quotes

      switch (op) {
        case '==':
        case '===':
          return leftVal === rightVal;
        case '!=':
        case '!==':
          return leftVal !== rightVal;
        case '>':
          return Number(leftVal) > Number(rightVal);
        case '<':
          return Number(leftVal) < Number(rightVal);
        case '>=':
          return Number(leftVal) >= Number(rightVal);
        case '<=':
          return Number(leftVal) <= Number(rightVal);
      }
    }

    // If we can't evaluate, default to false (no match)
    return false;
  }

  private getValueFromRequest(path: string, request: PolicyEvaluationRequest): unknown {
    const keys = path.split('.');
    let value: unknown = request;
    for (const key of keys) {
      value = (value as Record<string, unknown>)?.[key];
    }
    return value;
  }

  /**
   * Get loaded policies info
   */
  getPoliciesInfo(): Array<{ name: string; ruleCount: number; defaultAction: PolicyAction }> {
    return Array.from(this.policies.entries()).map(([name, policy]) => ({
      name,
      ruleCount: policy.spec.rules.length,
      defaultAction: policy.spec.defaultAction,
    }));
  }
}

// =============================================================================
// GOVERN FUNCTION (Single Statement API)
// =============================================================================

/**
 * Wrap a tool function with policy enforcement
 *
 * USAGE:
 *   const safeTool = govern(myTool, { policyPath: 'policies/shell.yaml' });
 *   safeTool({ cmd: 'ls' });  // Evaluated against policy
 */
export function govern<T extends (...args: any[]) => any>(
  toolFn: T,
  options: GovernOptions,
): T {
  // Load policy
  let engine: PolicyEngine;
  if (options.policyPath) {
    engine = new PolicyEngine([options.policyPath], options);
  } else if (options.policy) {
    // Create engine with inline policy
    const tempPath = `/tmp/inline-policy-${Date.now()}.yaml`;
    engine = new PolicyEngine([tempPath], options);
    // Inject inline policy
    (engine as any).policies.set(options.policy.metadata.name, options.policy);
  } else {
    throw new Error('Either policyPath or policy must be provided');
  }

  // Return wrapped function
  return ((...args: Parameters<T>): ReturnType<T> => {
    // Build request from arguments
    const request: PolicyEvaluationRequest = {
      action: toolFn.name || 'anonymous',
      params: args[0] || {},
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    // Evaluate policy
    const result = engine.evaluate(request);

    // Handle result
    switch (result.action) {
      case 'allow':
        return toolFn(...args);

      case 'deny':
        throw new GovernanceDenied(
          `Governance Denied: ${result.reason}${result.matchedRule ? ` (Rule: ${result.matchedRule})` : ''}`,
          result.matchedRule || 'unknown',
          result.decisionId,
          request,
        );

      case 'require_approval':
        throw new GovernanceDenied(
          `Governance Denied (Approval Required): ${result.reason}. Approvers: ${result.approvers?.join(', ') || 'none'}`,
          result.matchedRule || 'approval-required',
          result.decisionId,
          request,
        );

      case 'audit':
        // Allow but audit is already logged
        return toolFn(...args);

      default:
        return toolFn(...args);
    }
  }) as T;
}

// =============================================================================
// CLI
// =============================================================================

function cli(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'eval': {
      const policyIndex = args.indexOf('--policy');
      const actionIndex = args.indexOf('--action');

      if (policyIndex === -1 || actionIndex === -1) {
        console.error('Usage: eval --policy <path> --action "<json>"');
        process.exit(1);
      }

      const policyPath = args[policyIndex + 1];
      const actionJson = args[actionIndex + 1];

      try {
        const request: PolicyEvaluationRequest = JSON.parse(actionJson);
        const engine = new PolicyEngine([policyPath]);
        const result = engine.evaluate(request);

        console.log('\n=== Policy Evaluation Result ===\n');
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Error:', error);
        process.exit(1);
      }
      break;
    }

    case 'lint': {
      const path = args[1];
      if (!path) {
        console.error('Usage: lint <policy-path>');
        process.exit(1);
      }

      try {
        loadPolicy(path);
        console.log(`✓ Policy file is valid: ${path}`);
      } catch (error) {
        console.error(`✗ Policy file invalid: ${path}`);
        console.error(error);
        process.exit(1);
      }
      break;
    }

    case 'list': {
      const paths = args.slice(1);
      if (paths.length === 0) {
        console.error('Usage: list <policy-path> [<policy-path>...]');
        process.exit(1);
      }

      const engine = new PolicyEngine(paths);
      const info = engine.getPoliciesInfo();

      console.log('\n=== Loaded Policies ===\n');
      for (const policy of info) {
        console.log(`${policy.name}:`);
        console.log(`  Rules: ${policy.ruleCount}`);
        console.log(`  Default: ${policy.defaultAction}`);
      }
      break;
    }

    default:
      console.log(`
Policy Engine v1.0 — Deterministic Governance

Commands:
  eval --policy <path> --action '<json>'
    Evaluate an action against a policy
    Example: eval --policy policies/shell.yaml --action '{"action":"shell_exec","params":{"cmd":"ls"}}'

  lint <policy-path>
    Validate a policy file

  list <policy-path> [<policy-path>...]
    List loaded policies

Examples:
  # Evaluate action
  policy-engine eval --policy policies/shell.yaml --action '{"action":"shell_exec","params":{"cmd":"ls"}}'

  # Validate policy
  policy-engine lint policies/production.yaml

API Usage:
  import { govern, PolicyEngine } from './policy-engine.js';

  // Wrap any tool
  const safeTool = govern(dangerousTool, { policyPath: 'policies/shell.yaml' });

  // Or use programmatic API
  const engine = new PolicyEngine(['policies/*.yaml']);
  const result = engine.evaluate({ action: 'shell_exec', params: { cmd: 'rm -rf /' }});

Compliance:
  - OWASP Agentic Top 10: ✓ LLM01 (Prompt Injection)
  - NIST AI RMF: ✓ MANAGE-2.2 (Risk Management)
`);
  }
}

// Run CLI if executed directly
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli();
}
