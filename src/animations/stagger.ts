/**
 * Stagger variants — sequence effects that offset a group of items so they
 * animate one after another instead of simultaneously. The classic pattern for
 * list entrances and dashboard card grids.
 */

import type { AnimationSequence } from './utils';

export type StaggerDirection = 'forward' | 'reverse' | 'center';

export interface StaggerOptions {
  /** Delay between consecutive items, in ms (default 60). */
  stagger?: number;
  /** Wave direction. `center` expands outward from the middle. */
  direction?: StaggerDirection;
  /** Optional extra delay applied to every item, in ms. */
  baseDelay?: number;
}

/** Per-item delay for a linear stagger wave. */
export function staggerDelay(
  index: number,
  staggerMs = 60,
  direction: Exclude<StaggerDirection, 'center'> = 'forward',
): number {
  const offset = index * Math.max(0, staggerMs);
  return direction === 'reverse' ? -offset : offset;
}

/** Full delay schedule for `count` items. */
export function staggerSchedule(count: number, options: StaggerOptions = {}): number[] {
  const { stagger = 60, direction = 'forward', baseDelay = 0 } = options;
  const delays: number[] = [];
  for (let i = 0; i < count; i++) {
    if (direction === 'center') {
      const mid = (count - 1) / 2;
      delays.push(baseDelay + Math.ceil(Math.abs(i - mid)) * stagger);
    } else {
      const offset = i * stagger;
      delays.push(baseDelay + (direction === 'reverse' ? (count - 1 - i) * stagger : offset));
    }
  }
  return delays;
}

/**
 * Applies a stagger schedule to a single base sequence, producing one
 * per-item sequence with an individual delay. Ideal for lists and grids:
 *
 * ```ts
 * const sequences = staggerSequences(fadeIn(), items.length, { stagger: 60 });
 * ```
 */
export function staggerSequences(
  base: AnimationSequence,
  count: number,
  options: StaggerOptions = {},
): AnimationSequence[] {
  const delays = staggerSchedule(count, options);
  return delays.map((delay) => ({
    keyframes: base.keyframes,
    timing: { ...base.timing, delay: (base.timing.delay ?? 0) + delay },
  }));
}
