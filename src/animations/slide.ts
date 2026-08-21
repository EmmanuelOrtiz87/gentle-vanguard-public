/**
 * Slide variants — translate transitions. Uses `transform: translateX/Y`
 * exclusively so animations run on the compositor thread and never reflow.
 */

import { resolveTiming, type TimingInput } from './presets';
import type { AnimationSequence } from './utils';

export type SlideDirection = 'up' | 'down' | 'left' | 'right';

const OFFSET: Record<SlideDirection, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

/** Slide in from an off-screen offset (default 24px) to the resting position. */
export function slideIn(
  direction: SlideDirection = 'up',
  input?: TimingInput,
  distance = 24,
): AnimationSequence {
  const t = resolveTiming(input ?? 'slideUp');
  const offset = OFFSET[direction];
  return {
    keyframes: [
      { transform: `translate(${offset.x * distance}px, ${offset.y * distance}px)`, opacity: 0 },
      { transform: 'translate(0, 0)', opacity: 1 },
    ],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
    },
  };
}

/** Slide out toward a direction, ending off-screen. */
export function slideOut(
  direction: SlideDirection = 'up',
  input?: TimingInput,
  distance = 24,
): AnimationSequence {
  const t = resolveTiming(input ?? 'slideDown');
  const offset = OFFSET[direction];
  return {
    keyframes: [
      { transform: 'translate(0, 0)', opacity: 1 },
      {
        transform: `translate(${offset.x * distance}px, ${offset.y * distance}px)`,
        opacity: 0,
      },
    ],
    timing: {
      duration: t.duration,
      easing: t.easing,
      delay: t.delay,
      fill: t.fill,
    },
  };
}

/** Convenience: slide up in. */
export function slideUp(input?: TimingInput, distance = 24): AnimationSequence {
  return slideIn('up', input, distance);
}

/** Convenience: slide down out. */
export function slideDownOut(input?: TimingInput, distance = 24): AnimationSequence {
  return slideOut('down', input, distance);
}
