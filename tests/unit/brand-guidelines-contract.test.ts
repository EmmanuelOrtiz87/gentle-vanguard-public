import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('active GV brand skill routes to the current canon without prescribing superseded identity', () => {
  const skill = readFileSync(resolve('skills/brand-guidelines-gv/SKILL.md'), 'utf8');
  for (const source of ['docs/brand/BRAND-KIT.md', 'docs/brand/TOKENS-v2.json', 'docs/brand/OFFICIAL-ASSETS-2026-10.md', 'packages/gv-design-system']) assert.ok(skill.includes(source), `Missing authority: ${source}`);
  assert.doesNotMatch(skill, /#00BFFF|#0D1117|#A855F7|Lora|GENTLE_VANGUARD_MASTER/i);
  assert.match(skill, /conformance.*--url/);
});

test('public brand configuration uses the exact joined brand name', () => {
  const brand = JSON.parse(readFileSync(resolve('config/brand.json'), 'utf8'));
  assert.equal(brand.name, 'GentleVanguard');
  assert.equal(brand.displayName, 'GentleVanguard');
});
