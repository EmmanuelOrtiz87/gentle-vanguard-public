#!/usr/bin/env node

/**
 * Result Gatekeeper
 * Contract validation between phases
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

export class ResultGatekeeper extends EventEmitter {
  private contracts: Map<string, any> = new Map();
  private results: any[] = [];

  public registerContract(contract: any): void {
    this.contracts.set(contract.phase, contract);
    this.emit('contractRegistered', contract);
  }

  public validatePhase(phase: string, inputs: any, outputs: any): boolean {
    const contract = this.contracts.get(phase);
    if (!contract) {
      this.emit('validationFailed', { phase, reason: 'No contract' });
      return false;
    }
    const isValid = contract.validator ? contract.validator(outputs) : true;
    if (isValid) {
      this.results.push({ phase, inputs, outputs, timestamp: Date.now() });
      this.emit('phaseValidated', { phase });
    } else {
      this.emit('validationFailed', { phase, reason: 'Contract violation' });
    }
    return isValid;
  }

  public getStats(): object {
    return {
      registeredContracts: this.contracts.size,
      validatedPhases: this.results.length,
    };
  }
}

export const resultGatekeeper = new ResultGatekeeper();
