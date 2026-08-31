import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  ConfigService,
  getConfigService,
  resetConfigService,
  createTestConfig,
} from '../../src/config/config-service.js';

describe('ConfigService', () => {
  beforeEach(() => resetConfigService());
  afterEach(() => resetConfigService());

  it('valid env passes local validation', () => {
    const cfg = createTestConfig({ AGENT_MODEL: 'test-model', PORT: '4321' });
    const result = cfg.validate();
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  });

  it('missing optional vars are fine in local mode (ADR-0017)', () => {
    const cfg = createTestConfig({ SLACK_WEBHOOK_URL: undefined, AGENT_MODEL: undefined });
    const result = cfg.validate();
    assert.equal(result.ok, true);
  });

  it('strict mode fails on missing STRICT_REQUIRED vars', () => {
    const cfg = createTestConfig({});
    const result = cfg.validate({ mode: 'strict' });
    assert.equal(result.ok, false);
    const keys = result.issues.map((i) => i.key);
    assert.ok(keys.includes('SLACK_WEBHOOK_URL'));
    assert.ok(keys.includes('ALERT_WEBHOOK_URL'));
    assert.ok(result.summary.includes('strict'));
  });

  it('strict mode passes when required vars provided', () => {
    const cfg = createTestConfig({
      SLACK_WEBHOOK_URL: 'https://hooks.slack.example/x',
      ALERT_WEBHOOK_URL: 'https://alerts.example/x',
    });
    assert.equal(cfg.validate({ mode: 'strict' }).ok, true);
  });

  it('invalid types produce clear issues (bad PORT)', () => {
    const cfg = createTestConfig({ PORT: 'not-a-port' });
    const result = cfg.validate();
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.key === 'PORT'));
    assert.ok(result.summary.includes('PORT'));
  });

  it('invalid NODE_ENV is rejected', () => {
    const cfg = createTestConfig({ NODE_ENV: 'staging' });
    assert.equal(cfg.validate().ok, false);
  });

  it('empty strings treated as unset (defaults apply)', () => {
    const cfg = createTestConfig({ GV_QUIET: '  ', NODE_ENV: '' });
    const result = cfg.validate();
    assert.equal(result.ok, true);
    assert.equal(cfg.get('GV_QUIET'), false);
    assert.equal(cfg.get('NODE_ENV'), 'development');
  });

  it('get returns schema defaults and coerced values', () => {
    const cfg = createTestConfig({ PORT: '8080', AGENT_TEMPERATURE: '0.2' });
    cfg.validate();
    assert.equal(cfg.get('PORT'), 8080);
    assert.equal(cfg.get('AGENT_TEMPERATURE'), 0.2);
    assert.equal(cfg.get('NODE_ENV'), 'test'); // from createTestConfig base
    assert.equal(cfg.get('GV_QUIET'), true);
    assert.equal(cfg.get('SLACK_WEBHOOK_URL'), undefined); // optional, unset
  });

  it('get throws on a key whose value is invalid', () => {
    const cfg = createTestConfig({ PORT: 'nope' });
    assert.throws(() => cfg.get('PORT'), /PORT/);
  });

  it('isSet distinguishes explicit values from defaults', () => {
    const cfg = createTestConfig({ AGENT_MODEL: 'm1' });
    cfg.validate();
    assert.equal(cfg.isSet('AGENT_MODEL'), true);
    assert.equal(cfg.isSet('ORCHESTRATOR_MODEL'), false);
  });

  it('bool accepts 1/0/yes/no forms', () => {
    assert.equal(createTestConfig({ GV_QUIET: '1' }).validate() && true, true);
    const cfg = createTestConfig({ GV_QUIET: 'yes' });
    cfg.validate();
    assert.equal(cfg.get('GV_QUIET'), true);
    const cfgNo = createTestConfig({ GV_QUIET: '0' });
    cfgNo.validate();
    assert.equal(cfgNo.get('GV_QUIET'), false);
  });

  it('singleton accessor caches; reset clears', () => {
    const a = getConfigService();
    const b = getConfigService();
    assert.equal(a, b);
    resetConfigService();
    const c = getConfigService();
    assert.notEqual(a, c);
  });

  it('createTestConfig never mutates process.env or the singleton', () => {
    const before = process.env.AGENT_MODEL;
    const cfg = createTestConfig({ AGENT_MODEL: 'iso-model' });
    cfg.validate();
    assert.equal(process.env.AGENT_MODEL, before);
    assert.notEqual(cfg, getConfigService());
  });

  it('temperature out of range rejected', () => {
    const cfg = createTestConfig({ AGENT_TEMPERATURE: '5' });
    assert.equal(cfg.validate().ok, false);
  });
});

describe('ConfigService (class, arbitrary env)', () => {
  it('accepts an explicit env object', () => {
    const cfg = new ConfigService({ NODE_ENV: 'production', PORT: '9090' } as NodeJS.ProcessEnv);
    const result = cfg.validate();
    assert.equal(result.ok, true);
    assert.equal(cfg.get('PORT'), 9090);
    assert.equal(cfg.validation?.ok, true);
  });
});
