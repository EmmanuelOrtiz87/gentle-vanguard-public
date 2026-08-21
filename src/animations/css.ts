/**
 * CSS-in-JS helpers — build transition strings, `@keyframes` blocks and
 * animation shorthand values. Pure string builders, safe in Node and browsers.
 */

import type { AnimationKeyframe, AnimationTiming } from './utils';
import { resolveEasing, type AnimationPreset } from './presets';

export interface CSSAnimationOptions {
  duration?: number;
  easing?: string;
  delay?: number;
  iterations?: number | 'infinite';
  direction?: string;
  fill?: string;
}

/** Builds a CSS `transition` value for one or more properties. */
export function transitionValue(
  properties: string | string[],
  duration = 200,
  easing = 'cubic-bezier(0.4, 0, 0.2, 1)',
  delay = 0,
): string {
  const props = Array.isArray(properties) ? properties : [properties];
  return props.map((p) => `${p} ${duration}ms ${easing} ${delay}ms`).join(', ');
}

/** Serializes a keyframe map into CSS declarations. */
export function keyframeDeclarations(keyframe: AnimationKeyframe): string {
  return Object.entries(keyframe)
    .map(([prop, value]) => `${prop}: ${value};`)
    .join('\n');
}

/** Builds an `@keyframes` rule from an ordered keyframe array. */
export function keyframesCSS(name: string, keyframes: AnimationKeyframe[]): string {
  const steps = keyframes
    .map((frame, i) => {
      const pct = Math.round((i / Math.max(1, keyframes.length - 1)) * 100);
      const declarations = keyframeDeclarations(frame)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
      return `  ${pct}% {\n${declarations}\n  }`;
    })
    .join('\n');
  return `@keyframes ${name} {\n${steps}\n}`;
}

/** Builds a CSS `animation` shorthand value. */
export function animationShorthand(name: string, options: CSSAnimationOptions = {}): string {
  const duration = options.duration ?? 200;
  const easing = options.easing ?? 'cubic-bezier(0.4, 0, 0.2, 1)';
  const delay = options.delay ?? 0;
  const iterations =
    options.iterations === Infinity || options.iterations === 'infinite'
      ? 'infinite'
      : String(options.iterations ?? 1);
  return `${name} ${duration}ms ${easing} ${delay}ms ${iterations}`;
}

/** Animation shorthand for a named preset (used by the CSS class builder). */
export function presetAnimationValue(name: string, preset: AnimationPreset): string {
  return animationShorthand(name, {
    duration: preset.duration,
    easing: resolveEasing(preset),
    delay: preset.delay ?? 0,
    iterations: preset.loop ? 'infinite' : 1,
    fill: preset.fill,
  });
}

/** Builds a CSS custom-property declaration (`--anim-<name>`). */
export function cssVar(name: string, value: string | number): string {
  return `--anim-${name}: ${value};`;
}

/** Renders one or more named keyframe blocks into a single CSS string. */
export function buildKeyframesBlock(
  blocks: Array<{ name: string; keyframes: AnimationKeyframe[] }>,
): string {
  return blocks.map((b) => keyframesCSS(b.name, b.keyframes)).join('\n\n');
}

/** Converts an animation timing record into a CSS animation shorthand. */
export function timingToShorthand(name: string, timing: AnimationTiming): string {
  return animationShorthand(name, {
    duration: timing.duration,
    easing: timing.easing,
    delay: timing.delay,
    iterations: timing.iterations,
    direction: timing.direction,
    fill: timing.fill,
  });
}
