import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import type { URL } from 'url';
import { ROOT } from '../shared.ts';
import {
  listActiveContinuations,
  listPendingAcks,
  setContinuationBaseDir,
  CONTINUATION_CONTRACT,
  ACK_CONTRACT,
} from '@gentle-vanguard/core/continuation';
import { listContracts } from '@gentle-vanguard/core/capabilities';

/**
 * GET /api/continuations — the operator's "what do I run now?" surface:
 *   - active: every live continuation with its verbatim re-entry command
 *   - pendingAcks: staged terminal transitions awaiting the exact token
 *   - capabilities: the versioned contract registry (what the stack advertises)
 *
 * Read-only; the ack/resolve mutations stay CLI-side by design (they burn
 * authority and must run verbatim, not through a dashboard button).
 */
export async function continuationsHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  if (url.pathname !== '/api/continuations') return false;

  // The continuation store lives at the repo root, not the server cwd.
  setContinuationBaseDir(join(ROOT, '.session'));

  const active = listActiveContinuations().map((env) => ({
    id: env.id,
    operation: env.operation,
    command: env.command,
    workflowId: env.binding.workflowId,
    revision: env.binding.revision ?? null,
    version: env.version,
    createdAt: env.createdAt,
  }));

  const pendingAcks = listPendingAcks().map((p) => ({
    resource: p.resource,
    revision: p.revision,
    stagedAt: p.createdAt,
    // the token itself is NOT exposed — replaying it is the CLI's job after
    // the operator decides to burn; the surface only says WHAT is pending
  }));

  res.writeHead(200, headers);
  res.end(
    JSON.stringify({
      success: true,
      data: {
        active,
        pendingAcks,
        capabilities: listContracts().map((c) => ({
          contract: c.contract,
          protocol: c.protocol,
          status: c.status,
          operations: c.operations,
        })),
        contracts: {
          continuation: CONTINUATION_CONTRACT,
          ack: ACK_CONTRACT,
        },
        generatedAt: new Date().toISOString(),
      },
    }),
  );
  return true;
}
