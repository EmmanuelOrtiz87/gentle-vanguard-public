import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMockDashboardData } from '../../src/dashboard/dashboard-data.ts';

const data = getMockDashboardData();

describe('Dashboard Data Structure', () => {
  it('should have tokens object with required fields', () => {
    assert.ok(data.tokens);
    assert.equal(typeof data.tokens.used, 'number');
    assert.equal(typeof data.tokens.limit, 'number');
    assert.equal(typeof data.tokens.cost, 'number');
  });

  it('should have sessions object with required fields', () => {
    assert.ok(data.sessions);
    assert.equal(typeof data.sessions.total, 'number');
    assert.equal(typeof data.sessions.active, 'number');
    assert.equal(typeof data.sessions.today, 'number');
  });

  it('should have git object with required fields', () => {
    assert.ok(data.git);
    assert.equal(typeof data.git.commits, 'number');
    assert.equal(typeof data.git.prsMerged, 'number');
    assert.equal(typeof data.git.contributors, 'number');
  });

  it('should have health object with required fields', () => {
    assert.ok(data.health);
    assert.equal(typeof data.health.status, 'string');
    assert.equal(typeof data.health.routing, 'number');
  });

  it('should not exceed token budget', () => {
    assert.ok(data.tokens.used <= data.tokens.limit);
  });
});

describe('Dashboard i18n Keys', () => {
  const translations = {
    en: { welcome: 'Dashboard', tokens: 'Tokens', health: 'Health' },
    es: { welcome: 'Tablero', tokens: 'Tokens', salud: 'Salud' },
    pt: { welcome: 'Painel', tokens: 'Tokens', saude: 'Saude' },
  };

  it('should have all required locales', () => {
    assert.ok(translations.en);
    assert.ok(translations.es);
    assert.ok(translations.pt);
  });

  it('should have welcome key in all locales', () => {
    for (const [lang, keys] of Object.entries(translations)) {
      assert.ok(keys.welcome, `Missing welcome in ${lang}`);
    }
  });
});
