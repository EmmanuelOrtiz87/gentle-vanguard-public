#!/usr/bin/env node
/**
 * MCP Sequential Thinking Server
 * 
 * Implementa el patrón de "Sequential Thinking" para LLMs.
 * Permite al modelo pensar paso a paso, revisar sus propios pensamientos,
 * y construir cadenas de razonamiento dinámicas.
 * 
 * Basado en: @modelcontextprotocol/server-sequential-thinking
 * Versión nativa para Gentle-Vanguard
 * 
 * Usage:
 *   node dist/mcp/sequential-thinking-server.js
 *   o
 *   npx tsx src/mcp/sequential-thinking-server.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Thought {
  id: string;
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
}

interface ThoughtChain {
  id: string;
  thoughts: Thought[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── State ────────────────────────────────────────────────────────────────────

const thoughtChains = new Map<string, ThoughtChain>();
const activeThoughts = new Map<string, Thought[]>();

// ─── Logger ───────────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.error(`[${timestamp}] [${level}] ${message}${metaStr}`);
}

// ─── Core Functions ───────────────────────────────────────────────────────────

function createThoughtChain(): string {
  const chainId = randomUUID();
  const chain: ThoughtChain = {
    id: chainId,
    thoughts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  thoughtChains.set(chainId, chain);
  activeThoughts.set(chainId, []);
  log('INFO', 'Created thought chain', { chainId });
  return chainId;
}

function addThought(
  chainId: string,
  thoughtData: Omit<Thought, 'id' | 'thoughtNumber' | 'totalThoughts'>
): Thought | null {
  const chain = thoughtChains.get(chainId);
  if (!chain) {
    log('ERROR', 'Thought chain not found', { chainId });
    return null;
  }

  const thoughts = chain.thoughts;
  const thoughtNumber = thoughts.length + 1;
  
  const thought: Thought = {
    id: randomUUID(),
    thought: thoughtData.thought,
    thoughtNumber,
    totalThoughts: thoughtNumber,
    isRevision: thoughtData.isRevision,
    revisesThought: thoughtData.revisesThought,
    branchFromThought: thoughtData.branchFromThought,
    branchId: thoughtData.branchId,
    needsMoreThoughts: thoughtData.needsMoreThoughts,
    nextThoughtNeeded: thoughtData.nextThoughtNeeded,
  };

  thoughts.push(thought);
  chain.updatedAt = new Date();
  
  // Update totalThoughts for all thoughts in chain
  thoughts.forEach((t: Thought) => {
    t.totalThoughts = thoughts.length;
  });

  log('INFO', 'Added thought to chain', { 
    chainId, 
    thoughtNumber, 
    totalThoughts: thoughts.length 
  });
  
  return thought;
}

function getThoughtChain(chainId: string): ThoughtChain | null {
  return thoughtChains.get(chainId) || null;
}

function getThoughtChainAsText(chainId: string): string {
  const chain = thoughtChains.get(chainId);
  if (!chain) return '';

  const lines: string[] = [
    '=== Sequential Thought Chain ===',
    `Chain ID: ${chainId}`,
    `Created: ${chain.createdAt.toISOString()}`,
    `Updated: ${chain.updatedAt.toISOString()}`,
    '',
  ];

  chain.thoughts.forEach((thought) => {
    lines.push(`Thought ${thought.thoughtNumber}/${thought.totalThoughts}:`);
    if (thought.isRevision) {
      lines.push(`  [REVISION of Thought ${thought.revisesThought}]`);
    }
    if (thought.branchFromThought) {
      lines.push(`  [BRANCH from Thought ${thought.branchFromThought}]`);
      lines.push(`  Branch ID: ${thought.branchId}`);
    }
    lines.push(`  ${thought.thought}`);
    if (thought.needsMoreThoughts) {
      lines.push('  [More thoughts needed]');
    }
    lines.push(`  Next thought needed: ${thought.nextThoughtNeeded ? 'YES' : 'NO'}`);
    lines.push('');
  });

  return lines.join('\n');
}

function listThoughtChains(): Array<{ id: string; thoughtCount: number; createdAt: Date }> {
  return Array.from(thoughtChains.entries()).map(([id, chain]) => ({
    id,
    thoughtCount: chain.thoughts.length,
    createdAt: chain.createdAt,
  }));
}

function deleteThoughtChain(chainId: string): boolean {
  const deleted = thoughtChains.delete(chainId);
  if (deleted) {
    activeThoughts.delete(chainId);
    log('INFO', 'Deleted thought chain', { chainId });
  }
  return deleted;
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'gentle-vanguard-sequential-thinking',
  version: '1.0.0',
  description: 'Sequential thinking chain for structured reasoning',
});

// Tool: think_sequential
server.tool(
  'think_sequential',
  'Add a thought to a sequential thinking chain. Use this for step-by-step reasoning, ' +
    'problem-solving, or when you need to think through something carefully. Supports ' +
    'branching (exploring different paths) and revision (correcting previous thoughts).',
  {
    thought: z.string().describe('Your current thinking on the problem'),
    nextThoughtNeeded: z
      .boolean()
      .describe('Whether you need another thought to complete the reasoning'),
    thoughtNumber: z
      .number()
      .optional()
      .describe('Explicit thought number (optional, auto-assigned if not provided)'),
    totalThoughts: z
      .number()
      .optional()
      .describe('Total expected thoughts (optional, auto-calculated)'),
    isRevision: z
      .boolean()
      .optional()
      .describe('Whether this revises a previous thought'),
    revisesThought: z
      .number()
      .optional()
      .describe('Which thought number this revises (if isRevision is true)'),
    branchFromThought: z
      .number()
      .optional()
      .describe('The thought number this branches from (for exploring alternatives)'),
    branchId: z
      .string()
      .optional()
      .describe('A unique identifier for this branch'),
    needsMoreThoughts: z
      .boolean()
      .optional()
      .describe('Whether more thoughts are needed beyond current expectations'),
    chainId: z
      .string()
      .optional()
      .describe('The thought chain ID (creates new if not provided)'),
  },
  async (params) => {
    try {
      // createThoughtChain() registers the chain in thoughtChains and returns its id,
      // so the chain is always present here — no second creation is needed.
      const chainId = params.chainId || createThoughtChain();

      const thought = addThought(chainId, {
        thought: params.thought,
        nextThoughtNeeded: params.nextThoughtNeeded,
        isRevision: params.isRevision,
        revisesThought: params.revisesThought,
        branchFromThought: params.branchFromThought,
        branchId: params.branchId,
        needsMoreThoughts: params.needsMoreThoughts,
      });

      if (!thought) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error: Failed to add thought to chain ${chainId}`,
            },
          ],
        };
      }

      const response = {
        thoughtId: thought.id,
        chainId,
        thoughtNumber: thought.thoughtNumber,
        totalThoughts: thought.totalThoughts,
        nextThoughtNeeded: thought.nextThoughtNeeded,
        timestamp: new Date().toISOString(),
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
          {
            type: 'text',
            text: `\n💭 Thought ${thought.thoughtNumber}/${thought.totalThoughts} recorded.`,
          },
        ],
      };
    } catch (error) {
      log('ERROR', 'Error in think_sequential', { error: String(error) });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Tool: get_thought_chain
server.tool(
  'get_thought_chain',
  'Retrieve a complete thought chain by ID',
  {
    chainId: z.string().describe('The thought chain ID to retrieve'),
    format: z
      .enum(['json', 'text'])
      .optional()
      .describe('Output format: json (structured) or text (human-readable)'),
  },
  async (params) => {
    try {
      const chain = getThoughtChain(params.chainId);
      
      if (!chain) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Thought chain not found: ${params.chainId}`,
            },
          ],
        };
      }

      const format = params.format || 'text';
      
      if (format === 'text') {
        return {
          content: [
            {
              type: 'text',
              text: getThoughtChainAsText(params.chainId),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(chain, null, 2),
          },
        ],
      };
    } catch (error) {
      log('ERROR', 'Error in get_thought_chain', { error: String(error) });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Tool: list_thought_chains
server.tool(
  'list_thought_chains',
  'List all active thought chains',
  {
    limit: z.number().optional().describe('Maximum number of chains to return'),
  },
  async (params) => {
    try {
      const chains = listThoughtChains();
      const limited = params.limit ? chains.slice(0, params.limit) : chains;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                totalChains: chains.length,
                chains: limited,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      log('ERROR', 'Error in list_thought_chains', { error: String(error) });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Tool: delete_thought_chain
server.tool(
  'delete_thought_chain',
  'Delete a thought chain',
  {
    chainId: z.string().describe('The thought chain ID to delete'),
  },
  async (params) => {
    try {
      const deleted = deleteThoughtChain(params.chainId);
      
      return {
        content: [
          {
            type: 'text',
            text: deleted
              ? `Thought chain ${params.chainId} deleted successfully`
              : `Thought chain ${params.chainId} not found`,
          },
        ],
      };
    } catch (error) {
      log('ERROR', 'Error in delete_thought_chain', { error: String(error) });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// Tool: get_thought_summary
server.tool(
  'get_thought_summary',
  'Get a summary of the thought chain (useful for final conclusions)',
  {
    chainId: z.string().describe('The thought chain ID'),
  },
  async (params) => {
    try {
      const chain = getThoughtChain(params.chainId);
      
      if (!chain) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Thought chain not found: ${params.chainId}`,
            },
          ],
        };
      }

      const summary = [
        `## Thought Chain Summary`,
        `**Chain ID:** ${chain.id}`,
        `**Total Thoughts:** ${chain.thoughts.length}`,
        `**Created:** ${chain.createdAt.toISOString()}`,
        `**Last Updated:** ${chain.updatedAt.toISOString()}`,
        '',
        '### Key Points:',
      ];

      chain.thoughts.forEach((t) => {
        const prefix = t.isRevision ? '🔁 (Revision)' : t.branchId ? '🌿 (Branch)' : '💭';
        summary.push(`${prefix} ${t.thought.substring(0, 100)}${t.thought.length > 100 ? '...' : ''}`);
      });

      if (chain.thoughts.some((t) => t.needsMoreThoughts)) {
        summary.push('');
        summary.push('⚠️ Some thoughts indicated that more reasoning is needed.');
      }

      return {
        content: [
          {
            type: 'text',
            text: summary.join('\n'),
          },
        ],
      };
    } catch (error) {
      log('ERROR', 'Error in get_thought_summary', { error: String(error) });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// ─── Transport Setup ───────────────────────────────────────────────────────────

async function main() {
  log('INFO', 'Starting Sequential Thinking MCP Server...');
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  log('INFO', 'Sequential Thinking MCP Server running on stdio');
}

main().catch((error) => {
  log('ERROR', 'Fatal error starting server', { error: String(error) });
  process.exit(1);
});
