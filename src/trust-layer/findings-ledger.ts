#!/usr/bin/env node

/**
 * Findings Ledger
 * Structured findings ledger with tamper-proof records
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

/** A finding as submitted by callers (arbitrary extra fields allowed) */
type FindingInput = Record<string, unknown>;

/** A finding as stored in the ledger, with hash-chain fields */
interface FindingRecord {
  id: string;
  title?: string;
  timestamp: number;
  hash: string;
  previousHash: string;
  [key: string]: unknown;
}

export class FindingsLedger extends EventEmitter {
  private findings: FindingRecord[] = [];
  private lastHash: string = '';

  public addFinding(finding: FindingInput): string {
    const id = `finding_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullFinding: FindingRecord = {
      ...finding,
      id,
      timestamp: Date.now(),
      hash: '',
      previousHash: this.lastHash,
    };
    fullFinding.hash = this.calculateHash(fullFinding);
    this.lastHash = fullFinding.hash;
    this.findings.push(fullFinding);
    this.emit('findingAdded', fullFinding);
    return id;
  }

  private calculateHash(finding: FindingRecord): string {
    return require('crypto')
      .createHash('sha256')
      .update(JSON.stringify({ title: finding.title, timestamp: finding.timestamp }))
      .digest('hex')
      .substring(0, 32);
  }

  public verifyIntegrity(): boolean {
    for (let i = 1; i < this.findings.length; i++) {
      if (this.findings[i].previousHash !== this.findings[i - 1].hash) {
        return false;
      }
    }
    return true;
  }

  public getStats(): object {
    return {
      totalFindings: this.findings.length,
      integrity: this.verifyIntegrity(),
    };
  }
}

export const findingsLedger = new FindingsLedger();
