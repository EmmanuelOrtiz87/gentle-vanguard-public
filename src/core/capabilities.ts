/**
 * capabilities.ts — Versioned contract registry for the Gentle-Vanguard stack
 *
 * Absorbed natively from gentle-ai v2.5.0-rc.3 ("Capabilities v2.3"):
 * `gentle-ai review capabilities --contract gentle-ai.review-integration/v2`
 * must report protocol minor 3 and advertise `start/v4` (not `start/v3`).
 * A caller can ask what operations exist, at which protocol version, and get
 * an honest answer — including "retired" — instead of discovering it by
 * parsing failure text.
 *
 * Rules (rc.1: "retired ... surfaces refuse instead of being reinterpreted"):
 *   - Every native contract in the stack registers here with its operations
 *     and protocol version.
 *   - Bumping a contract is additive-minor: new operations or fields bump the
 *     minor; semantic changes to existing operations retire the old contract
 *     string and register the new one.
 *   - `describe` for an unknown contract returns a typed refusal naming the
 *     registered ones — never a stack trace.
 *
 * Contract: gentle-vanguard.capabilities/v1
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refusal, type TypedRefusal } from './typed-refusal.js';

export interface ContractDescriptor {
  /** Fully versioned contract string, e.g. 'gentle-vanguard.continuation/v1'. */
  contract: string;
  /** Major.minor protocol version advertised for this contract. */
  protocol: string;
  operations: string[];
  status: 'stable' | 'experimental' | 'retired';
  description: string;
  /** Replaced-by contract string; only meaningful when status is 'retired'. */
  supersededBy?: string;
}

export interface CapabilitySourceResult {
  id: string;
  status: 'pass' | 'fail';
  detail: string;
}

const REGISTRY: ContractDescriptor[] = [
  {
    contract: 'gentle-vanguard.capabilities/v1',
    protocol: '1.0',
    operations: ['list', 'describe'],
    status: 'stable',
    description: 'This registry — ask what the stack advertises before calling it.',
  },
  {
    contract: 'gentle-vanguard.continuation/v1',
    protocol: '1.0',
    operations: ['record', 'get', 'resolve', 'next-transition'],
    status: 'stable',
    description:
      'Machine-executable re-entry: transactions publish the verbatim next command (absorbed from gentle-ai v2.5.0-rc.3).',
  },
  {
    contract: 'gentle-vanguard.ack/v1',
    protocol: '1.0',
    operations: ['stage', 'acknowledge', 'pending'],
    status: 'stable',
    description:
      'Ack-before-burn: terminal transitions burn authority only on the exact acknowledgement token (absorbed from gentle-ai v2.5.0-rc.2).',
  },
  {
    contract: 'gentle-vanguard.typed-refusal/v1',
    protocol: '1.0',
    operations: ['refuse', 'describe', 'evidence'],
    status: 'stable',
    description:
      'Refusals that describe what happened, carry no paths, and name their way forward.',
  },
  {
    contract: 'gentle-vanguard.rdd-workflow/v1',
    protocol: '1.1',
    operations: [
      'start',
      'classify',
      'review',
      'receipt',
      'gate',
      'status',
      'ack',
      'abort',
      'prune',
    ],
    status: 'stable',
    description:
      'Native Receipt-Driven Development workflow. 1.1 adds continuation publication and receipt acknowledgement.',
  },
  {
    contract: 'gentle-vanguard.sdd-pipeline/v1',
    protocol: '1.1',
    operations: [
      'init',
      'explore',
      'propose',
      'spec',
      'tasks',
      'design',
      'apply',
      'verify',
      'archive',
    ],
    status: 'stable',
    description:
      'Spec-Driven Development phase pipeline. 1.1 publishes per-phase continuations with the verbatim next-phase command.',
  },
  {
    contract: 'gentle-vanguard.sdd-research/v1',
    protocol: '1.0',
    operations: ['run', 'propose'],
    status: 'stable',
    description:
      'Source-backed SDD research lane: questions, grants, sources, claim mappings, uncertainty (mirrors gentle-ai v2.5.0-rc.1 shape).',
  },
  {
    contract: 'gentle-vanguard.agent/v1',
    protocol: '1.0',
    operations: ['discover', 'route', 'delegate', 'report', 'fallback'],
    status: 'stable',
    description:
      'Native agent contract: declared capability, routing triggers, bounded delegation, result report, and explicit fallback path.',
  },
  {
    contract: 'gentle-vanguard.skill/v1',
    protocol: '1.0',
    operations: ['discover', 'match', 'load', 'verify', 'record-usage'],
    status: 'stable',
    description:
      'Native skill contract: discover available skills, match triggers, load instructions, verify metadata, and record usage evidence.',
  },
  {
    contract: 'gentle-vanguard.app-lifecycle/v1',
    protocol: '1.0',
    operations: ['register', 'start', 'stop', 'health', 'status', 'logs'],
    status: 'stable',
    description:
      'Command Center app lifecycle contract for local-first apps: registration, invisible start/stop, health, status, and logs.',
  },
  {
    contract: 'gentle-vanguard.external-capability/v1',
    protocol: '1.0',
    operations: ['declare', 'authorize', 'invoke', 'audit', 'revoke'],
    status: 'stable',
    description:
      'External capability contract for connectors and tools: declare surface, require authorization, invoke through audited boundaries, and revoke access.',
  },
  {
    contract: 'gentle-vanguard.session-close/v1',
    protocol: '1.0',
    operations: [
      'pre-close',
      'pre-validate',
      'persist',
      'backup',
      'audit',
      'cleanup',
      'verify',
      'ack',
      'receive',
    ],
    status: 'stable',
    description:
      'Session close lifecycle. The terminal report is staged with a pending acknowledgement (ack-before-burn): PASS closes are auto-filed on next-session receipt, failed/warned closes escalate and stay pending until reviewed.',
  },
];

export function listContracts(filter?: {
  status?: ContractDescriptor['status'];
}): ContractDescriptor[] {
  return REGISTRY.filter((c) => !filter?.status || c.status === filter.status);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function tableDataRows(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|.+\|$/.test(line.trim()))
    .filter((line) => !/^\|\s*-+/.test(line.trim()))
    .filter((line) => !/^\|\s*(Metric|Skill|App)\s*\|/i.test(line.trim()));
}

/**
 * Audits the live registries that back the base capability contracts. This is
 * deliberately read-only and source-derived: it proves the contracts are tied
 * to existing agent, skill, app, and external-tool declarations.
 */
export function auditCapabilitySources(options: { root?: string } = {}): CapabilitySourceResult[] {
  const root = options.root ?? process.cwd();
  const results: CapabilitySourceResult[] = [];

  try {
    const agentsPath = join(root, 'config', 'agents.json');
    const agentsConfig = readJson(agentsPath) as {
      agents?: Record<string, { name?: string; capability?: string; executionCommand?: string }>;
    };
    const agents = Object.values(agentsConfig.agents ?? {});
    const validAgents = agents.filter(
      (agent) => agent.name && agent.capability && agent.executionCommand,
    );
    results.push({
      id: 'contract-source:agents',
      status: agents.length > 0 && validAgents.length === agents.length ? 'pass' : 'fail',
      detail: `${validAgents.length}/${agents.length} agents declare name, capability, executionCommand`,
    });
  } catch (error) {
    results.push({
      id: 'contract-source:agents',
      status: 'fail',
      detail: `agents registry unavailable: ${String(error)}`,
    });
  }

  try {
    const indexPath = join(root, 'skills', 'INDEX.md');
    const index = readFileSync(indexPath, 'utf8');
    const activeRows = tableDataRows(index).filter((line) => /\|\s*active\s*\|/i.test(line));
    results.push({
      id: 'contract-source:skills',
      status: activeRows.length > 0 ? 'pass' : 'fail',
      detail: `${activeRows.length} active skill rows in skills/INDEX.md`,
    });
  } catch (error) {
    results.push({
      id: 'contract-source:skills',
      status: 'fail',
      detail: `skills index unavailable: ${String(error)}`,
    });
  }

  try {
    const lifecyclePath = join(root, 'docs', 'APP-LIFECYCLE.md');
    const lifecycle = readFileSync(lifecyclePath, 'utf8');
    const appRows = tableDataRows(lifecycle).filter(
      (line) => line.includes('start.sh') && line.includes('stop.sh'),
    );
    results.push({
      id: 'contract-source:apps',
      status: appRows.length > 0 ? 'pass' : 'fail',
      detail: `${appRows.length} apps declare start/stop lifecycle rows`,
    });
  } catch (error) {
    results.push({
      id: 'contract-source:apps',
      status: 'fail',
      detail: `app lifecycle table unavailable: ${String(error)}`,
    });
  }

  try {
    const mcpPath = join(root, 'config', 'mcp-registry.json');
    const mcpRegistry = readJson(mcpPath) as {
      servers?: Array<{
        name?: string;
        enabled?: boolean;
        transport?: string;
        command?: string;
        url?: string;
      }>;
    };
    const servers = mcpRegistry.servers ?? [];
    const validServers = servers.filter(
      (server) =>
        server.name &&
        server.transport &&
        (server.command || (server.transport === 'remote' && server.url)),
    );
    const enabledServers = validServers.filter((server) => server.enabled !== false);
    results.push({
      id: 'contract-source:external-capabilities',
      status: servers.length > 0 && validServers.length === servers.length ? 'pass' : 'fail',
      detail: `${enabledServers.length}/${servers.length} MCP servers enabled with transport and command`,
    });
  } catch (error) {
    results.push({
      id: 'contract-source:external-capabilities',
      status: 'fail',
      detail: `MCP registry unavailable: ${String(error)}`,
    });
  }

  return results;
}

export type CapabilitiesAnswer = ContractDescriptor[] | TypedRefusal;

/**
 * Describe one contract by its exact versioned string. Unknown contracts get a
 * typed refusal that names the registered contracts — a caller can self-correct
 * without parsing an error.
 */
export function describeContract(contract: string): CapabilitiesAnswer {
  const hit = REGISTRY.find((c) => c.contract === contract);
  if (hit) return [hit];
  return refusal(
    'unsupported',
    'capabilities.unknown-contract',
    `contract '${contract}' is not registered`,
    {
      nothingStarted: true,
      remediation: {
        command: 'npx tsx src/core/capabilities.ts list',
        description: `list registered contracts: ${REGISTRY.filter((c) => c.status !== 'retired')
          .map((c) => c.contract)
          .join(', ')}`,
      },
    },
  );
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMainModule) {
  const [cmd, target] = process.argv.slice(2);
  if (cmd === 'list' || !cmd) {
    for (const c of listContracts()) {
      const retired = c.status === 'retired' ? ` (retired → ${c.supersededBy ?? '?'})` : '';
      console.log(`${c.contract}  protocol ${c.protocol}${retired}`);
      console.log(`  ops: ${c.operations.join(', ')}`);
      console.log(`  ${c.description}`);
    }
  } else if (cmd === 'describe' && target) {
    const answer = describeContract(target);
    if (Array.isArray(answer)) {
      console.log(JSON.stringify(answer[0], null, 2));
    } else {
      console.error(`REFUSED [${answer.kind}] ${answer.code}: ${answer.message}`);
      process.exit(1);
    }
  } else {
    console.log('usage: capabilities.ts [list | describe <contract>]');
  }
}
