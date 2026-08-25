#!/usr/bin/env node

/**
 * Publication Gates
 * TOCTOU prevention and stale-approval detection
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

/** A recorded approval for an artifact */
interface ApprovalRecord {
  id: string;
  artifactId: string;
  approver: string;
  timestamp: number;
  expiresAt: number;
}

/** A publication request referencing approval IDs */
interface PublicationRequest {
  artifactId: string;
  approvals: string[];
}

export class PublicationGates extends EventEmitter {
  private approvals: Map<string, ApprovalRecord> = new Map();
  private publications: PublicationRequest[] = [];
  private approvalTimeout: number = 24 * 60 * 60 * 1000;

  public requestApproval(artifactId: string, approver: string): string {
    const id = `approval_${Date.now()}`;
    const approval: ApprovalRecord = {
      id,
      artifactId,
      approver,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.approvalTimeout,
    };
    this.approvals.set(id, approval);
    this.emit('approvalRequested', approval);
    return id;
  }

  public validatePublication(request: PublicationRequest): boolean {
    const validApprovals = request.approvals.filter((id: string) => {
      const approval = this.approvals.get(id);
      if (!approval) return false;
      if (approval.artifactId !== request.artifactId) return false;
      if (Date.now() > approval.expiresAt) return false;
      return true;
    });
    const isValid = validApprovals.length === request.approvals.length;
    if (isValid) {
      this.publications.push(request);
      this.emit('published', request);
    } else {
      this.emit('publicationBlocked', { request, reason: 'Stale approvals' });
    }
    return isValid;
  }

  public getStats(): object {
    return {
      totalApprovals: this.approvals.size,
      totalPublications: this.publications.length,
    };
  }
}

export const publicationGates = new PublicationGates();
