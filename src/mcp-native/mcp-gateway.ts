#!/usr/bin/env node

/**
 * MCP Gateway
 * Native MCP gateway for seamless IDE integration
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

interface MCPConnection {
  id: string;
  ideType: string;
  version: string;
  connectedAt: number;
}

interface RequestResult {
  method: string;
  timestamp: number;
  error?: string;
}

export class MCPGateway extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map();
  private requestHistory: RequestResult[] = [];

  public connect(ideType: string, version: string): string {
    const connId = `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.connections.set(connId, { id: connId, ideType, version, connectedAt: Date.now() });
    this.emit('connected', { id: connId, ideType });
    return connId;
  }

  public async handleRequest(connId: string, method: string): Promise<RequestResult> {
    if (!this.connections.has(connId)) {
      return { method, timestamp: Date.now(), error: 'Not connected' };
    }
    const result: RequestResult = { method, timestamp: Date.now() };
    this.requestHistory.push(result);
    this.emit('requestHandled', { connId, method });
    return result;
  }

  public getStats(): object {
    return {
      activeConnections: this.connections.size,
      totalRequests: this.requestHistory.length,
    };
  }
}

export const mcpGateway = new MCPGateway();
