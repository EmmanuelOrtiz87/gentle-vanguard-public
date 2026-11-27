import assert from 'node:assert/strict';
import { test } from 'node:test';
import prettier from 'prettier';
import {
  canonicalStorage,
  normalizeStorage,
  validatePlatformTitle,
} from '../../scripts/alexandria/verify-documentation.js';

test('formatted storage archives preserve prose, emphasis and link destinations', async () => {
  const original =
    '<p><strong>Scope:</strong> <a href="https://example.com/pages/123">Shared reference</a></p>';
  const formatted = await canonicalStorage(original);
  assert.equal(await canonicalStorage(formatted), await canonicalStorage(original));
  assert.notEqual(await canonicalStorage(original.replace('/123', '/456')), formatted);
});

test('server editor metadata does not mask changes to a source link or inline emphasis', () => {
  const planned =
    '<p><strong>Scope</strong> <a href="https://example.com/pages/123">DGO &amp; SKY+</a></p>';
  const actual = planned.replace('<p>', '<p local-id="server-id">');
  assert.equal(normalizeStorage(planned), normalizeStorage(actual));
  assert.notEqual(normalizeStorage(planned), normalizeStorage(actual.replace('/123', '/456')));
  assert.notEqual(normalizeStorage(planned), normalizeStorage(actual.replace(/strong/g, 'em')));
});

test('a platform entry needs a supported prefix and a nonempty system name', () => {
  assert.equal(validatePlatformTitle('[SKY] - Selfcare — Digital', 'SKY'), true);
  assert.equal(validatePlatformTitle('[OTT] - Selfcare', 'SKY'), false);
  assert.equal(validatePlatformTitle('[DTV] - ', 'DTV'), false);
  assert.equal(validatePlatformTitle('[OTHER] - Product', 'OTHER'), false);
});

test('formatted Confluence macro parameters can reorder without losing their values', async () => {
  const macro = (first: string, second: string) =>
    `<ac:structured-macro ac:name="status"><ac:parameter ac:name="${first}">${first === 'title' ? 'REQUIRED' : 'Red'}</ac:parameter><ac:parameter ac:name="${second}">${second === 'title' ? 'REQUIRED' : 'Red'}</ac:parameter></ac:structured-macro>`;
  const archive = await prettier.format(macro('title', 'colour'), { parser: 'html' });
  const server = macro('colour', 'title');
  assert.equal(await canonicalStorage(archive), await canonicalStorage(server));
  assert.notEqual(
    await canonicalStorage(archive),
    await canonicalStorage(server.replace('REQUIRED', 'OPTIONAL')),
  );
});

test('parameter sorting preserves content between separate parameter runs', () => {
  const body =
    '<ac:structured-macro><ac:parameter ac:name="z">Z</ac:parameter><p>Keep this boundary</p><ac:parameter ac:name="a">A</ac:parameter></ac:structured-macro>';
  assert.equal(normalizeStorage(body), body);
});
