import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('stack MCP exposes the side-effect-free shorts preview tool', () => {
  const source = readFileSync('src/mcp/stack-mcp-server.ts', 'utf8');
  assert.match(source, /content_shorts_preview/);
  assert.match(source, /REQUIRES_APPROVAL/);
  assert.match(source, /remoteCallMade: false/);
  assert.match(source, /content_shorts_enqueue/);
  assert.match(source, /CONFIRMATION_REQUIRED/);
  assert.match(source, /CONTENT_CMS_UNAVAILABLE/);
  assert.match(source, /content_shorts_run/);
  assert.match(source, /content_shorts_workflow/);
  assert.match(source, /CONTENT_CMS_UNAVAILABLE_OR_TIMEOUT/);
  assert.match(source, /remotePublication: false/);
});
