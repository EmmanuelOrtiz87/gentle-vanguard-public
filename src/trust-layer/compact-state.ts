#!/usr/bin/env node

/**
 * Compact State
 * Formal state machine with CAS
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

export class CompactState extends EventEmitter {
  private state: any = { version: 0, data: {}, timestamp: Date.now() };
  private history: any[] = [];

  public compareAndSwap(expectedVersion: number, newData: any): boolean {
    if (this.state.version !== expectedVersion) {
      this.emit('casFailed', { expected: expectedVersion, actual: this.state.version });
      return false;
    }
    this.history.push({ ...this.state });
    this.state = { version: expectedVersion + 1, data: newData, timestamp: Date.now() };
    this.emit('stateChanged', { from: expectedVersion, to: this.state.version });
    return true;
  }

  public getState(): any {
    return { ...this.state };
  }

  public getHistory(): any[] {
    return [...this.history];
  }
}

export const compactState = new CompactState();
