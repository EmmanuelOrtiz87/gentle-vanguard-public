/**
 * GentleVanguard Deck Canon — design tokens
 *
 * Source of truth: docs/brand/TOKENS-v2.json (v2.1.0) + docs/brand/BRAND-KIT.md (v2.0 APPLICATION FINAL).
 * This module is a faithful transcription of the canon for the PPTX surface.
 * Do not introduce values that are not in the canon: every hex below is traceable
 * to a token in TOKENS-v2.json.
 *
 * The 5-key theme contract (primary / secondary / accent / light / bg) is what the
 * pptx skill requires. The extended palette lives here and is imported directly by
 * the layout kit.
 */

/* ------------------------------------------------------------------ *
 * Canonical palette (TOKENS-v2.json)
 * ------------------------------------------------------------------ */
export const CANON = {
  bg: '0B1020', // Midnight Navy - background.base
  bgElevated: '151921', // background.elevated - cards
  bgDeep: '090C11', // background.deep - code blocks
  surface: '1a1f2a', // surface.base - cards, containers
  surfaceRaised: '252b38', // surface.raised - dropdowns, modals

  cyan: '06B6D4', // accent.cyan - PRIMARY accent
  cyanDeep: '0891b2', // accent.cyanDeep - hover/pressed
  cyanSoft: '67e8f9', // accent.cyanSoft
  accentText: '06B6D4', // accent.accentText (dark mode value)
  accentInk: '052f36', // accent.accentInk - text ON an accent surface
  accentAltText: 'c4b5fd', // accent.accentAltText (dark mode value)

  purple: '8B5CF6', // accent.purple - SECONDARY accent
  purpleDeep: '7c3aed', // accent.purpleDeep
  purpleSoft: 'c4b5fd',
  gold: 'fbbf24', // accent.gold - premium moments, use with moderation

  text: 'e8eef4', // text.primary
  muted: 'c4cdd8', // text.secondary
  faint: '8b95a8', // text.muted - meta, metadata
  disabled: '5a6370', // text.disabled

  success: '4ade80', // status.success
  warning: 'f4bb4f', // status.warning
  error: 'ee6d75', // status.error
  info: '22d3ee', // status.info
};

/** Light-mode variants defined in TOKENS-v2.json (lightMode blocks). */
export const CANON_LIGHT = {
  bg: 'f5f7fb',
  bgElevated: 'ffffff',
  surface: 'ffffff',
  surfaceRaised: 'eef1f7',
  border: 'd8dee9',
  accentText: '155e75', // accent.accentText.lightMode - 6.78:1 on #f5f7fb
  accentAltText: '6d28d9', // accent.accentAltText.lightMode
  accentInk: 'ffffff',
  text: '0B1020',
  muted: '3d4756',
  faint: '6b7688',
};

/* ------------------------------------------------------------------ *
 * Typography (typography.* in TOKENS-v2.json)
 * ------------------------------------------------------------------ */
export const FONTS = {
  display: 'Poppins', // display - titles, hero, wordmark
  body: 'Inter', // body
  mono: 'JetBrains Mono', // mono - code
};

/**
 * Type scale for the 10 x 5.625in canvas.
 * The canon sizes (52/40/28/22px web) are scaled for a slide at 16:9 where
 * the canvas is smaller than a 1440px-wide web viewport.
 */
export const TYPE = {
  hero: 40, // cover title
  h1: 27, // slide title
  h2: 19, // card / section title
  h3: 14, // card body heading
  body: 11.5, // body copy
  bodySm: 10, // dense body copy
  caption: 9, // meta, labels
  eyebrow: 9, // uppercase kicker
  metric: 30, // metric number
  metricSm: 22,
};

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */
export const GEO = {
  W: 10, // LAYOUT_16x9 canvas width  (inches)
  H: 5.625, // LAYOUT_16x9 canvas height (inches)
  M: 0.6, // side margin
  get CW() {
    return this.W - this.M * 2; // 8.8in content width
  },
  topEdge: 0.06, // full-bleed brand bar height
  eyebrowY: 0.3,
  titleY: 0.56,
  bodyY: 1.42, // first content baseline
  contentBottom: 4.98,
  footerY: 5.12,
  pageNumX: 9.3, // skill contract: page number badge near x 9.3, y 5.1
  pageNumY: 5.1,
  gutter: 0.28,
  radius: 0.12,
};

/* ------------------------------------------------------------------ *
 * Theme variants
 * ------------------------------------------------------------------ */

/** Dark canon - the primary theme. Futuristic, on-brand, maximum contrast. */
export const THEME_DARK = {
  primary: CANON.text, // body text
  secondary: CANON.muted, // muted body text
  accent: CANON.cyan, // primary accent
  light: CANON.surface, // card / panel background
  bg: CANON.bg, // slide background
};

/** Light corporate - boardroom register, for print-friendly and daytime rooms. */
export const THEME_LIGHT = {
  primary: CANON_LIGHT.text,
  secondary: CANON_LIGHT.muted,
  accent: CANON_LIGHT.accentText,
  light: CANON_LIGHT.surface,
  bg: CANON_LIGHT.bg,
};

/**
 * Palette resolved for a theme variant.
 * Layouts read from this so one layout code path serves every variant.
 */
export function palette(theme) {
  const isDark = theme.bg === CANON.bg;
  return {
    isDark,
    bg: theme.bg,
    bgElevated: isDark ? CANON.bgElevated : CANON_LIGHT.bgElevated,
    bgDeep: isDark ? CANON.bgDeep : CANON_LIGHT.bgElevated,
    surface: theme.light,
    surfaceRaised: isDark ? CANON.surfaceRaised : CANON_LIGHT.surfaceRaised,
    border: isDark ? CANON.surfaceRaised : CANON_LIGHT.border,
    text: theme.primary,
    muted: theme.secondary,
    faint: isDark ? CANON.faint : CANON_LIGHT.faint,
    accent: theme.accent,
    accentSoft: isDark ? CANON.cyanSoft : CANON_LIGHT.accentText,
    accentInk: isDark ? CANON.accentInk : CANON_LIGHT.accentInk,
    accentAlt: isDark ? CANON.accentAltText : CANON_LIGHT.accentAltText,
    purple: isDark ? CANON.purple : CANON_LIGHT.accentAltText,
    purpleSoft: isDark ? CANON.purpleSoft : CANON_LIGHT.accentAltText,
    gold: CANON.gold,
    success: CANON.success,
    warning: CANON.warning,
    error: CANON.error,
    info: CANON.info,
    line: isDark ? '252b38' : 'd8dee9',
  };
}

export const THEMES = {
  dark: THEME_DARK,
  light: THEME_LIGHT,
  /**
   * Hybrid direction: dark canon on covers, section dividers and the closing
   * slide; light corporate surface on content slides. The compiler picks the
   * surface per layout, so the base entry is the dark canon.
   */
  hybrid: THEME_DARK,
};
