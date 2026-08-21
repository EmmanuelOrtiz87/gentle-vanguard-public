#!/usr/bin/env node

/**
 * Receipt Manager
 * Structured review receipts with decision tracking
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

interface Receipt {
  id: string;
  reviewId: string;
  timestamp: number;
  decisions: Decision[];
  summary: string;
  approved: boolean;
  signatures: Signature[];
}

interface Decision {
  id: string;
  type: 'approve' | 'reject' | 'request-changes' | 'comment';
  author: string;
  timestamp: number;
  comment: string;
  lineRange?: { start: number; end: number };
}

interface Signature {
  author: string;
  timestamp: number;
  hash: string;
}

export class ReceiptManager extends EventEmitter {
  private receipts: Map<string, Receipt> = new Map();

  public createReceipt(reviewId: string): string {
    const receiptId = `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const receipt: Receipt = {
      id: receiptId,
      reviewId,
      timestamp: Date.now(),
      decisions: [],
      summary: '',
      approved: false,
      signatures: [],
    };

    this.receipts.set(receiptId, receipt);
    this.emit('receiptCreated', receipt);
    return receiptId;
  }

  public addDecision(receiptId: string, decision: Omit<Decision, 'id' | 'timestamp'>): void {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) return;

    const fullDecision: Decision = {
      ...decision,
      id: `decision_${Date.now()}`,
      timestamp: Date.now(),
    };

    receipt.decisions.push(fullDecision);

    // Update approval status
    const approvals = receipt.decisions.filter((d) => d.type === 'approve').length;
    const rejects = receipt.decisions.filter((d) => d.type === 'reject').length;
    receipt.approved = approvals > 0 && rejects === 0;

    this.emit('decisionAdded', { receiptId, decision: fullDecision });
  }

  public signReceipt(receiptId: string, author: string): void {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) return;

    const signature: Signature = {
      author,
      timestamp: Date.now(),
      hash: this.generateHash(receipt),
    };

    receipt.signatures.push(signature);
    this.emit('receiptSigned', { receiptId, signature });
  }

  private generateHash(receipt: Receipt): string {
    return require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(receipt.decisions))
      .digest('hex')
      .substring(0, 16);
  }

  public getReceipt(receiptId: string): Receipt | null {
    return this.receipts.get(receiptId) || null;
  }

  public getStats(): object {
    const receipts = Array.from(this.receipts.values());
    return {
      totalReceipts: receipts.length,
      approved: receipts.filter((r) => r.approved).length,
      pending: receipts.filter((r) => !r.approved).length,
      totalDecisions: receipts.reduce((a, r) => a + r.decisions.length, 0),
    };
  }
}

export const receiptManager = new ReceiptManager();
