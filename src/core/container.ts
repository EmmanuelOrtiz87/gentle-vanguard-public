/**
 * Minimal DI container (STACK-EVOLUTION-PLAN F2.6) — factories, no framework.
 *
 * Pilot wiring (batch 1): ConfigService, token budget guard, database (db()).
 *
 * Batch 2 migrations (registered below, lazily; legacy module paths still work
 * unchanged — the container injects its `db` resolution into each module via a
 * setter, so modules keep their lazy-require fallback when run standalone):
 *   - errorMemory          → src/resilience/error-memory.ts (db injection + API ns)
 *   - resultGatekeeper     → src/review/result-gatekeeper.ts (db injection + API ns)
 *   - eventSourcing        → src/tools/event-sourcing.ts (db injection + API ns)
 *   - tokenTracker         → src/tokens/token-tracker.ts (db injection + API ns)
 *   - skillUsageTracker    → src/skills/skill-usage-tracker.ts (db injection + API ns)
 *   - adaptiveRouter       → src/orchestration/adaptive-router/index.ts (db injection + API ns)
 *   - sessionMetrics       → src/core/session-metrics-tracker.ts (façade over the
 *                            per-session getInstance() map — container is the
 *                            resolution point; legacy getInstance() delegates to the
 *                            same shared instance map, so both return the same object)
 *
 * NOT migrated (deliberate, do not "fix" without a plan):
 *   (none — batch 3, 2026-08-31, migrated the last four CLI/monitor modules
 *   by extracting side-effect-free library entries + CLI entry guards:
 *   pathToFileURL pattern, per src/tools/auto-url-fix.ts regression rule)
 */
import { getConfigService, ConfigService, createTestConfig } from '../config/config-service.js';
import { db } from '../database/db.js';
import { runGuard } from '../tokens/token-budget-guard.js';
import type { DatabaseManager } from '../database/nexus//manager.js';
import * as errorMemory from '../resilience/error-memory.js';
import * as resultGatekeeper from '../review/result-gatekeeper.js';
import * as eventSourcing from '../tools/event-sourcing.js';
import * as tokenTracker from '../tokens/token-tracker.js';
import * as skillUsageTracker from '../skills/skill-usage-tracker.js';
import * as adaptiveRouter from '../orchestration/adaptive-router/index.js';
import { SessionMetricsTracker, getAllLiveMetrics } from './session-metrics-tracker.js';
import { runPostMortem } from '../resilience/post-mortem-trigger.js';
import { runSloChecks } from '../monitor/performance-slo-monitor.js';

export interface Container {
  /** Register a lazy factory. Factories run at most once per container. */
  register<T>(key: string, factory: (c: Container) => T): void;
  /** Register an already-built value (still resolvable via factories' `c`). */
  registerValue<T>(key: string, value: T): void;
  /** Resolve (memoized). Throws on unknown key or re-entrant resolution. */
  resolve<T>(key: string): T;
  has(key: string): boolean;
  /** Keys registered so far (diagnostics/tests). */
  keys(): string[];
}

export function createContainer(): Container {
  const factories = new Map<string, (c: Container) => unknown>();
  const instances = new Map<string, unknown>();
  const resolving = new Set<string>();

  const c: Container = {
    register(key, factory) {
      if (factories.has(key) || instances.has(key)) {
        throw new Error(`container: key already registered: ${key}`);
      }
      factories.set(key, factory);
    },
    registerValue(key, value) {
      if (factories.has(key) || instances.has(key)) {
        throw new Error(`container: key already registered: ${key}`);
      }
      instances.set(key, value);
    },
    resolve(key) {
      if (instances.has(key)) return instances.get(key) as never;
      const factory = factories.get(key);
      if (!factory) throw new Error(`container: nothing registered for key: ${key}`);
      if (resolving.has(key)) {
        throw new Error(`container: circular dependency detected at key: ${key}`);
      }
      resolving.add(key);
      try {
        const value = factory(c);
        instances.set(key, value);
        return value as never;
      } finally {
        resolving.delete(key);
      }
    },
    has(key) {
      return factories.has(key) || instances.has(key);
    },
    keys() {
      return [...new Set([...factories.keys(), ...instances.keys()])];
    },
  };

  return c;
}

/**
 * Default application container with the pilot registrations (F2.6).
 * Everything is lazy — constructing the container touches no filesystem.
 */
export function createAppContainer(): Container {
  const c = createContainer();
  c.register('config', () => getConfigService());
  c.register('db', (cc) => {
    // db() lazily imports the DatabaseManager singleton (apps/web-dashboard).
    void cc.resolve('config'); // demonstrate dependency resolution; kept side-effect free
    return db();
  });
  c.register('tokenBudgetGuard', (cc) => {
    const config = cc.resolve<ConfigService>('config');
    const quiet = config.get('GV_QUIET');
    return {
      check(task: string, risk: string, chars: number) {
        return runGuard({
          mode: 'pre-task',
          task,
          risk,
          chars,
          actualPrompt: 0,
          actualCompletion: 0,
          record: false,
          strict: false,
          asJson: true,
          quiet,
        });
      },
    };
  });
  registerBatch2Services(c);
  return c;
}

/**
 * Batch 2 (F2.6) service registrations. Each factory injects the container's
 * `db` resolution into the module (the module keeps a lazy-require fallback for
 * standalone CLI use) and returns the module's public API namespace, memoized.
 * Shared with createTestContainer() so tests can swap `config`/`db` for stubs.
 */
function registerBatch2Services(c: Container): void {
  c.register('errorMemory', (cc) => {
    errorMemory.setErrorMemoryDb(cc.resolve<DatabaseManager>('db'));
    return errorMemory;
  });
  c.register('resultGatekeeper', (cc) => {
    resultGatekeeper.setGatekeeperDb(cc.resolve<DatabaseManager>('db'));
    return resultGatekeeper;
  });
  c.register('eventSourcing', (cc) => {
    eventSourcing.setEventSourcingDb(cc.resolve<DatabaseManager>('db'));
    return eventSourcing;
  });
  c.register('tokenTracker', (cc) => {
    tokenTracker.setTokenTrackerDb(cc.resolve<DatabaseManager>('db'));
    return tokenTracker;
  });
  c.register('skillUsageTracker', (cc) => {
    skillUsageTracker.setSkillUsageDb(cc.resolve<DatabaseManager>('db'));
    return skillUsageTracker;
  });
  c.register('adaptiveRouter', (cc) => {
    adaptiveRouter.setAdaptiveRouterDb(cc.resolve<DatabaseManager>('db'));
    return adaptiveRouter;
  });
  c.register('sessionMetrics', () => ({
    /** Same instance map as the legacy SessionMetricsTracker.getInstance(). */
    forSession: (sessionId: string) => SessionMetricsTracker.getInstance(sessionId),
    destroy: (sessionId: string) => SessionMetricsTracker.destroy(sessionId),
    liveMetrics: () => getAllLiveMetrics(),
  }));
  c.register('postMortem', (cc) => {
    void cc;
    return {
      /** Library entry (CLI still works standalone via its entry guard). */
      run: runPostMortem,
    };
  });
  c.register('sloMonitor', (cc) => {
    void cc;
    return {
      /** Library entry (CLI still works standalone via its entry guard). */
      run: runSloChecks,
    };
  });
}

/**
 * Test container: same service registrations as the app container, but `config`
 * and `db` are stubs (createTestConfig + an inert fake db) so dependents resolve
 * without touching the filesystem or the real DatabaseManager singleton.
 * Fresh container per test = full isolation.
 */
export function createTestContainer(): Container {
  const c = createContainer();
  c.registerValue('config', createTestConfig());
  c.registerValue(
    'db',
    {} as DatabaseManager, // inert stub: batch-2 factories only inject the handle
  );
  c.register('tokenBudgetGuard', (cc) => {
    const config = cc.resolve<ConfigService>('config');
    const quiet = config.get('GV_QUIET');
    return {
      check(task: string, risk: string, chars: number) {
        return runGuard({
          mode: 'pre-task',
          task,
          risk,
          chars,
          actualPrompt: 0,
          actualCompletion: 0,
          record: false,
          strict: false,
          asJson: true,
          quiet,
        });
      },
    };
  });
  registerBatch2Services(c);
  return c;
}
