import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkClaim, factCheckText } from '../../src/security/fact-checker.js';

describe('fact-checker', () => {
  it('supports a claim backed by a source', () => {
    const claim = 'The Eiffel Tower is in Paris, France.';
    const sources = ['The Eiffel Tower is located in Paris, France.'];
    const r = checkClaim(claim, sources);
    assert.strictEqual(r.supported, true);
    assert.ok(r.confidence > 0.2);
  });

  it('rejects a claim not backed by sources', () => {
    const claim = 'The moon is made of green cheese.';
    const sources = ['The Eiffel Tower is located in Paris, France.'];
    const r = checkClaim(claim, sources);
    assert.strictEqual(r.supported, false);
  });

  it('verifies text fully supported by sources', () => {
    const text = 'The Eiffel Tower is in Paris. The Louvre is also in Paris.';
    const sources = ['The Eiffel Tower is located in Paris, France.', 'The Louvre museum is in Paris.'];
    const r = factCheckText(text, sources);
    assert.strictEqual(r.verdict, 'verified');
  });

  it('flags unverified text', () => {
    const text = 'The moon is made of green cheese and orbits Mars.';
    const sources = ['The Eiffel Tower is located in Paris, France.'];
    const r = factCheckText(text, sources);
    assert.strictEqual(r.verdict, 'unverified');
  });
});