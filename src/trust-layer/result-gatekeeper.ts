#!/usr/bin/env node

/**
 * Result Gatekeeper
 * Contract validation between phases
 * Part of Gentle-Vanguard
 */

import { EventEmitter } from 'events';

/** Contract describing how a phase's outputs are validated */
interface PhaseContract {
  phase: string;
  validator?: (outputs: unknown) => boolean;
}

/** Record of a successfully validated phase */
interface PhaseValidationResult {
  phase: string;
  inputs: unknown;
  outputs: unknown;
  timestamp: number;
}

export class ResultGatekeeper extends EventEmitter {
  private contracts: Map<string, PhaseContract> = new Map();
  private results: PhaseValidationResult[] = [];

  public registerContract(contract: PhaseContract): void {
    this.contracts.set(contract.phase, contract);
    this.emit('contractRegistered', contract);
  }

  public validatePhase(phase: string, inputs: unknown, outputs: unknown): boolean {
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
