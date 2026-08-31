#!/usr/bin/env node

/**
 * GateGuard MCP
 * MCP-specific security guards and validators
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

interface PolicyRule {
  id: string;
  action: string;
  message: string;
}

interface Policy {
  id: string;
  rules: PolicyRule[];
  enabled: boolean;
}

interface ViolationRecord {
  timestamp: number;
  connId: string;
  rule: string;
}

export class GateGuardMCP extends EventEmitter {
  private policies: Map<string, Policy> = new Map();
  private violationLog: ViolationRecord[] = [];

  constructor() {
    super();
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    this.policies.set('default', {
      id: 'default',
      rules: [
        { id: 'rate-limit', action: 'deny', message: 'Rate limit exceeded' },
        { id: 'no-execute', action: 'deny', message: 'Execute not allowed' },
      ],
      enabled: true,
    });
  }

  public validate(connId: string, method: string): { allowed: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;
      for (const rule of policy.rules) {
        if (method === 'execute') {
          violations.push(rule.message);
          this.violationLog.push({ timestamp: Date.now(), connId, rule: rule.id });
          return { allowed: false, violations };
        }
      }
    }

    return { allowed: true, violations };
  }

  public getStats(): object {
    return {
      activePolicies: this.policies.size,
      totalViolations: this.violationLog.length,
    };
  }
}

export const gateGuardMCP = new GateGuardMCP();
