import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  optimizeLLMUserPrompt,
  preProcessLLMInput,
  previousTurnsFromSessionState,
  wrapLLMCall,
} from '../../src/ml/llm-call-wrapper.js';

describe('llm-call-wrapper cache identity', () => {
  it('separates options that change prompt or output processing', () => {
    const prompt = `cache-key-isolation-${Date.now()}`;
    const base = preProcessLLMInput(prompt, { model: 'test-model', profile: 'ultra' });
    const differentProfile = preProcessLLMInput(prompt, {
      model: 'test-model',
      profile: 'simple',
    });
    const differentHistory = preProcessLLMInput(prompt, {
      model: 'test-model',
      profile: 'ultra',
      previousTurns: ['previous decision'],
    });

    assert.notEqual(base.cacheKey, differentProfile.cacheKey);
    assert.notEqual(base.cacheKey, differentHistory.cacheKey);
  });

  it('packs previous turns into the processed prompt without telemetry side effects', () => {
    const prompt = 'Summarize the current decision.';
    const previousTurns = Array.from(
      { length: 18 },
      (_, index) =>
        `historical turn ${index}: ` +
        'Repeated logs and already-confirmed decisions should not be carried verbatim. '.repeat(8),
    );

    const result = preProcessLLMInput(prompt, {
      model: 'test-model',
      skipCompression: true,
      previousTurns,
    });

    assert.match(result.processedPrompt, /\[Previous context\]/);
    assert.match(result.processedPrompt, /\[Current request\]/);
    assert.match(result.processedPrompt, /Summarize the current decision/);
    assert.equal(result.contextCompacted, true);
    assert.ok(result.contextTokensSaved > 0);
    assert.ok(result.compressedTokens < result.originalTokens);
  });

  it('extracts bounded previous turns from session state summaries', () => {
    const turns = previousTurnsFromSessionState(
      {
        sessionId: 'session-history-test',
        agent: 'test',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTokens: 0,
        totalCost: 0,
        messageCount: 4,
        turns: [
          { message: 'first', inputSummary: 'ignored because limit keeps tail' },
          { message: 'second', inputSummary: 'selected input', outputSummary: 'selected output' },
          { message: 'third', toolCalls: 'tool-a' },
        ],
      },
      2,
    );

    assert.equal(turns.length, 2);
    assert.match(turns[0], /selected input/);
    assert.match(turns[1], /tool-a/);
  });

  it('wrapLLMCall accepts session-history-resolved previousTurns', async () => {
    const result = await wrapLLMCall(
      async (prompt) => `seen:${prompt.includes('[Previous context]')}`,
      'Continue',
      {
        model: 'test-model',
        skipCache: true,
        skipCompression: true,
        previousTurns: Array.from(
          { length: 16 },
          (_, index) => `turn ${index} ${'resolved context '.repeat(10)}`,
        ),
        recordContextTelemetry: false,
      },
    );

    assert.equal(result.contextCompacted, true);
    assert.match(result.response, /seen:true/);
    assert.ok(result.tokensSaved > 0);
  });

  it('optimizes user prompts through the shared app helper', () => {
    const previousSession = process.env.GENTLE_VANGUARD_SESSION_ID;
    const previousAppSession = process.env.TEST_APP_SESSION_ID;
    const previousHistoryTurns = process.env.TEST_APP_LLM_HISTORY_TURNS;
    delete process.env.GENTLE_VANGUARD_SESSION_ID;
    delete process.env.TEST_APP_SESSION_ID;
    process.env.TEST_APP_LLM_HISTORY_TURNS = '4';
    try {
      const prompt = optimizeLLMUserPrompt('Build a compact answer', {
        skill: 'test-app',
        context: 'test-app:unit',
        envSessionKeys: ['TEST_APP_SESSION_ID'],
        envHistoryTurnsKey: 'TEST_APP_LLM_HISTORY_TURNS',
        recordContextTelemetry: false,
      });

      assert.equal(prompt, 'Build a compact answer');
    } finally {
      if (previousSession === undefined) delete process.env.GENTLE_VANGUARD_SESSION_ID;
      else process.env.GENTLE_VANGUARD_SESSION_ID = previousSession;
      if (previousAppSession === undefined) delete process.env.TEST_APP_SESSION_ID;
      else process.env.TEST_APP_SESSION_ID = previousAppSession;
      if (previousHistoryTurns === undefined) delete process.env.TEST_APP_LLM_HISTORY_TURNS;
      else process.env.TEST_APP_LLM_HISTORY_TURNS = previousHistoryTurns;
    }
  });
});
