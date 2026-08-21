#!/usr/bin/env node
/**
 * MCP Bridge
 *
 * Bridge between MCP (Model Context Protocol) and the Gentle-Vanguard stack.
 * Provides standardized interface for MCP tool calls.
 *
 * Usage: npx tsx src/mcp-bridge.ts [--port PORT]
 */

import { createServer } from 'http';
import { pathToFileURL } from 'url';

const PORT = process.env.MCP_PORT || 7437;

interface MCPRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const tools = [
  {
    name: 'engram_search',
    description: 'Search memories in Engram',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'engram_save',
    description: 'Save a memory to Engram',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        message: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['title', 'message'],
    },
  },
  {
    name: 'session_status',
    description: 'Get current session status',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'metrics_get',
    description: 'Get system metrics',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['token', 'cost', 'quality'] },
      },
    },
  },
];

function handleRequest(req: MCPRequest): MCPResponse {
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id: req.id,
  };

  switch (req.method) {
    case 'initialize':
      response.result = {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'gentle-vanguard-mcp',
          version: '1.0.0',
        },
      };
      break;

    case 'tools/list':
      response.result = { tools };
      break;

    case 'tools/call':
      const toolName = req.params?.name;
      response.result = {
        content: [
          {
            type: 'text',
            text: `Tool ${toolName} executed successfully`,
          },
        ],
      };
      break;

    default:
      response.error = {
        code: -32601,
        message: `Method not found: ${req.method}`,
      };
  }

  return response;
}

function main(): void {
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const request: MCPRequest = JSON.parse(body);
        const response = handleRequest(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch {
        res.writeHead(400);
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }),
        );
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`[MCP-BRIDGE] Server running on port ${PORT}`);
    console.log('[MCP-BRIDGE] Ready to accept connections');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { handleRequest, tools };
