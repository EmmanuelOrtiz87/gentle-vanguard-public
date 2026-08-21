#!/usr/bin/env node

/**
 * MCP Gateway
 * Native MCP gateway for seamless IDE integration
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

export class MCPGateway extends EventEmitter {
  private connections: Map<string, any> = new Map();
  private requestHistory: any[] = [];

  public connect(ideType: string, version: string): string {
    const connId = `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.connections.set(connId, { id: connId, ideType, version, connectedAt: Date.now() });
    this.emit('connected', { id: connId, ideType });
    return connId;
  }

  public async handleRequest(connId: string, method: string): Promise<any> {
    if (!this.connections.has(connId)) {
      return { error: 'Not connected' };
    }
    const result = { method, timestamp: Date.now() };
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
