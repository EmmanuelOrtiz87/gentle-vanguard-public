import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkModelHealth, detectErrorType, getFallbackModel } from '../../src/ml/smart-model-router.js';
import { ModelBroker } from '../../src/ml/model-broker.js';
import { readFileSync } from 'node:fs';

const localEntry = {
  provider: 'ollama',
  tier: 'local' as const,
  costPer1kTokens: { input: 0, output: 0 },
  health: {
    status: 'available' as const,
    lastChecked: '2026-08-08T12:00:00Z',
    consecutiveErrors: 0,
    avgLatencyMs: 1200,
    checkEndpoint: 'http://127.0.0.1:11434/api/tags',
  },
  fallbackChain: [],
  capabilities: ['code'],
  maxTokens: 32000,
  requiresLocal: true,
};

describe('smart model router local health checks', () => {
  it('keeps the configured primary model addressable without claiming it is currently healthy', () => {
    const registry = JSON.parse(readFileSync('config/model-health-registry.json', 'utf8'));
    const primary = registry.routingRules.orchestrator.primary;
    assert.ok(registry.models[primary], `primary ${primary} must have a registry entry`);
    assert.equal(registry.models[primary].health.status, 'unknown');
    assert.equal(registry.models[primary].provider, 'opencode-zen-C');
  });

  it('classifies HTTP 429 rate-limit responses as quota errors', () => {
    const registry = JSON.parse(readFileSync('config/model-health-registry.json', 'utf8'));
    assert.equal(detectErrorType('HTTP 429 Too Many Requests', registry.errorPatterns), 'quotaExceeded');
  });

  it('does not report unknown or stale broker models as available', async () => {
    const status = await new ModelBroker().getStatus();
    assert.ok(Object.values(status).some((entry) => entry.health === 'unknown' && !entry.available));
  });

  it('does not report a simulated broker result as a successful delegation', async () => {
    const result = await new ModelBroker().delegate({ agentName: 'sdd-apply', task: 'Return READY' });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /not implemented|not execute/i);
  });

  it('can be imported without running the CLI entrypoint', () => {
    const moduleUrl = new URL('../../src/ml/smart-model-router.ts', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });

  it('confirms the requested local model is in the Ollama catalog', async () => {
    const checkFetch: typeof fetch = async () => Response.json({ models: [{ name: 'qwen2.5-coder:14b' }] });
    const health = await checkModelHealth('ollama/qwen2.5-coder:14b', localEntry, checkFetch);
    assert.equal(health.status, 'available');
    assert.equal(health.consecutiveErrors, 0);
    assert.ok(health.avgLatencyMs !== null);
  });

  it('marks a missing local model unavailable instead of treating a healthy server as ready', async () => {
    const checkFetch: typeof fetch = async () => Response.json({ models: [{ name: 'qwen2.5-coder:7b' }] });
    const health = await checkModelHealth('ollama/qwen2.5-coder:14b', localEntry, checkFetch);
    assert.equal(health.status, 'unavailable');
    assert.match(health.lastError ?? '', /not installed/i);
  });

  it('does not reuse a stale available cache when the local endpoint is failing', async () => {
    const checkFetch: typeof fetch = async () => new Response('down', { status: 503 });
    const health = await checkModelHealth('ollama/qwen2.5-coder:14b', localEntry, checkFetch);
    assert.equal(health.status, 'unavailable');
    assert.equal(health.consecutiveErrors, 1);
  });

  it('leaves remote-provider status unknown without making a network request', async () => {
    let requested = false;
    const checkFetch: typeof fetch = async () => {
      requested = true;
      throw new Error('should not call fetch');
    };
    const health = await checkModelHealth('zen/model', { ...localEntry, requiresLocal: false }, checkFetch);
    assert.equal(health.status, 'unknown');
    assert.equal(requested, false);
  });

  it('retains a remote health result only while its cache is fresh', async () => {
    const checkFetch: typeof fetch = async () => { throw new Error('remote probe not allowed'); };
    const health = await checkModelHealth('zen/model', {
      ...localEntry,
      requiresLocal: false,
      health: { ...localEntry.health, lastChecked: new Date().toISOString() },
    }, checkFetch);
    assert.equal(health.status, 'available');
  });

  it('does not route to an unknown or stale fallback model', () => {
    const now = {
      provider: 'primary', tier: 'premium' as const, costPer1kTokens: { input: 0, output: 0 },
      health: { status: 'unavailable' as const, lastChecked: new Date().toISOString(), consecutiveErrors: 1, avgLatencyMs: null },
      fallbackChain: ['fallback'], capabilities: ['code'], maxTokens: 32000,
    };
    const staleFallback = {
      provider: 'remote', tier: 'free' as const, costPer1kTokens: { input: 0, output: 0 },
      health: { status: 'available' as const, lastChecked: '2026-08-08T12:00:00Z', consecutiveErrors: 0, avgLatencyMs: 1000 },
      fallbackChain: [], capabilities: ['code'], maxTokens: 32000,
    };
    const result = getFallbackModel('primary', { models: { primary: now, fallback: staleFallback } });
    assert.equal(result, null);
  });

  it('routes to a recently verified available fallback model', () => {
    const current = {
      provider: 'primary', tier: 'premium' as const, costPer1kTokens: { input: 0, output: 0 },
      health: { status: 'unavailable' as const, lastChecked: new Date().toISOString(), consecutiveErrors: 1, avgLatencyMs: null },
      fallbackChain: ['fallback'], capabilities: ['code'], maxTokens: 32000,
    };
    const fallback = {
      provider: 'local', tier: 'local' as const, costPer1kTokens: { input: 0, output: 0 },
      health: { status: 'available' as const, lastChecked: new Date().toISOString(), consecutiveErrors: 0, avgLatencyMs: 40 },
      fallbackChain: [], capabilities: ['code'], maxTokens: 32000,
    };
    assert.equal(getFallbackModel('primary', { models: { primary: current, fallback } })?.model, 'fallback');
  });
});
