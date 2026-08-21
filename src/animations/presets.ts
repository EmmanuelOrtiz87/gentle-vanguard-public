/**
 * Animation presets — named, reusable timing + easing recipes.
 *
 * A preset declares *how* an animation should feel (duration, easing, optional
 * stagger) without coupling to a specific implementation. Variant modules
 * (fade/slide/scale/...) consume presets to produce keyframes; the CSS layer
 * maps them onto classes; the React hooks feed them to the Web Animations API.
 */

import type { EasingName } from './utils';

export interface AnimationPreset {
  name: string;
  /** Duration in milliseconds. */
  duration: number;
  /** Easing function name, or a raw CSS easing string (`cubic-bezier(...)`). */
  easing: EasingName | string;
  /** Optional leading delay in milliseconds. */
  delay?: number;
  /** Stagger delay in milliseconds between grouped items. */
  stagger?: number;
  /** Fill mode for CSS/WAAPI keyframes. */
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
  /** True for persistent/looping animations (shimmer, pulse, spin). */
  loop?: boolean;
}

export const presetEasing = {
  /** Standard Material-style curve. */
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Fast start that decelerates — ideal for entrances. */
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  /** Accelerating curve — ideal for exits. */
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Emphasized, slightly bouncy curve for hero/scale moments. */
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  /** Springy overshoot curve for pops and badges. */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export const PRESETS = {
  fadeIn: {
    name: 'fadeIn',
    duration: 240,
    easing: 'decelerate',
    fill: 'both',
  } satisfies AnimationPreset,
  fadeOut: {
    name: 'fadeOut',
    duration: 200,
    easing: 'accelerate',
    fill: 'both',
  } satisfies AnimationPreset,
  slideUp: {
    name: 'slideUp',
    duration: 320,
    easing: 'emphasized',
    fill: 'both',
  } satisfies AnimationPreset,
  slideDown: {
    name: 'slideDown',
    duration: 320,
    easing: 'decelerate',
    fill: 'both',
  } satisfies AnimationPreset,
  scalePop: {
    name: 'scalePop',
    duration: 260,
    easing: 'spring',
    fill: 'both',
  } satisfies AnimationPreset,
  bounce: {
    name: 'bounce',
    duration: 600,
    easing: 'easeOutBounce',
    loop: true,
  } satisfies AnimationPreset,
  shimmer: {
    name: 'shimmer',
    duration: 1400,
    easing: 'linear',
    loop: true,
  } satisfies AnimationPreset,
  pulse: {
    name: 'pulse',
    duration: 1000,
    easing: 'easeInOutQuad',
    loop: true,
  } satisfies AnimationPreset,
  spin: {
    name: 'spin',
    duration: 900,
    easing: 'linear',
    loop: true,
  } satisfies AnimationPreset,
} as const satisfies Record<string, AnimationPreset>;

export type PresetName = keyof typeof PRESETS;

/** Resolves a preset by name, falling back to `fadeIn`. */
export function getPreset(name: PresetName | string): AnimationPreset {
  const direct = PRESETS[name as PresetName];
  if (direct) return direct;
  const byDisplayName = Object.values(PRESETS).find((p) => p.name === name);
  return byDisplayName ?? PRESETS.fadeIn;
}

/**
 * Maps a preset easing (name or raw string) to a consumable CSS easing value.
 * Names from the `easings` family are converted to `cubic-bezier` equivalents.
 */
export function resolvePresetEasing(preset: AnimationPreset): string {
  switch (preset.easing) {
    case 'linear':
      return 'linear';
    case 'easeInQuad':
      return 'cubic-bezier(0.55, 0.09, 0.68, 0.53)';
    case 'easeOutQuad':
      return 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    case 'easeInOutQuad':
      return 'cubic-bezier(0.45, 0, 0.55, 1)';
    case 'easeInCubic':
      return 'cubic-bezier(0.55, 0.06, 0.68, 0.19)';
    case 'easeOutCubic':
      return 'cubic-bezier(0.22, 0.61, 0.36, 1)';
    case 'easeInOutCubic':
      return 'cubic-bezier(0.65, 0, 0.35, 1)';
    case 'easeInQuart':
      return 'cubic-bezier(0.5, 0.05, 0.68, 0.19)';
    case 'easeOutQuart':
      return 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    case 'easeInOutQuart':
      return 'cubic-bezier(0.76, 0, 0.24, 1)';
    case 'easeInQuint':
      return 'cubic-bezier(0.76, 0.05, 0.86, 0.06)';
    case 'easeOutQuint':
      return 'cubic-bezier(0.22, 1, 0.36, 1)';
    case 'easeInOutQuint':
      return 'cubic-bezier(0.83, 0, 0.17, 1)';
    case 'easeInCirc':
      return 'cubic-bezier(0.6, 0.04, 0.98, 0.34)';
    case 'easeOutCirc':
      return 'cubic-bezier(0.08, 0.82, 0.17, 1)';
    case 'easeInOutCirc':
      return 'cubic-bezier(0.85, 0, 0.15, 1)';
    case 'easeInExpo':
      return 'cubic-bezier(0.7, 0, 0.84, 0)';
    case 'easeOutExpo':
      return 'cubic-bezier(0.16, 1, 0.3, 1)';
    case 'easeInOutExpo':
      return 'cubic-bezier(0.87, 0, 0.13, 1)';
    case 'easeInBack':
      return 'cubic-bezier(0.36, 0, 0.66, -0.56)';
    case 'easeOutBack':
      return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    case 'easeInOutBack':
      return 'cubic-bezier(0.68, -0.6, 0.32, 1.6)';
    case 'easeOutElastic':
      return 'cubic-bezier(0.4, 1.5, 0.6, 1)';
    case 'easeOutBounce':
      return 'cubic-bezier(0.22, 1.4, 0.36, 1)';
    default:
      return preset.easing;
  }
}

/** Resolves the full easing string for a preset, including named curves. */
export function resolveEasing(preset: AnimationPreset): string {
  if (preset.easing.startsWith('cubic-bezier') || preset.easing === 'linear') {
    return preset.easing;
  }
  return resolvePresetEasing(preset);
}

export type TimingInput = PresetName | AnimationPreset | TimingOptions | undefined;

export interface TimingOptions {
  duration?: number;
  easing?: string;
  delay?: number;
  fill?: AnimationPreset['fill'];
  loop?: boolean;
}

export interface ResolvedTiming {
  duration: number;
  easing: string;
  delay: number;
  fill: 'none' | 'forwards' | 'backwards' | 'both';
  loop: boolean;
}

/**
 * Normalizes any timing input (preset name, preset object, or raw options)
 * into a fully-resolved timing record used by the variant generators.
 */
export function resolveTiming(input: TimingInput = 'fadeIn'): ResolvedTiming {
  let preset: AnimationPreset;
  let overrides: TimingOptions | undefined;

  if (typeof input === 'string') {
    preset = getPreset(input);
  } else if (input && 'name' in input) {
    preset = input as AnimationPreset;
  } else if (input) {
    preset = PRESETS.fadeIn;
    overrides = input as TimingOptions;
  } else {
    preset = PRESETS.fadeIn;
  }

  return {
    duration: overrides?.duration ?? preset.duration,
    easing: overrides?.easing ?? resolveEasing(preset),
    delay: overrides?.delay ?? preset.delay ?? 0,
    fill: overrides?.fill ?? preset.fill ?? 'none',
    loop: overrides?.loop ?? preset.loop ?? false,
  };
}
