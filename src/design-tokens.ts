#!/usr/bin/env node
/**
 * Design Token System — typography scales, semantic color palettes, spacing,
 * border-radius and elevation tokens with WCAG contrast checking.
 *
 * Absorbed from the "UI-UX-Pro-Max" skill concept as a native TypeScript module.
 * Generates a complete DesignTokens object from a small config:
 *
 *   - Typography: modular scale (major/minor third, perfect fourth, ...)
 *   - Colors:     semantic scales (50-950) generated from a base hex
 *   - Spacing:    4px-based scale
 *   - Border radius + shadow/elevation tokens
 *
 * Also exports WCAG 2.1 contrast utilities (relative luminance, contrast ratio,
 * AA/AAA thresholds) used by the CLI's `--check` command.
 */

export type ColorStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

export interface ColorScale {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950: string;
}

export type TypeSizeName =
  | 'display-xl'
  | 'display-lg'
  | 'display'
  | 'display-sm'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'body-lg'
  | 'body'
  | 'body-sm'
  | 'small'
  | 'caption';

export interface TypeSize {
  px: number;
  rem: number;
  lineHeight: number;
}

export interface DesignTokens {
  name: string;
  typography: {
    fonts: { primary: string; mono: string; display: string };
    sizes: Record<TypeSizeName, TypeSize>;
    weights: Record<string, number>;
  };
  colors: {
    primary: ColorScale;
    neutral: ColorScale;
    semantic: {
      success: ColorScale;
      warning: ColorScale;
      error: ColorScale;
      info: ColorScale;
    };
  };
  spacing: Record<string, { px: number; rem: number }>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
}

export interface TokenConfig {
  name?: string;
  /** Base hex for the primary scale (the 500 step). */
  primary: string;
  /** Named neutral palette (slate/gray/zinc/neutral/stone) or base hex. */
  neutral?: string;
  /** Semantic overrides: named palette or base hex per role. */
  semantic?: Partial<Record<'success' | 'warning' | 'error' | 'info', string>>;
  fonts?: { primary?: string; mono?: string; display?: string };
  /** Base font size in px used to derive rem (default 16). */
  baseFontSize?: number;
  /** Modular scale ratio (1.25 major third, 1.333 perfect fourth, ...). */
  ratio?: number;
}

export interface ContrastPair {
  foreground: string;
  background: string;
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
}

// ─── Color math ───────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '');
  let r: number;
  let g: number;
  let b: number;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else {
    const full = raw.length === 6 ? raw : raw.slice(0, 6);
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return [r, g, b];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number): string => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** Mix `colorA` (weight = ratio) with `colorB` (weight = 1-ratio). */
export function mix(colorA: string, colorB: string, ratio: number): string {
  const [ar, ag, ab] = hexToRgb(colorA);
  const [br, bg, bb] = hexToRgb(colorB);
  const t = Math.max(0, Math.min(1, ratio));
  return rgbToHex(ar * t + br * (1 - t), ag * t + bg * (1 - t), ab * t + bb * (1 - t));
}

/** WCAG 2.1 relative luminance (0..1). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const linear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.1 contrast ratio between two colors (1..21). */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.1 thresholds. */
export const WCAG = {
  aaNormal: 4.5,
  aaLarge: 3,
  aaaNormal: 7,
  aaaLarge: 4.5,
} as const;

export function checkPair(foreground: string, background: string): ContrastPair {
  const ratio = contrastRatio(foreground, background);
  return {
    foreground,
    background,
    ratio,
    aaNormal: ratio >= WCAG.aaNormal,
    aaLarge: ratio >= WCAG.aaLarge,
    aaaNormal: ratio >= WCAG.aaaNormal,
    aaaLarge: ratio >= WCAG.aaaLarge,
  };
}

/** Best of #FFFFFF / #000000 text color on a given background (AA normal). */
export function accessibleTextOn(background: string): string {
  const white = checkPair('#FFFFFF', background);
  const black = checkPair('#000000', background);
  if (white.aaNormal) return '#FFFFFF';
  if (black.aaNormal) return '#000000';
  return white.ratio >= black.ratio ? '#FFFFFF' : '#000000';
}

export function isAccessible(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA',
  largeText = false,
): boolean {
  const pair = checkPair(foreground, background);
  if (level === 'AAA') return largeText ? pair.aaaLarge : pair.aaaNormal;
  return largeText ? pair.aaLarge : pair.aaNormal;
}

// ─── Color scale generation ───────────────────────────────────────────────────

interface ScaleWeight {
  target: 'white' | 'black';
  ratio: number;
}

const SCALE_WEIGHTS: Record<ColorStep, ScaleWeight> = {
  50: { target: 'white', ratio: 0.08 },
  100: { target: 'white', ratio: 0.15 },
  200: { target: 'white', ratio: 0.3 },
  300: { target: 'white', ratio: 0.45 },
  400: { target: 'white', ratio: 0.65 },
  500: { target: 'white', ratio: 1 },
  600: { target: 'black', ratio: 0.82 },
  700: { target: 'black', ratio: 0.65 },
  800: { target: 'black', ratio: 0.5 },
  900: { target: 'black', ratio: 0.35 },
  950: { target: 'black', ratio: 0.22 },
};

const COLOR_STEPS: ColorStep[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Generate a 50-950 color scale from a base color (the 500 step). */
export function generateColorScale(base: string): ColorScale {
  const scale = {} as ColorScale;
  for (const step of COLOR_STEPS) {
    const { target, ratio } = SCALE_WEIGHTS[step];
    scale[step] = target === 'white' ? mix(base, '#FFFFFF', ratio) : mix(base, '#000000', ratio);
  }
  return scale;
}

// ─── Named palettes ───────────────────────────────────────────────────────────

export const NAMED_PALETTES: Record<string, ColorScale> = {
  slate: {
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    300: '#CBD5E1',
    400: '#94A3B8',
    500: '#64748B',
    600: '#475569',
    700: '#334155',
    800: '#1E293B',
    900: '#0F172A',
    950: '#020617',
  },
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
    950: '#030712',
  },
  zinc: {
    50: '#FAFAFA',
    100: '#F4F4F5',
    200: '#E4E4E7',
    300: '#D4D4D8',
    400: '#A1A1AA',
    500: '#71717A',
    600: '#52525B',
    700: '#3F3F46',
    800: '#27272A',
    900: '#18181B',
    950: '#09090B',
  },
  neutral: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#0A0A0A',
  },
  stone: {
    50: '#FAFAF9',
    100: '#F5F5F4',
    200: '#E7E5E4',
    300: '#D6D3D1',
    400: '#A8A29E',
    500: '#78716C',
    600: '#57534E',
    700: '#44403C',
    800: '#292524',
    900: '#1C1917',
    950: '#0C0A09',
  },
  blue: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A',
    950: '#172554',
  },
  indigo: {
    50: '#EEF2FF',
    100: '#E0E7FF',
    200: '#C7D2FE',
    300: '#A5B4FC',
    400: '#818CF8',
    500: '#6366F1',
    600: '#4F46E5',
    700: '#4338CA',
    800: '#3730A3',
    900: '#312E81',
    950: '#1E1B4B',
  },
  green: {
    50: '#F0FDF4',
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: '#86EFAC',
    400: '#4ADE80',
    500: '#22C55E',
    600: '#16A34A',
    700: '#15803D',
    800: '#166534',
    900: '#14532D',
    950: '#052E16',
  },
  red: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    200: '#FECACA',
    300: '#FCA5A5',
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D',
    950: '#450A0A',
  },
  amber: {
    50: '#FFFBEB',
    100: '#FEF3C7',
    200: '#FDE68A',
    300: '#FCD34D',
    400: '#FBBF24',
    500: '#F59E0B',
    600: '#D97706',
    700: '#B45309',
    800: '#92400E',
    900: '#78350F',
    950: '#451A03',
  },
  purple: {
    50: '#FAF5FF',
    100: '#F3E8FF',
    200: '#E9D5FF',
    300: '#D8B4FE',
    400: '#C084FC',
    500: '#A855F7',
    600: '#9333EA',
    700: '#7E22CE',
    800: '#6B21A8',
    900: '#581C87',
    950: '#3B0764',
  },
  cyan: {
    50: '#ECFEFF',
    100: '#CFFAFE',
    200: '#A5F3FC',
    300: '#67E8F9',
    400: '#22D3EE',
    500: '#06B6D4',
    600: '#0891B2',
    700: '#0E7490',
    800: '#155E75',
    900: '#164E63',
    950: '#083344',
  },
};

export function resolveScale(source: string): ColorScale {
  const key = source.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_PALETTES, key)) return NAMED_PALETTES[key];
  return generateColorScale(source);
}

// ─── Typography ───────────────────────────────────────────────────────────────

export interface TypeScaleOptions {
  base?: number;
  ratio?: number;
}

export const TYPOGRAPHY_RATIOS: Record<string, number> = {
  'minor-second': 1.067,
  'major-second': 1.125,
  'minor-third': 1.2,
  'major-third': 1.25,
  'perfect-fourth': 1.333,
  'augmented-fourth': 1.414,
  'perfect-fifth': 1.5,
  golden: 1.618,
};

const TYPE_STEPS: { name: TypeSizeName; offset: number; lineHeight: number }[] = [
  { name: 'caption', offset: -2, lineHeight: 1.6 },
  { name: 'small', offset: -1, lineHeight: 1.5 },
  { name: 'body', offset: 0, lineHeight: 1.5 },
  { name: 'body-lg', offset: 1, lineHeight: 1.5 },
  { name: 'h4', offset: 2, lineHeight: 1.3 },
  { name: 'h3', offset: 3, lineHeight: 1.25 },
  { name: 'h2', offset: 4, lineHeight: 1.2 },
  { name: 'h1', offset: 5, lineHeight: 1.15 },
  { name: 'display-sm', offset: 6, lineHeight: 1.1 },
  { name: 'display', offset: 7, lineHeight: 1.1 },
  { name: 'display-lg', offset: 8, lineHeight: 1.1 },
  { name: 'display-xl', offset: 9, lineHeight: 1.05 },
];

/** Modular type scale: base * ratio^offset for each step. */
export function generateTypographyScale(
  options: TypeScaleOptions = {},
): Record<TypeSizeName, TypeSize> {
  const base = options.base ?? 16;
  const ratio = options.ratio ?? TYPOGRAPHY_RATIOS['major-third'];
  const sizes = {} as Record<TypeSizeName, TypeSize>;
  for (const step of TYPE_STEPS) {
    const px = Math.round(base * Math.pow(ratio, step.offset));
    sizes[step.name] = {
      px,
      rem: round4(px / (options.base ?? 16)),
      lineHeight: step.lineHeight,
    };
  }
  return sizes;
}

export const DEFAULT_WEIGHTS: Record<string, number> = {
  thin: 100,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

export const DEFAULT_FONTS = {
  primary: `'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif`,
  mono: `'JetBrains Mono', 'Cascadia Code', ui-monospace, SFMono-Regular, monospace`,
  display: `'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif`,
} as const;

// ─── Spacing, radius, shadows ─────────────────────────────────────────────────

export function generateSpacing(base = 16, unit = 4): Record<string, { px: number; rem: number }> {
  const multipliers = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16];
  const spacing: Record<string, { px: number; rem: number }> = {};
  for (const m of multipliers) {
    const px = m * unit;
    spacing[String(m)] = { px, rem: round4(px / base) };
  }
  return spacing;
}

export const BORDER_RADIUS: Record<string, string> = {
  none: '0',
  xs: '0.125rem',
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
};

export const SHADOWS: Record<string, string> = {
  none: 'none',
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  focus: '0 0 0 3px rgb(59 130 246 / 0.5)',
};

// ─── Assembler ────────────────────────────────────────────────────────────────

export function buildDesignTokens(config: TokenConfig): DesignTokens {
  const base = config.baseFontSize ?? 16;
  const neutralSource = config.neutral ?? 'slate';
  const semanticDefaults: Record<'success' | 'warning' | 'error' | 'info', string> = {
    success: 'green',
    warning: 'amber',
    error: 'red',
    info: 'blue',
  };

  const semantic = {} as DesignTokens['colors']['semantic'];
  for (const role of ['success', 'warning', 'error', 'info'] as const) {
    semantic[role] = resolveScale(config.semantic?.[role] ?? semanticDefaults[role]);
  }

  return {
    name: config.name ?? 'design-system',
    typography: {
      fonts: {
        primary: config.fonts?.primary ?? DEFAULT_FONTS.primary,
        mono: config.fonts?.mono ?? DEFAULT_FONTS.mono,
        display: config.fonts?.display ?? DEFAULT_FONTS.display,
      },
      sizes: generateTypographyScale({
        base,
        ratio: config.ratio ?? TYPOGRAPHY_RATIOS['major-third'],
      }),
      weights: { ...DEFAULT_WEIGHTS },
    },
    colors: {
      primary: resolveScale(config.primary),
      neutral: resolveScale(neutralSource),
      semantic,
    },
    spacing: generateSpacing(base),
    borderRadius: { ...BORDER_RADIUS },
    shadows: { ...SHADOWS },
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ─── Serializers ──────────────────────────────────────────────────────────────

export function tokensToCSS(tokens: DesignTokens): string {
  const lines: string[] = [
    `/* Design tokens for ${tokens.name} — auto-generated, do not edit directly */`,
    ':root {',
  ];

  const scaleVars = (prefix: string, scale: ColorScale): void => {
    for (const step of COLOR_STEPS) lines.push(`  --color-${prefix}-${step}: ${scale[step]};`);
  };

  lines.push('  /* Colors */');
  scaleVars('primary', tokens.colors.primary);
  scaleVars('neutral', tokens.colors.neutral);
  for (const role of ['success', 'warning', 'error', 'info'] as const) {
    scaleVars(role, tokens.colors.semantic[role]);
  }

  lines.push('  /* Typography */');
  lines.push(`  --font-family-primary: ${tokens.typography.fonts.primary};`);
  lines.push(`  --font-family-mono: ${tokens.typography.fonts.mono};`);
  lines.push(`  --font-family-display: ${tokens.typography.fonts.display};`);
  for (const [name, size] of Object.entries(tokens.typography.sizes)) {
    lines.push(`  --text-${name}-size: ${size.px}px;`);
    lines.push(`  --text-${name}-line-height: ${Math.round(size.px * size.lineHeight)}px;`);
  }
  for (const [name, weight] of Object.entries(tokens.typography.weights)) {
    lines.push(`  --font-weight-${name}: ${weight};`);
  }

  lines.push('  /* Spacing */');
  for (const [name, size] of Object.entries(tokens.spacing)) {
    lines.push(`  --space-${name}: ${size.px}px;`);
  }

  lines.push('  /* Border radius */');
  for (const [name, value] of Object.entries(tokens.borderRadius)) {
    lines.push(`  --radius-${name}: ${value};`);
  }

  lines.push('  /* Shadows */');
  for (const [name, value] of Object.entries(tokens.shadows)) {
    lines.push(`  --shadow-${name}: ${value};`);
  }

  lines.push('}');
  return lines.join('\n') + '\n';
}

export function tokensToSCSS(tokens: DesignTokens): string {
  const lines: string[] = [
    `// Design tokens for ${tokens.name} — auto-generated, do not edit directly`,
    '',
  ];

  const scaleVars = (prefix: string, scale: ColorScale): void => {
    for (const step of COLOR_STEPS) lines.push(`$color-${prefix}-${step}: ${scale[step]};`);
  };

  lines.push('// Colors');
  scaleVars('primary', tokens.colors.primary);
  scaleVars('neutral', tokens.colors.neutral);
  for (const role of ['success', 'warning', 'error', 'info'] as const) {
    scaleVars(role, tokens.colors.semantic[role]);
  }

  lines.push('');
  lines.push('// Typography');
  lines.push(`$font-family-primary: ${tokens.typography.fonts.primary};`);
  lines.push(`$font-family-mono: ${tokens.typography.fonts.mono};`);
  lines.push(`$font-family-display: ${tokens.typography.fonts.display};`);
  for (const [name, size] of Object.entries(tokens.typography.sizes)) {
    lines.push(`$text-${name}-size: ${size.px}px;`);
    lines.push(`$text-${name}-line-height: ${Math.round(size.px * size.lineHeight)}px;`);
  }
  for (const [name, weight] of Object.entries(tokens.typography.weights)) {
    lines.push(`$font-weight-${name}: ${weight};`);
  }

  lines.push('');
  lines.push('// Spacing');
  for (const [name, size] of Object.entries(tokens.spacing)) {
    lines.push(`$space-${name}: ${size.px}px;`);
  }

  lines.push('');
  lines.push('// Border radius');
  for (const [name, value] of Object.entries(tokens.borderRadius)) {
    lines.push(`$radius-${name}: ${value};`);
  }

  lines.push('');
  lines.push('// Shadows');
  for (const [name, value] of Object.entries(tokens.shadows)) {
    lines.push(`$shadow-${name}: ${value};`);
  }

  return lines.join('\n') + '\n';
}
