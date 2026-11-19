import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sessionSummaryTopic } from '../../src/knowledge/engram-session-bridge.js';

describe('engram session summary topic', () => {
  it('keeps one upsertable topic per unique session', () => {
    assert.strictEqual(
      sessionSummaryTopic('session-20261119T0127'),
      'session/summary-session-20261119t0127',
    );
    assert.strictEqual(
      sessionSummaryTopic('9f1c2ab4-77de-4f16-9a55-1f3b2c4d5e6f'),
      'session/summary-9f1c2ab4-77de-4f16-9a55-1f3b2c4d5e6f',
    );
  });

  it('collapses shared labels into a rolling topic instead of appending', () => {
    assert.strictEqual(sessionSummaryTopic('gentle-vanguard'), 'session/latest-gentle-vanguard');
    assert.strictEqual(sessionSummaryTopic('workspace_local'), 'session/latest-workspace-local');
  });

  it('sanitizes and caps long identifiers', () => {
    const topic = sessionSummaryTopic(`session-20261119T0127-${'x'.repeat(80)}`);
    assert.match(topic, /^session\/summary-[a-z0-9-]+$/);
    assert.ok(topic.length <= 'session/summary-'.length + 48);
  });
});
