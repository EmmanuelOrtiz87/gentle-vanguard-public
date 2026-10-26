/**
 * harness-ledger.ts — Libro mayor auditable del bucle de harness.
 *
 * Portado de harness2/core/ledger.py (google-research/harness2, Apache-2.0).
 *
 * El ledger existe para que el costo y la integridad del bucle sean
 * VERIFICABLES, no estimados. Harness^2 define un presupuesto con identidad
 * exacta:
 *
 *   R = 4k rollouts   (k base + 2k candidatos + k finales)
 *   P = 3k sesiones   (k invariantes + k de dominio + k composiciones)
 *
 * La identidad se cumple en los dos modos (paralelo `agg` y secuencial
 * `seq`); lo que cambia es como se reparten las etapas, no el total.
 *
 * El ledger falla —en vez de avisar— cuando un label se repite: un label
 * duplicado significa que dos etapas escribieron el mismo identificador de
 * corrida, y que una candidata que el presupuesto contaba nunca se produjo.
 * Un presupuesto que se auto-verifica es la diferencia entre un loop auditable
 * y una caja negra cara.
 */

/** Etapa del bucle a la que pertenece una corrida. */
export type LedgerStage = 'base' | 'candidate' | 'composition' | 'final';

/** Modo del bucle: paralelo (ancho) o secuencial (profundo). */
export type LedgerMode = 'agg' | 'seq';

export interface LedgerEntry {
  /** Identificador unico de la corrida dentro del bucle (ej. `inv-1`). */
  label: string;
  stage: LedgerStage;
  /** Sesion del agente que ejecuto la corrida. */
  sessionId: string;
  /** Identificador de corrida del harness. */
  runId: string;
  /** Tokens consumidos, si se conocen. */
  tokens?: number;
  /** Costo en USD, si se conoce. */
  costUsd?: number;
}

export interface LedgerIdentity {
  /** Rollouts esperados: 4k. */
  expectedRollouts: number;
  /** Sesiones esperadas: 3k. */
  expectedSessions: number;
  /** Modo del bucle. */
  mode: LedgerMode;
  /** k base del bucle. */
  k: number;
}

export interface LedgerSummary {
  mode: LedgerMode;
  k: number;
  rollouts: number;
  sessions: number;
  expectedRollouts: number;
  expectedSessions: number;
  identityHolds: boolean;
  /** La distribucion por etapa es la esperada para el modo. */
  stageCountsHolds: boolean;
  tokens: number;
  costUsd: number;
  byStage: Record<string, number>;
  labels: string[];
}

/** Error de identidad del ledger: el presupuesto no cuadra. */
export class LedgerIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerIdentityError';
  }
}

/**
 * Libro mayor del bucle.
 *
 * Es un acumulador en memoria: el estado durable lo escribe el orquestador
 * (src/core/harness-loop.ts) junto a la evidencia de cada corrida.
 */
export class HarnessLedger {
  private readonly entries: LedgerEntry[] = [];
  private readonly seenLabels = new Set<string>();
  private readonly seenRunIds = new Set<string>();

  constructor(
    private readonly identity: LedgerIdentity,
    readonly taskId: string
  ) {}

  /** Crea un ledger con la identidad del presupuesto estandar. */
  static create(options: {
    taskId: string;
    k: number;
    mode: LedgerMode;
  }): HarnessLedger {
    if (!Number.isInteger(options.k) || options.k < 1) {
      throw new LedgerIdentityError(`k debe ser un entero >= 1 (recibido: ${options.k}).`);
    }
    return new HarnessLedger(
      {
        expectedRollouts: options.k * 4,
        expectedSessions: options.k * 3,
        mode: options.mode,
        k: options.k,
      },
      options.taskId
    );
  }

  /**
   * Registra una corrida.
   *
   * @throws LedgerIdentityError si el label o el runId ya fueron usados.
   */
  record(entry: LedgerEntry): void {
    if (this.seenLabels.has(entry.label)) {
      throw new LedgerIdentityError(
        `Label duplicado "${entry.label}" en el ledger de "${this.taskId}". ` +
          'Un label repetido significa que dos etapas escribieron la misma corrida: ' +
          'el presupuesto esta contando una candidata que nunca se produjo.'
      );
    }
    if (this.seenRunIds.has(entry.runId)) {
      throw new LedgerIdentityError(
        `runId duplicado "${entry.runId}" en el ledger de "${this.taskId}".`
      );
    }
    this.seenLabels.add(entry.label);
    this.seenRunIds.add(entry.runId);
    this.entries.push(entry);
  }

  /**
   * Verifica la identidad del presupuesto: R = 4k, P = 3k.
   *
   * Se llama en produccion (no es una API muerta): si el presupuesto no
   * cuadra, el bucle para antes de que una candidata que nunca se produjo
   * llegue al selector.
   */
  assertIdentity(): void {
    const { expectedRollouts, expectedSessions, mode, k } = this.identity;
    const rollouts = this.entries.length;
    const sessions = new Set(this.entries.map((e) => e.sessionId)).size;

    if (rollouts !== expectedRollouts) {
      throw new LedgerIdentityError(
        `Rollouts ${rollouts} != ${expectedRollouts} (4k, k=${k}, modo ${mode}).`
      );
    }
    if (sessions !== expectedSessions) {
      throw new LedgerIdentityError(
        `Sesiones ${sessions} != ${expectedSessions} (3k, k=${k}, modo ${mode}).`
      );
    }
    const expected = this.expectedStageCounts();
    for (const [stage, count] of Object.entries(expected)) {
      const actual = this.entries.filter((e) => e.stage === stage).length;
      if (actual !== count) {
        throw new LedgerIdentityError(
          `Etapa "${stage}": ${actual} corridas != ${count} esperadas (k=${k}, modo ${mode}).`
        );
      }
    }
  }

  /**
   * Etapas esperadas para el modo actual.
   *
   * Los dos modos tienen la MISMA distribucion (k base + 2k candidatas + k
   * composiciones = 4k rollouts). Lo que cambia es el CALENDARIO: en `agg` las
   * candidatas se generan en paralelo y las composiciones se encadenan al
   * final; en `seq` cada ronda se compone antes de abrir la siguiente. Por
   * eso los conteos no distinguen los modos: el conteo por etiqueta si.
   */
  expectedStageCounts(): Record<LedgerStage, number> {
    const { k } = this.identity;
    return { base: k, candidate: 2 * k, composition: k, final: 0 };
  }

  /** Resumen del ledger para el reporte. */
  summary(): LedgerSummary {
    const byStage: Record<string, number> = {};
    for (const entry of this.entries) {
      byStage[entry.stage] = (byStage[entry.stage] ?? 0) + 1;
    }
    const rollouts = this.entries.length;
    const sessions = new Set(this.entries.map((e) => e.sessionId)).size;
    const expected = this.expectedStageCounts();
    const stageCountsHolds = Object.entries(expected).every(
      ([stage, count]) => this.entries.filter((e) => e.stage === stage).length === count
    );
    return {
      mode: this.identity.mode,
      k: this.identity.k,
      rollouts,
      sessions,
      expectedRollouts: this.identity.expectedRollouts,
      expectedSessions: this.identity.expectedSessions,
      identityHolds: rollouts === this.identity.expectedRollouts && sessions === this.identity.expectedSessions,
      stageCountsHolds,
      tokens: this.entries.reduce((acc, e) => acc + (e.tokens ?? 0), 0),
      costUsd: Number(this.entries.reduce((acc, e) => acc + (e.costUsd ?? 0), 0).toFixed(6)),
      byStage,
      labels: this.entries.map((e) => e.label),
    };
  }

  /** Entradas registradas, en orden de registro. */
  list(): readonly LedgerEntry[] {
    return this.entries;
  }
}