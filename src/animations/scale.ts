/**
 * Scale variants — size emphasis via `transform: scale`, always GPU-accelerated.
 * `scalePop` overshoots past 1.0 (spring easing) for a playful "badge-pop" feel.
 */

import { resolveTiming, type TimingInput } from './presets';
import type { AnimationSequence } from './utils';

/** Scale in from a starting scale (default 0.9) to 1. */
export function scaleIn(input?: TimingInput, from = 0.9): AnimationSequence {
  const t = resolveTiming(input ?? 'scalePop');
  return {
    keyframes: [
      { transform: `scale(${from})`, opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
    },
  };
}

/** Scale out toward a target scale (default 0.9). */
export function scaleOut(input?: TimingInput, to = 0.9): AnimationSequence {
  const t = resolveTiming(input ?? 'fadeOut');
  return {
    keyframes: [
      { transform: 'scale(1)', opacity: 1 },
      { transform: `scale(${to})`, opacity: 0 },
    ],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
    },
  };
}

/** Pop in with a springy overshoot: 0.6 -> 1.08 -> 1. */
export function scalePop(input?: TimingInput): AnimationSequence {
  const t = resolveTiming(input ?? 'scalePop');
  return {
    keyframes: [
      { transform: 'scale(0.6)', opacity: 0 },
      { transform: 'scale(1.08)', opacity: 1 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
    },
  };
}
