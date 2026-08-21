/**
 * Morph variants — shape/layout morphing utilities. The FLIP-family helpers
 * morph between two rectangles using only `transform` (compositor-friendly);
 * `morphRadius` interpolates border radii; generic value morphing is provided
 * for custom properties.
 */

import {
  computeFlipDelta,
  flipInvertTransform,
  lerp,
  type AnimationKeyframe,
  type AnimationSequence,
  type Rect,
} from './utils';
import { resolveTiming } from './presets';

export interface MorphOptions {
  duration?: number;
  easing?: string;
  delay?: number;
  opacity?: boolean;
  transformOrigin?: string;
}

/**
 * Morph an element between two rectangles using translate + scale. Assumes the
 * element is laid out at `to`; the sequence opens at `from` and settles on the
 * resting position. Only `transform`/`opacity` animate, keeping it at 60fps.
 */
export function morphRect(from: Rect, to: Rect, options: MorphOptions = {}): AnimationSequence {
  const t = resolveTiming('slideUp');
  const delta = computeFlipDelta(from, to);
  const transformOrigin = options.transformOrigin ?? 'top left';
  const invert = flipInvertTransform(delta);

  const first: AnimationKeyframe = { transform: invert, transformOrigin };
  if (options.opacity) first.opacity = 0;
  const last: AnimationKeyframe = { transform: 'none', transformOrigin };
  if (options.opacity) last.opacity = 1;

  return {
    keyframes: [first, last],
    timing: {
      duration: options.duration ?? t.duration,
      easing: options.easing ?? 'cubic-bezier(0.2, 0, 0, 1)',
      delay: options.delay ?? 0,
      fill: 'both',
    },
  };
}

interface RadiusToken {
  value: number;
  unit: 'px' | '%';
}

function parseRadiusToken(token: string): RadiusToken | null {
  const match = /^([\d.]+)(px|%)?$/.exec(token.trim());
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: (match[2] as 'px' | '%') ?? 'px' };
}

function parseRadiusList(value: string): RadiusToken[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseRadiusToken)
    .filter((t): t is RadiusToken => t !== null);
}

function formatRadius(token: RadiusToken): string {
  return `${token.value}${token.unit}`;
}

/** Interpolates two border-radius lists (1, 2 or 4 tokens) at progress `t`. */
export function interpolateBorderRadius(a: string, b: string, t: number): string {
  const from = parseRadiusList(a);
  const to = parseRadiusList(b);
  const count = Math.max(from.length, to.length);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const fa = from[i % from.length] ?? from[0];
    const fb = to[i % to.length] ?? to[0];
    if (!fa || !fb || fa.unit !== fb.unit) {
      parts.push(t < 0.5 ? formatRadius(fa) : formatRadius(fb));
      continue;
    }
    parts.push(`${lerp(fa.value, fb.value, t)}${fa.unit}`);
  }
  return parts.join(' ');
}

/** Morph a border radius (e.g. `0px` -> `50%` for a squircle expansion). */
export function morphRadius(
  from: string,
  to: string,
  options: MorphOptions = {},
): AnimationSequence {
  const t = resolveTiming('fadeIn');
  const samples = 6;
  const keyframes: AnimationKeyframe[] = [];
  for (let i = 0; i < samples; i++) {
    keyframes.push({
      borderRadius: interpolateBorderRadius(from, to, i / (samples - 1)),
    });
  }
  return {
    keyframes,
    timing: {
      duration: options.duration ?? t.duration,
      easing: options.easing ?? t.easing,
      delay: options.delay ?? 0,
      fill: 'both',
    },
  };
}

/** Morph between two arbitrary CSS property values (same-type values only). */
export function morphValue(
  property: string,
  from: string | number,
  to: string | number,
  options: MorphOptions = {},
): AnimationSequence {
  const t = resolveTiming('fadeIn');
  const keyframes: AnimationKeyframe[] = [{ [property]: from }, { [property]: to }];
  return {
    keyframes,
    timing: {
      duration: options.duration ?? t.duration,
      easing: options.easing ?? t.easing,
      delay: options.delay ?? 0,
      fill: 'both',
    },
  };
}
