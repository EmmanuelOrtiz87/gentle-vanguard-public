/**
 * Unit tests del demo-recorder (autoría de guiones con Playwright).
 * Uso: npx tsx --test tests/unit/demo-recorder.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertCodegen } from '../../src/tools/demo-recorder.js';

const FIXTURE = `
const { test, expect } = require('@playwright/test');
test('demo', async ({ page }) => {
  await page.goto('http://127.0.0.1:4010/');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.locator('#q').fill('llavero');
  await page.keyboard.press('Enter');
  await page.getByLabel('Teléfono').fill('+5492645000123');
  await page.getByText('Consultar con Genesis').click();
  await page.waitForTimeout(1200);
});
`;

test('convierte el JS de codegen en pasos neutrales', () => {
  const s = convertCodegen(FIXTURE, 'demo', 'http://127.0.0.1:4010/');
  assert.equal(s.version, 1);
  assert.equal(s.name, 'demo');
  assert.equal(s.steps.length, 7);
  assert.deepEqual(s.steps[0], { action: 'goto', url: 'http://127.0.0.1:4010/' });
  assert.deepEqual(s.steps[1], { action: 'click', role: 'button', name: 'Buscar' });
  assert.deepEqual(s.steps[2], { action: 'fill', css: '#q', value: 'llavero' });
  assert.deepEqual(s.steps[3], { action: 'press', key: 'Enter' });
  assert.deepEqual(s.steps[4], { action: 'fill', label: 'Teléfono', value: '+5492645000123' });
  assert.deepEqual(s.steps[5], { action: 'click', text: 'Consultar con Genesis' });
  assert.deepEqual(s.steps[6], { action: 'wait', ms: 1200 });
});

test('ignora líneas que no son acciones (imports, test(), cierres)', () => {
  const s = convertCodegen('const { test } = require("x");\ntest("d", async ({ page }) => {\n  await page.waitForTimeout(500);\n});', 'x', 'u');
  assert.equal(s.steps.length, 1);
  assert.deepEqual(s.steps[0], { action: 'wait', ms: 500 });
});

test('guion sin pasos no rompe', () => {
  const s = convertCodegen('// nada', 'vacio', 'u');
  assert.deepEqual(s.steps, []);
});
