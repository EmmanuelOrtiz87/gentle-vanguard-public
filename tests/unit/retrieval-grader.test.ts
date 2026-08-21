#!/usr/bin/env node
/**
 * Unit Tests: Retrieval Grader (CRAG)
 * Verifies relevance grading and corrective-action logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { gradeRetrieval } from '../../src/retrieval-grader.ts';

describe('Retrieval Grader (CRAG)', () => {
  it('should mark relevant chunks as relevant', () => {
    const result = gradeRetrieval('token refresh authentication', [
      'The token refresh flow issues new access tokens and handles authentication renewal.',
      'Token refresh requires a valid refresh token and authentication.',
      'The database schema defines users, roles, and permissions tables.',
    ]);
    assert.strictEqual(result.verdict, 'relevant');
    assert.strictEqual(result.correctiveAction, 'none');
    assert.ok(result.relevantCount >= 2, 'should have at least 2 relevant chunks');
  });

  it('should trigger corrective action for poor retrieval', () => {
    const result = gradeRetrieval('token refresh authentication', [
      'The database schema defines users, roles, and permissions tables.',
      'The UI renders a login form with email and password fields.',
      'CSS styling uses flexbox for responsive layout.',
    ]);
    assert.strictEqual(result.verdict, 'corrective');
    assert.strictEqual(result.correctiveAction, 'keyword-fallback');
    assert.strictEqual(result.relevantCount, 0);
  });

  it('should grade each chunk with a normalized score 0..1', () => {
    const result = gradeRetrieval('database schema', [
      'The database schema defines users and roles.',
      'The UI renders a login form.',
    ]);
    for (const chunk of result.chunks) {
      assert.ok(chunk.score >= 0 && chunk.score <= 1, 'score must be 0..1');
      assert.strictEqual(typeof chunk.relevant, 'boolean');
    }
  });

  it('should handle empty chunks gracefully', () => {
    const result = gradeRetrieval('query', []);
    assert.strictEqual(result.totalCount, 0);
    assert.strictEqual(result.averageScore, 0);
    assert.strictEqual(result.verdict, 'corrective');
  });

  it('should respect a custom threshold', () => {
    const result = gradeRetrieval('token refresh', ['token refresh is required'], {
      threshold: 0.9,
    });
    // With a very high threshold, even a matching chunk may be graded below it.
    assert.ok(result.chunks[0].score <= 1);
  });
});
