#!/usr/bin/env node
/**
 * Gate de frescura/regresion del grafo de graphify: la reconstruccion sin
 * medicion convierte un build parcial en "fresco". Un grafo sano tiene miles
 * de nodos; perder >20% es sintoma de parser roto o build incompleto.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateGraphDelta,
  readBaseline,
  readGraphStats,
} from '../../src/integrations/graphify-refresh-autostart.ts';

describe('graphify stats', () => {
  it('lee nodes y links del graph.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-graphify-'));
    const path = join(dir, 'graph.json');
    writeFileSync(path, JSON.stringify({ nodes: [{}, {}, {}], links: [{}, {}] }));
    try {
      assert.deepEqual(readGraphStats(path), { nodes: 3, links: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('acepta edges como alias de links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-graphify-'));
    const path = join(dir, 'graph.json');
    writeFileSync(path, JSON.stringify({ nodes: [{}], edges: [{}, {}, {}, {}] }));
    try {
      assert.deepEqual(readGraphStats(path), { nodes: 1, links: 4 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un grafo sin nodes[] no se mide (null, no 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-graphify-'));
    const path = join(dir, 'graph.json');
    writeFileSync(path, JSON.stringify({ links: [] }));
    try {
      assert.equal(readGraphStats(path), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('baseline invalido o ausente se lee como null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gv-graphify-'));
    const path = join(dir, 'baseline.json');
    try {
      assert.equal(readBaseline(path), null);
      writeFileSync(path, JSON.stringify({ nodes: 'muchos' }));
      assert.equal(readBaseline(path), null);
      writeFileSync(path, JSON.stringify({ nodes: 100, links: 7, measuredAt: 'x' }));
      assert.deepEqual(readBaseline(path), { nodes: 100, links: 7, measuredAt: 'x' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('regresion del grafo', () => {
  const baseline = { nodes: 1000, links: 2000, measuredAt: '2026-11-01T00:00:00Z' };

  it('sin baseline la primera medicion establece referencia', () => {
    const d = evaluateGraphDelta({ nodes: 800, links: 900 }, null);
    assert.equal(d.regressed, false);
    assert.match(d.message, /sin baseline/);
  });

  it('una caida mayor al 20% es regresion', () => {
    const d = evaluateGraphDelta({ nodes: 700, links: 900 }, baseline);
    assert.equal(d.regressed, true);
    assert.equal(d.dropPct, 30);
  });

  it('una caida menor al 20% no es regresion', () => {
    const d = evaluateGraphDelta({ nodes: 850, links: 900 }, baseline);
    assert.equal(d.regressed, false);
    assert.equal(d.dropPct, 15);
  });

  it('crecer nunca es regresion', () => {
    const d = evaluateGraphDelta({ nodes: 1200, links: 2400 }, baseline);
    assert.equal(d.regressed, false);
    assert.match(d.message, /\+20%/);
  });

  it('un baseline diminuto no dispara regresion por proporcion', () => {
    const d = evaluateGraphDelta({ nodes: 5, links: 1 }, { nodes: 40, links: 10, measuredAt: '' });
    assert.equal(d.regressed, false);
  });
});
