#!/usr/bin/env node
/**
 * Unit Tests: SDD research lane (src/sdd/sdd-research.ts)
 *
 * Covers the PURE layer: question parsing, artifact assembly (versioned
 * contract, uncertainty flags, stats) and markdown rendering with the
 * claim-mapping scaffolds. No network, no crawler.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  ARTIFACT_VERSION,
  parseQuestions,
  buildArtifact,
  renderMarkdown,
  type ResearchSource,
} from '../../src/sdd/sdd-research.ts';

function src(url: string, score: number, relevant = true): ResearchSource {
  return {
    url,
    title: `Title ${url}`,
    description: 'desc',
    score,
    relevant,
    fetchedAt: '2026-08-27T00:00:00.000Z',
  };
}

test('parseQuestions: split por ; y newline, trim, dedupe case-insensitive', () => {
  const qs = parseQuestions('  cómo medir X ; \n Patrones de Circuit Breaker; cómo medir x ;; ');
  assert.deepStrictEqual(qs, ['cómo medir X', 'Patrones de Circuit Breaker']);
});

test('parseQuestions: entrada vacía → []', () => {
  assert.deepStrictEqual(parseQuestions(';;; \n  '), []);
});

test('buildArtifact: contrato versionado + stats correctos', () => {
  const a = buildArtifact(
    'health-check',
    ['q1', 'q2'],
    [
      { verdict: 'relevant', confidence: 0.62, sources: [src('a', 0.9), src('b', 0.2, false)] },
      { verdict: 'corrective', confidence: 0.1, sources: [] },
    ],
    '2026-08-27T01:00:00.000Z',
  );
  assert.strictEqual(a.artifact, ARTIFACT_VERSION);
  assert.strictEqual(a.feature, 'health-check');
  assert.strictEqual(a.mode, 'auto-deterministic');
  assert.strictEqual(a.stats.questions, 2);
  assert.strictEqual(a.stats.sources, 2);
  assert.strictEqual(a.stats.relevantSources, 1);
  assert.strictEqual(a.stats.lowConfidence, 1); // q2 corrective + low score
  assert.strictEqual(a.questions[0].uncertain, false);
  assert.strictEqual(a.questions[1].uncertain, true);
  assert.deepStrictEqual(a.questions[0].claims, []); // agent layer fills these
  assert.deepStrictEqual(a.contradictions, []);
});

test('buildArtifact: mismatch questions/results lanza error', () => {
  assert.throws(() => buildArtifact('f', ['q1'], []), /mismatch/);
});

test('buildArtifact: confianza bajo threshold marca uncertain aunque verdict sea relevant', () => {
  const a = buildArtifact('f', ['q'], [{ verdict: 'relevant', confidence: 0.2, sources: [] }]);
  assert.strictEqual(a.questions[0].uncertain, true);
});

test('renderMarkdown: secciones clave + scaffolds de capa agente', () => {
  const a = buildArtifact(
    'demo',
    ['pregunta sin fuentes'],
    [{ verdict: 'corrective', confidence: 0.1, sources: [] }],
  );
  const md = renderMarkdown(a);
  assert.ok(md.includes(ARTIFACT_VERSION), 'versioned header');
  assert.ok(md.includes('## pregunta sin fuentes'));
  assert.ok(md.includes('Sin fuentes relevantes'), 'evidence-gap callout');
  assert.ok(md.includes('## Mapeo claim → fuente'), 'claim scaffold');
  assert.ok(md.includes('## Contradicciones'), 'contradiction scaffold');
  assert.ok(md.includes('Capa agente'), 'agent-layer notes');
});

test('renderMarkdown: tabla de fuentes con deep score', () => {
  const s = src('https://x', 0.5);
  s.deepScore = 0.8;
  const a = buildArtifact('demo', ['q'], [{ verdict: 'relevant', confidence: 0.5, sources: [s] }]);
  const md = renderMarkdown(a);
  assert.ok(md.includes('0.5 → deep 0.8'), 'deep score rendered');
  assert.ok(md.includes('](https://x)'), 'source link rendered');
});
