#!/usr/bin/env node
/**
 * Unit Tests: Design Token System
 * Verifies typography scale generation, semantic color palettes, spacing,
 * WCAG contrast math, and serialization.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildDesignTokens,
  checkPair,
  contrastRatio,
  generateColorScale,
  generateTypographyScale,
  hexToRgb,
  isAccessible,
  mix,
  relativeLuminance,
  resolveScale,
  tokensToCSS,
  tokensToSCSS,
  WCAG,
  type ColorScale,
  type DesignTokens,
} from '../../src/design-tokens.ts';

describe('Design Token System', () => {
  describe('color math', () => {
    it('parses 3-digit and 6-digit hex', () => {
      assert.deepStrictEqual(hexToRgb('#fff'), [255, 255, 255]);
      assert.deepStrictEqual(hexToRgb('#000000'), [0, 0, 0]);
      assert.deepStrictEqual(hexToRgb('#6366f1'), [99, 102, 241]);
    });

    it('rejects invalid hex', () => {
      assert.throws(() => hexToRgb('#zzz'));
    });

    it('mixes colors by weight', () => {
      assert.strictEqual(mix('#000000', '#FFFFFF', 1), '#000000');
      assert.strictEqual(mix('#000000', '#FFFFFF', 0), '#FFFFFF');
      assert.strictEqual(mix('#FF0000', '#FFFFFF', 0.5), '#FF8080');
    });

    it('computes WCAG relative luminance', () => {
      assert.strictEqual(relativeLuminance('#FFFFFF'), 1);
      assert.strictEqual(relativeLuminance('#000000'), 0);
    });

    it('computes contrast ratio', () => {
      assert.strictEqual(contrastRatio('#000000', '#FFFFFF'), 21);
      assert.strictEqual(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
    });

    it('flags AA/AAA pass status', () => {
      const pair = checkPair('#FFFFFF', '#0F172A');
      assert.ok(pair.ratio >= WCAG.aaNormal);
      assert.ok(pair.aaNormal);
      assert.ok(pair.aaaNormal);
      assert.ok(isAccessible('#FFFFFF', '#0F172A', 'AA'));
      assert.ok(isAccessible('#FFFFFF', '#0F172A', 'AAA'));
    });

    it('picks accessible text color for a background', () => {
      assert.strictEqual(isAccessible('#FFFFFF', '#000000', 'AA'), true);
      assert.strictEqual(isAccessible('#F5F5F5', '#FFFFFF', 'AA'), false);
    });
  });

  describe('color scales', () => {
    it('generates all 11 steps', () => {
      const scale = generateColorScale('#6366f1');
      const steps: (keyof ColorScale)[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
      for (const step of steps) {
        assert.match(scale[step], /^#[0-9A-F]{6}$/);
      }
    });

    it('keeps the base color as the 500 step', () => {
      const scale = generateColorScale('#00BFFF');
      assert.strictEqual(scale[500], '#00BFFF');
    });

    it('resolves named palettes', () => {
      const slate = resolveScale('slate');
      assert.strictEqual(slate[900], '#0F172A');
      const generated = resolveScale('#6366f1');
      assert.strictEqual(generated[500], '#6366F1');
    });
  });

  describe('typography scale', () => {
    it('produces 12 steps with base 16 ratio 1.25', () => {
      const scale = generateTypographyScale({ base: 16, ratio: 1.25 });
      assert.strictEqual(Object.keys(scale).length, 12);
      assert.strictEqual(scale.body.px, 16);
      assert.strictEqual(scale.body.rem, 1);
      assert.strictEqual(scale.body.lineHeight, 1.5);
    });

    it('body is larger than caption, smaller than display', () => {
      const scale = generateTypographyScale({ base: 16, ratio: 1.25 });
      assert.ok(scale.caption.px < scale.body.px);
      assert.ok(scale.body.px < scale.display.px);
    });

    it('supports perfect fourth ratio', () => {
      const scale = generateTypographyScale({ base: 16, ratio: 1.333 });
      assert.ok(scale.h1.px > scale.body.px);
    });
  });

  describe('assembled tokens', () => {
    it('builds a complete DesignTokens object', () => {
      const tokens: DesignTokens = buildDesignTokens({
        name: 'test',
        primary: '#00BFFF',
        neutral: 'slate',
      });
      assert.strictEqual(tokens.name, 'test');
      assert.strictEqual(tokens.colors.primary[500], '#00BFFF');
      assert.strictEqual(tokens.colors.neutral[900], '#0F172A');
      assert.ok(tokens.colors.semantic.success[500]);
      assert.ok(tokens.colors.semantic.warning[500]);
      assert.ok(tokens.colors.semantic.error[500]);
      assert.ok(tokens.colors.semantic.info[500]);
      assert.strictEqual(tokens.spacing['1'].px, 4);
      assert.strictEqual(tokens.spacing['4'].px, 16);
      assert.strictEqual(tokens.borderRadius.lg, '0.5rem');
      assert.ok(tokens.shadows.md);
    });

    it('serializes to CSS and SCSS', () => {
      const tokens = buildDesignTokens({ primary: '#00BFFF' });
      const css = tokensToCSS(tokens);
      assert.match(css, /--color-primary-500: #00BFFF/);
      assert.match(css, /--text-body-size: 16px/);
      assert.match(css, /--radius-lg: 0.5rem/);
      const scss = tokensToSCSS(tokens);
      assert.match(scss, /\$color-primary-500: #00BFFF/);
    });
  });
});
