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
