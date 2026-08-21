/**
 * Fade variants — opacity in/out. The cheapest, most composable animation in
 * the library: only `opacity` is animated, so it never touches layout or
 * paint on the compositor thread.
 */

import { resolveTiming, type TimingInput } from './presets';
import type { AnimationSequence } from './utils';

/** Fade a component in from transparent to opaque. */
export function fadeIn(input?: TimingInput): AnimationSequence {
  const t = resolveTiming(input ?? 'fadeIn');
  return {
    keyframes: [{ opacity: 0 }, { opacity: 1 }],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
      iterations: t.loop ? Infinity : undefined,
    },
  };
}

/** Fade a component out from opaque to transparent. */
export function fadeOut(input?: TimingInput): AnimationSequence {
  const t = resolveTiming(input ?? 'fadeOut');
  return {
    keyframes: [{ opacity: 1 }, { opacity: 0 }],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
      iterations: t.loop ? Infinity : undefined,
    },
  };
}

/** Fade between two opacity values (useful for hover/active emphasis). */
export function fadeTo(
  fromOpacity: number,
  toOpacity: number,
  input?: TimingInput,
): AnimationSequence {
  const t = resolveTiming(input ?? 'fadeIn');
  return {
    keyframes: [{ opacity: fromOpacity }, { opacity: toOpacity }],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
    },
  };
}
