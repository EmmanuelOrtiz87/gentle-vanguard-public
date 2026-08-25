#!/usr/bin/env node

/**
 * Compact State
 * Formal state machine with CAS
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

/** Snapshot of the compact state machine (CAS-versioned) */
interface CompactStateSnapshot {
  version: number;
  data: unknown;
  timestamp: number;
}

export class CompactState extends EventEmitter {
  private state: CompactStateSnapshot = { version: 0, data: {}, timestamp: Date.now() };
  private history: CompactStateSnapshot[] = [];

  public compareAndSwap(expectedVersion: number, newData: unknown): boolean {
    if (this.state.version !== expectedVersion) {
      this.emit('casFailed', { expected: expectedVersion, actual: this.state.version });
      return false;
    }
    this.history.push({ ...this.state });
    this.state = { version: expectedVersion + 1, data: newData, timestamp: Date.now() };
    this.emit('stateChanged', { from: expectedVersion, to: this.state.version });
    return true;
  }

  public getState(): CompactStateSnapshot {
    return { ...this.state };
  }

  public getHistory(): CompactStateSnapshot[] {
    return [...this.history];
  }
}

export const compactState = new CompactState();
