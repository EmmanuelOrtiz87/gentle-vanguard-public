/**
 * Framework-agnostic animation engine primitives — the pure logic behind the
 * React hooks (`useAnimatedValue`, `useSpring`, ...). The dashboard binds these
 * to React in `apps/web-dashboard/src/lib/animations/react-hooks.ts`.
 *
 * These functions are intentionally not React hooks so the module compiles and
 * runs in Node (CLI tooling, tests, server-side).
 */

import {
  cancelRaf,
  easings,
  interpolate,
  linear,
  now,
  raf,
  springSettled,
  springStep,
  type AnimationSequence,
  type EasingFunction,
  type EasingName,
  type SpringConfig,
} from './utils';
import { fadeIn, fadeOut } from './fade';
import { slideIn, slideUp } from './slide';
import { scalePop } from './scale';
import { type PresetName } from './presets';

export interface AnimateValueOptions {
  from: number;
  to: number;
  duration?: number;
  delay?: number;
  /** Easing function, or the name of a built-in curve. */
  easing?: EasingFunction | EasingName;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}

/**
 * Drives a numeric value from `from` to `to` over `duration` ms, invoking
 * `onUpdate` every frame. Returns a cancel function.
 */
export function animateValue(options: AnimateValueOptions): () => void {
  const { from, to, onUpdate, onComplete } = options;
  const duration = Math.max(0, options.duration ?? 200);
  const delay = Math.max(0, options.delay ?? 0);
  const easing: EasingFunction =
    typeof options.easing === 'function'
      ? options.easing
      : options.easing
        ? (easings[options.easing as EasingName] ?? linear)
        : linear;

  let cancelled = false;
  let frameId = 0;
  let startTime: number | null = null;
  const startAt = now() + delay;

  const loop = (time: number): void => {
    if (cancelled) return;
    if (startTime === null) {
      if (time < startAt) {
        frameId = raf(loop);
        return;
      }
      startTime = time;
    }
    const progress = duration === 0 ? 1 : Math.min(1, (time - startTime) / duration);
    onUpdate(interpolate(from, to, progress, easing));
    if (progress < 1) {
      frameId = raf(loop);
    } else {
      onComplete?.();
    }
  };

  frameId = raf(loop);
  return () => {
    cancelled = true;
    cancelRaf(frameId);
  };
}

export interface SpringMotionOptions {
  from: number;
  to: number;
  config?: SpringConfig;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}

/**
 * Runs a spring toward `to`, invoking `onUpdate` with the current value each
 * frame. Returns a cancel function. Settles when the spring comes to rest.
 */
export function createSpringMotion(options: SpringMotionOptions): () => void {
  const state = { value: options.from, velocity: 0 };
  let lastTime = now();
  let frameId = 0;
  let cancelled = false;

  const loop = (): void => {
    if (cancelled) return;
    const current = now();
    const dt = Math.min(50, current - lastTime);
    lastTime = current;
    const next = springStep(state, options.to, options.config, dt);
    state.value = next.value;
    state.velocity = next.velocity;
    options.onUpdate(state.value);
    if (!springSettled(state, options.to, options.config)) {
      frameId = raf(loop);
    } else {
      options.onUpdate(options.to);
      options.onComplete?.();
    }
  };

  frameId = raf(loop);
  return () => {
    cancelled = true;
    cancelRaf(frameId);
  };
}

/** Keyframes + timing for a named loop preset (bounce, shimmer, pulse, spin). */
function loopKeyframes(name: 'bounce' | 'shimmer' | 'pulse' | 'spin'): AnimationSequence {
  switch (name) {
    case 'bounce':
      return {
        keyframes: [
          { transform: 'translateY(0)' },
          { transform: 'translateY(-25%)' },
          { transform: 'translateY(0)' },
        ],
        timing: { duration: 600, easing: 'easeInOutQuad', iterations: Infinity },
      };
    case 'shimmer':
      return {
        keyframes: [{ backgroundPosition: '200% 0' }, { backgroundPosition: '-200% 0' }],
        timing: { duration: 1400, easing: 'linear', iterations: Infinity },
      };
    case 'pulse':
      return {
        keyframes: [{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }],
        timing: { duration: 1000, easing: 'easeInOutQuad', iterations: Infinity },
      };
    case 'spin':
      return {
        keyframes: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        timing: { duration: 900, easing: 'linear', iterations: Infinity },
      };
  }
}

/** Converts a preset name into a concrete keyframe sequence. */
export function presetToKeyframes(name: PresetName | string): AnimationSequence {
  switch (name) {
    case 'fadeIn':
      return fadeIn();
    case 'fadeOut':
      return fadeOut();
    case 'slideUp':
      return slideUp();
    case 'slideDown':
      return slideIn('down');
    case 'scalePop':
      return scalePop();
    case 'bounce':
    case 'shimmer':
    case 'pulse':
    case 'spin':
      return loopKeyframes(name);
    default:
      return fadeIn(name as PresetName);
  }
}
