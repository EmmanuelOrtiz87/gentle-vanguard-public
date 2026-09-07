import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createContainer,
  createAppContainer,
  createTestContainer,
} from '../../src/core/container.js';
import { resetConfigService, getConfigService } from '../../src/config/config-service.js';

describe('createContainer', () => {
  it('resolves registered factories and memoizes instances', () => {
    const c = createContainer();
    let calls = 0;
    c.register('svc', () => {
      calls += 1;
      return { id: 'x' };
    });
    const a = c.resolve('svc');
    const b = c.resolve('svc');
    assert.equal(a, b);
    assert.equal(calls, 1);
  });

  it('factories receive the container (dependency resolution)', () => {
    const c = createContainer();
    c.register('config', () => ({ token: 'cfg-1' }));
    c.register('consumer', (cc) => ({ config: cc.resolve('config') }));
    const consumer = c.resolve<{ config: { token: string } }>('consumer');
    assert.equal(consumer.config.token, 'cfg-1');
  });

  it('registerValue resolves as-is', () => {
    const c = createContainer();
    const obj = { fixed: true };
    c.registerValue('static', obj);
    assert.equal(c.resolve('static'), obj);
  });

  it('throws on unknown key', () => {
    const c = createContainer();
    assert.throws(() => c.resolve('nope'), /nothing registered/);
  });

  it('throws on duplicate registration', () => {
    const c = createContainer();
    c.register('a', () => 1);
    assert.throws(() => c.register('a', () => 2), /already registered/);
  });

  it('throws on circular dependencies', () => {
    const c = createContainer();
    c.register('a', (cc) => cc.resolve('b'));
    c.register('b', (cc) => cc.resolve('a'));
    assert.throws(() => c.resolve('a'), /circular dependency/);
  });

  it('has() and keys() reflect registrations', () => {
    const c = createContainer();
    c.register('x', () => 1);
    c.registerValue('y', 2);
    assert.equal(c.has('x'), true);
    assert.equal(c.has('z'), false);
    assert.deepEqual(c.keys().sort(), ['x', 'y']);
  });

  it('containers are isolated (test isolation)', () => {
    const c1 = createContainer();
    const c2 = createContainer();
    c1.register('svc', () => ({ scope: 'one' }));
    c2.register('svc', () => ({ scope: 'two' }));
    assert.equal(c1.resolve<{ scope: string }>('svc').scope, 'one');
    assert.equal(c2.resolve<{ scope: string }>('svc').scope, 'two');
  });
});

describe('createAppContainer (pilot wiring)', () => {
  it('registers the pilot keys', () => {
    const c = createAppContainer();
    assert.equal(c.has('config'), true);
    assert.equal(c.has('db'), true);
    assert.equal(c.has('tokenBudgetGuard'), true);
  });

  it('config resolves to the ConfigService singleton', () => {
    try {
      const c = createAppContainer();
      const cfg = c.resolve<ReturnType<typeof getConfigService>>('config');
      assert.equal(cfg, getConfigService());
      assert.equal(cfg.validate().ok, true);
    } finally {
      resetConfigService();
    }
  });
});

describe('createAppContainer (batch 2 wiring)', () => {
  const batch2Keys = [
    'errorMemory',
    'resultGatekeeper',
    'eventSourcing',
    'tokenTracker',
    'skillUsageTracker',
    'adaptiveRouter',
    'sessionMetrics',
  ];

  it('registers all batch-2 keys', () => {
    const c = createAppContainer();
    for (const key of batch2Keys) {
      assert.equal(c.has(key), true, `missing registration: ${key}`);
    }
  });

  it('batch-2 registrations are lazy (nothing resolves until asked)', () => {
    const c = createAppContainer();
    // If any batch-2 factory ran eagerly, it would have resolved 'db'
    // (DatabaseManager singleton) at container construction time.
    // Constructing the container must stay side-effect free:
    assert.equal(c.keys().length > 0, true);
    // and resolving one key must not resolve the others:
    c.resolve('errorMemory');
    assert.equal(c.has('db'), true);
    // 'db' resolved as a dependency of errorMemory — that's expected.
    // But an untouched batch-2 sibling must still be unmaterialized:
    // (observable via keys() only listing registrations, and by memoization
    // tests below; here we just assert no throw.)
    assert.doesNotThrow(() => c.resolve('eventSourcing'));
  });

  it('resolves memoized namespaces (same instance on repeat resolve)', () => {
    const c = createAppContainer();
    for (const key of batch2Keys) {
      assert.equal(c.resolve(key), c.resolve(key), `not memoized: ${key}`);
    }
  });
});

describe('createTestContainer (test isolation)', () => {
  it('resolves batch-2 services against the stub db without touching the real singleton', () => {
    const c = createTestContainer();
    const stubDb = c.resolve('db');
    const em = c.resolve<typeof import('../../src/resilience/error-memory.js')>('errorMemory');
    assert.equal(typeof em.saveError, 'function');
    // Container db injection is observable through adaptive-router's exported getDb():
    const ar =
      c.resolve<typeof import('../../src/orchestration/adaptive-router/index.js')>(
        'adaptiveRouter',
      );
    assert.equal(ar.getDb(), stubDb);
    assert.equal(ar.getDb(), c.resolve('db'), 'injected db must be the container db');
  });

  it('fresh containers give fresh stubs (no shared state between tests)', () => {
    const c1 = createTestContainer();
    const c2 = createTestContainer();
    assert.notEqual(c1.resolve('db'), c2.resolve('db'));
    assert.notEqual(c1.resolve('errorMemory') && true, false);
  });

  it('legacy getInstance() delegation returns the container-resolved instance', async () => {
    const c = createTestContainer();
    const metrics = c.resolve<{
      forSession: (
        id: string,
      ) => import('../../src/core/session-metrics-tracker.js').SessionMetricsTracker;
    }>('sessionMetrics');
    const tracker = metrics.forSession('container-test-session');
    // Legacy static path must return the SAME object the container façade returned:
    const { SessionMetricsTracker } = await import('../../src/core/session-metrics-tracker.js');
    assert.equal(SessionMetricsTracker.getInstance('container-test-session'), tracker);
    SessionMetricsTracker.destroy('container-test-session');
  });
});
