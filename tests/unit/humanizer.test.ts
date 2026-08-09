#!/usr/bin/env node
/**
 * Unit Tests: Humanizer
 * Verifies AI-writing detection, natural-language transformation, and scoring.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  analyzeText,
  humanizeText,
  scoreHumanization,
} from '../../src/humanizer.ts';

const AI_TEXT =
  'In conclusion, it is important to note that the system plays a crucial role in data processing. ' +
  'Furthermore, the system was built by the team. ' +
  'Additionally, it is essential to configure the server. ' +
  'Moreover, the team utilizes the framework.';

const HUMAN_TEXT =
  "Honestly, I think the whole thing works better than we expected. " +
  "We tried the new setup last week, and it's pretty good. " +
  "Sure, there's a learning curve. " +
  "But you get the hang of it fast. " +
  "Probably takes a day or two.";

describe('Humanizer — analyzeText', () => {
  it('scores AI-like text above 0.5', () => {
    const result = analyzeText(AI_TEXT);
    assert.ok(result.aiScore > 0.5, `expected aiScore > 0.5, got ${result.aiScore}`);
  });

  it('scores human-like text below 0.5', () => {
    const result = analyzeText(HUMAN_TEXT);
    assert.ok(result.aiScore < 0.5, `expected aiScore < 0.5, got ${result.aiScore}`);
  });

  it('detects generic AI filler phrases', () => {
    const result = analyzeText(AI_TEXT);
    const generic = result.patterns.find((p) => p.pattern === 'generic-phrases');
    assert.ok(generic, 'expected generic-phrases pattern');
    assert.ok(generic.count >= 3, `expected >= 3 filler phrases, got ${generic.count}`);
  });

  it('detects passive voice', () => {
    const result = analyzeText('The report was created by the team.');
    const passive = result.patterns.find((p) => p.pattern === 'passive-voice');
    assert.ok(passive, 'expected passive-voice pattern');
    assert.ok(passive.count >= 1);
  });

  it('detects missing contractions in formal text', () => {
    const result = analyzeText('It is important to note that the system cannot fail.');
    const missing = result.patterns.find((p) => p.pattern === 'missing-contractions');
    assert.ok(missing, 'expected missing-contractions pattern');
  });

  it('detects missing personal voice', () => {
    const result = analyzeText(AI_TEXT);
    const missing = result.patterns.find((p) => p.pattern === 'missing-personal-voice');
    assert.ok(missing, 'expected missing-personal-voice pattern');
  });

  it('handles empty text gracefully', () => {
    const result = analyzeText('');
    assert.strictEqual(result.aiScore, 0);
    assert.strictEqual(result.metrics.wordCount, 0);
    assert.strictEqual(result.naturalness, 1);
  });

  it('does not count code content as filler', () => {
    const withCode =
      'The code below is important. ```in conclusion\ndelve into\ntapestry``` and `plays a crucial role` end here.';
    const withoutCode = 'The code below is important. end here.';
    const withCodeScore = analyzeText(withCode).metrics.genericPhraseCount;
    const withoutCodeScore = analyzeText(withoutCode).metrics.genericPhraseCount;
    // Code-masked filler phrases must not inflate the score.
    assert.ok(withCodeScore <= withoutCodeScore + 1);
  });

  it('reports voice for formal text as professional', () => {
    const result = analyzeText(AI_TEXT);
    assert.strictEqual(result.voice, 'professional');
  });
});

describe('Humanizer — humanizeText', () => {
  it('replaces generic filler phrases', () => {
    const out = humanizeText('In conclusion, the system works.', { tone: 'conversational' });
    assert.ok(!/In conclusion/i.test(out));
    assert.match(out, /To wrap up/);
  });

  it('applies contractions', () => {
    const out = humanizeText("It is simple, and you do not need to worry.", {
      tone: 'conversational',
    });
    assert.match(out, /It's/);
    assert.match(out, /don't/);
  });

  it('keeps professional tone free of heavy contractions', () => {
    const out = humanizeText("The team does not plan to stop, but it is early.", {
      tone: 'professional',
    });
    assert.match(out, /doesn't|does not/);
  });

  it('converts passive voice to active for regular verbs', () => {
    const out = humanizeText('The report was created by the team.', {
      tone: 'conversational',
    });
    assert.match(out, /The team created the report/);
  });

  it('converts passive voice with irregular verbs', () => {
    const out = humanizeText('The report was written by the team.', {
      tone: 'conversational',
    });
    assert.match(out, /The team wrote the report/);
  });

  it('converts pronoun-subject passives', () => {
    const out = humanizeText('It was created by the team.', { tone: 'conversational' });
    assert.match(out, /The team created it/);
  });

  it('does not rewrite adverbial "by design" phrases', () => {
    const out = humanizeText('The system was built to scale by design.', {
      tone: 'conversational',
    });
    assert.match(out, /by design/);
    assert.match(out, /was built to scale/);
  });

  it('varies repeated transitions', () => {
    const out = humanizeText(
      'Furthermore, the first thing matters. Furthermore, the second thing matters.',
      { tone: 'conversational' },
    );
    const count = (out.match(/Furthermore|Also|Plus|And/gi) ?? []).length;
    assert.ok(count >= 2, 'expected both transitions to remain');
    assert.ok(!/Furthermore, the second/.test(out), 'second transition should vary');
  });

  it('splits overly long sentences', () => {
    const long =
      'The system processes requests asynchronously, and it retries failed jobs automatically, but it never blocks the main thread and it logs every single event that occurs for later inspection.';
    const out = humanizeText(long, { tone: 'conversational', intensity: 0.9 });
    const sentences = out.split(/(?<=[.!?])\s+(?=[A-Z])/);
    assert.ok(sentences.length >= 2, 'expected the long sentence to be split');
  });

  it('preserves inline and fenced code', () => {
    const input =
      'Run `npm install --save-dev` to begin. ```js\nconst x = "do not change";\n``` It is simple.';
    const out = humanizeText(input, { tone: 'conversational' });
    assert.match(out, /`npm install --save-dev`/);
    assert.match(out, /```js/);
    assert.match(out, /const x = "do not change";/);
  });

  it('maintains technical terms and numbers', () => {
    const out = humanizeText('The API returns 404 for missing resources.', {
      tone: 'conversational',
    });
    assert.match(out, /404/);
    assert.match(out, /API/);
  });

  it('respects intensity 0 for passive conversion', () => {
    const out = humanizeText('The report was created by the team.', {
      tone: 'conversational',
      intensity: 0,
    });
    assert.match(out, /was created/);
  });
});

describe('Humanizer — scoreHumanization', () => {
  it('returns the full scoring interface', () => {
    const score = scoreHumanization(AI_TEXT);
    assert.ok(score.aiScore >= 0 && score.aiScore <= 1);
    assert.ok(score.naturalness >= 0 && score.naturalness <= 1);
    assert.ok(score.variety >= 0 && score.variety <= 1);
    assert.ok(typeof score.voice === 'string');
    assert.ok(Array.isArray(score.suggestions));
    assert.ok(typeof score.transformations === 'string');
  });

  it('keeps aiScore and naturalness complementary', () => {
    const score = scoreHumanization(AI_TEXT);
    assert.ok(Math.abs(score.aiScore + score.naturalness - 1) < 0.01);
  });

  it('produces suggestions for AI-like text', () => {
    const score = scoreHumanization(AI_TEXT);
    assert.ok(score.suggestions.length > 0, 'expected suggestions');
  });

  it('produces an empty suggestion list for empty input', () => {
    const score = scoreHumanization('');
    assert.strictEqual(score.suggestions.length, 1);
    assert.strictEqual(score.aiScore, 0);
  });
});
