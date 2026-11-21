import assert from 'node:assert/strict';
import test from 'node:test';
import { opencodeSubagentName } from '../../../src/tokens/token-ingest/readers.js';

test('opencodeSubagentName prefers the agent column and falls back to the title suffix', () => {
  assert.equal(opencodeSubagentName({ agent: 'explore', title: 'anything' }), 'explore');
  assert.equal(
    opencodeSubagentName({ agent: null, title: 'Validar stack (@general subagent)' }),
    'general',
  );
  assert.equal(
    opencodeSubagentName({ agent: '', title: 'Crear documentación (@doc-agent subagent)' }),
    'doc-agent',
  );
  assert.equal(opencodeSubagentName({ agent: null, title: 'main session' }), undefined);
  assert.equal(opencodeSubagentName({}), undefined);
});
