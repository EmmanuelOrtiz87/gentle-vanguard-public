import test from 'node:test';
import assert from 'node:assert/strict';
import { compactHistory, truncateHistory } from '../../src/tools/context-truncator.js';

const longMessages = Array.from({ length: 24 }, (_, index) => ({
  role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
  content:
    `message-${index} ` +
    'This is repeated context that should be summarized instead of carried verbatim. '.repeat(12),
}));

test('context truncator bounds generated summaries by token budget', () => {
  const result = truncateHistory(longMessages, {
    maxTurns: 4,
    minTurns: 1,
    summaryThreshold: 5,
    maxSummaryTokens: 24,
  });

  assert.ok(result.savedTokens > 0);
  assert.ok(result.truncatedMessages);
  const summary = result.truncatedMessages?.find((message) =>
    message.content.includes('previous messages summarized'),
  );
  assert.ok(summary);
  assert.ok(Math.ceil(summary.content.length / 4) <= 24);
});

test('compactHistory returns the truncation result without telemetry by default', () => {
  const result = compactHistory(longMessages, {
    maxTurns: 6,
    minTurns: 1,
    summaryThreshold: 5,
  });

  assert.equal(result.originalCount, longMessages.length);
  assert.ok(result.truncatedCount < result.originalCount);
  assert.ok(result.savedTokens > 0);
});
