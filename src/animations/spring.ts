/**
 * Spring variants — physics-based motion. Unlike time-based easing, springs
 * model mass/stiffness/damping, which produces the natural "settle" feel
 * behind great micro-interactions.
 *
 * `sampleSpring` discretizes the spring trajectory into keyframes so it can be
 * consumed anywhere keyframes are used (WAAPI, CSS, tests).
 */

import {
  resolveSpring,
  springStep,
  type AnimationKeyframe,
  type AnimationSequence,
  type SpringConfig,
} from './utils';

export const springPresets = {
  default: { stiffness: 170, damping: 26 },
  gentle: { stiffness: 120, damping: 20 },
  wobbly: { stiffness: 180, damping: 12 },
  stiff: { stiffness: 260, damping: 34 },
  slow: { stiffness: 90, damping: 18 },
} as const satisfies Record<string, SpringConfig>;

export type SpringPresetName = keyof typeof springPresets;

export function getSpringPreset(name: SpringPresetName | string): SpringConfig {
  return springPresets[name as SpringPresetName] ?? springPresets.default;
}

/** Simulates the spring until it settles and returns the elapsed ms. */
export function estimateSpringDuration(config: SpringConfig = {}): number {
  const { stiffness, damping, mass, precision } = resolveSpring(config);
  const dt = 1 / 60;
  let value = 1;
  let velocity = 0;
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    if (Math.abs(value) < precision && Math.abs(velocity) < precision) break;
    const next = springStep({ value, velocity }, 0, { stiffness, damping, mass }, dt * 1000);
    value = next.value;
    velocity = next.velocity;
    t += dt;
  }
  return Math.round(t * 1000);
}

export interface SpringSampleOptions {
  /** Number of keyframes to sample (default 30). */
  samples?: number;
  /** Explicit duration; otherwise estimated from the spring config. */
  duration?: number;
  /** Formats a sampled value into a keyframe (default: `translateY`). */
  format?: (value: number, index: number) => AnimationKeyframe;
}

/** Samples a spring trajectory between `from` and `to` into keyframes. */
export function sampleSpring(
  from: number,
  to: number,
  config: SpringConfig = {},
  options: SpringSampleOptions = {},
): AnimationKeyframe[] {
  const samples = Math.max(2, options.samples ?? 30);
  const duration = options.duration ?? estimateSpringDuration(config);
  const format = options.format ?? ((value: number) => ({ transform: `translateY(${value}px)` }));
  const frames: AnimationKeyframe[] = [];
  let state = { value: from, velocity: 0 };
  const dt = duration / (samples - 1);
  for (let i = 0; i < samples; i++) {
    frames.push(format(state.value, i));
    if (i < samples - 1) state = springStep(state, to, config, dt);
  }
  return frames;
}

/** Spring trajectory as a ready-to-play `AnimationSequence`. */
export function springSequence(
  from: number,
  to: number,
  config: SpringConfig = {},
  options: SpringSampleOptions = {},
): AnimationSequence {
  return {
    keyframes: sampleSpring(from, to, config, options),
    timing: {
      duration: options.duration ?? estimateSpringDuration(config),
      easing: 'linear',
      fill: 'both',
    },
  };
}

/** Springy overshoot sequence ideal for scale/badge pops. */
export function springPop(
  toScale = 1,
  config: SpringConfig = {},
  options: SpringSampleOptions = {},
): AnimationSequence {
  return springSequence(0.4 * toScale, toScale, config, {
    ...options,
    format: (value) => ({ transform: `scale(${value})`, opacity: value > 0 ? 1 : 0 }),
  });
}
