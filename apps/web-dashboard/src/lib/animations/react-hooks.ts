/**
 * React bindings for the Gentle-Vanguard animation core. These hooks wrap the
 * framework-agnostic primitives in `src/animations` with React state + effects
 * so components can animate values, springs, exits, scroll entrances and
 * press gestures without touching the Web Animations API directly.
 *
 * All hooks respect `prefers-reduced-motion`: when the user asks for reduced
 * motion, values jump to their target instantly and scroll/press effects
 * become no-ops (the CSS layer in `styles/animations.css` also collapses
 * transitions).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import {
  animateValue,
  createSpringMotion,
  prefersReducedMotion,
  resolveTiming,
  staggerSchedule,
  type EasingFunction,
  type EasingName,
  type PresetName,
  type SpringConfig,
  type StaggerOptions,
} from '../../../../../src/animations';

/** Converts a preset name to its CSS utility class (`scalePop` -> `anim-scale-pop`). */
export function presetClass(name: PresetName | string): string {
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `anim-${kebab}`;
}

// ---------------------------------------------------------------------------
// useAnimatedValue — tween a numeric value toward a target
// ---------------------------------------------------------------------------

export interface AnimatedValueOptions {
  duration?: number;
  delay?: number;
  easing?: EasingFunction | EasingName;
}

/** Animates a numeric value toward `target` whenever it changes. */
export function useAnimatedValue(target: number, options: AnimatedValueOptions = {}): number {
  const [value, setValue] = useState(target);
  const currentRef = useRef(target);
  const cancelRef = useRef<(() => void) | null>(null);
  const { duration, delay, easing } = options;

  useEffect(() => {
    if (prefersReducedMotion()) {
      currentRef.current = target;
      setValue(target);
      return;
    }
    cancelRef.current?.();
    const cancel = animateValue({
      from: currentRef.current,
      to: target,
      duration,
      delay,
      easing,
      onUpdate: (v) => {
        currentRef.current = v;
        setValue(v);
      },
    });
    cancelRef.current = cancel;
    return () => cancel();
  }, [target, duration, delay, easing]);

  return value;
}

// ---------------------------------------------------------------------------
// useSpring — spring-physics value
// ---------------------------------------------------------------------------

/** Animates a value toward `target` using spring physics. */
export function useSpring(target: number, config: SpringConfig = {}): number {
  const [value, setValue] = useState(target);
  const currentRef = useRef(target);
  const cancelRef = useRef<(() => void) | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (prefersReducedMotion()) {
      currentRef.current = target;
      setValue(target);
      return;
    }
    cancelRef.current?.();
    const cancel = createSpringMotion({
      from: currentRef.current,
      to: target,
      config: configRef.current,
      onUpdate: (v) => {
        currentRef.current = v;
        setValue(v);
      },
    });
    cancelRef.current = cancel;
    return () => cancel();
  }, [target]);

  return value;
}

// ---------------------------------------------------------------------------
// useExitAnimation — clean unmount with an exit animation
// ---------------------------------------------------------------------------

export interface ExitAnimationOptions {
  /** True while the component should be visible. */
  open: boolean;
  /** Exit preset (default `fadeOut`). */
  preset?: PresetName | string;
  /** Override exit duration in ms. */
  duration?: number;
  /** Called once the exit animation has finished. */
  onExited?: () => void;
}

export interface ExitAnimationResult<T extends HTMLElement> {
  ref: RefObject<T | null>;
  /** True while the component should be rendered (entering or exiting). */
  shouldRender: boolean;
  /** True during the exit animation — apply the exit class in JSX. */
  exiting: boolean;
}

/** Renders a component, plays an exit animation on close, then unmounts it. */
export function useExitAnimation<T extends HTMLElement>(
  options: ExitAnimationOptions,
): ExitAnimationResult<T> {
  const { open, preset = 'fadeOut', duration, onExited } = options;
  const [shouldRender, setShouldRender] = useState(open);
  const [exiting, setExiting] = useState(false);
  const ref = useRef<T | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setExiting(false);
    } else if (shouldRender) {
      setExiting(true);
    }
  }, [open, shouldRender]);

  useEffect(() => {
    if (open || !shouldRender) return;
    const timing = resolveTiming(preset as PresetName);
    const ms = duration ?? timing.duration;
    const timer = setTimeout(() => {
      setShouldRender(false);
      setExiting(false);
      onExitedRef.current?.();
    }, ms);
    return () => clearTimeout(timer);
  }, [open, shouldRender, preset, duration]);

  return { ref, shouldRender, exiting };
}

// ---------------------------------------------------------------------------
// useIntersectionAnimation — trigger on scroll into view
// ---------------------------------------------------------------------------

export interface IntersectionAnimationOptions {
  /** Entrance preset (default `fadeIn`). */
  preset?: PresetName | string;
  threshold?: number;
  rootMargin?: string;
  /** Only animate the first time the element enters the viewport. */
  once?: boolean;
}

export interface IntersectionAnimationResult<T extends HTMLElement> {
  ref: RefObject<T | null>;
  isVisible: boolean;
  /** Apply alongside the element's classes: `fade-in` once visible. */
  className: string;
}

/** Applies an entrance animation the first time an element scrolls into view. */
export function useIntersectionAnimation<T extends HTMLElement>(
  options: IntersectionAnimationOptions = {},
): IntersectionAnimationResult<T> {
  const { preset = 'fadeIn', threshold = 0.15, rootMargin = '0px', once = true } = options;
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<T | null>(null);
  const onceRef = useRef(once);
  onceRef.current = once;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            if (onceRef.current) observer.disconnect();
          } else if (!onceRef.current) {
            setIsVisible(false);
          }
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return {
    ref,
    isVisible,
    className: isVisible ? presetClass(preset) : 'opacity-0',
  };
}

// ---------------------------------------------------------------------------
// useGestureAnimation — pointer press / move micro-interaction
// ---------------------------------------------------------------------------

export interface GestureAnimationOptions {
  onPress?: () => void;
  onRelease?: () => void;
  onMove?: (delta: { x: number; y: number }) => void;
  /** Scale applied while pressed (default 0.98). */
  scale?: number;
  /** Movement threshold in px before `onMove` fires (default 4). */
  threshold?: number;
}

export interface GestureHandlers<T> {
  onPointerDown: (event: ReactPointerEvent<T>) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerMove: (event: ReactPointerEvent<T>) => void;
}

export interface GestureAnimationResult<T> {
  handlers: GestureHandlers<T>;
  pressed: boolean;
  /** Spread onto the element; applies the press-scale while active. */
  style: CSSProperties;
}

/** Adds press-scale and drag/threshold feedback to any interactive element. */
export function useGestureAnimation<T extends HTMLElement>(
  options: GestureAnimationOptions = {},
): GestureAnimationResult<T> {
  const { scale = 0.98, threshold = 4 } = options;
  const [pressed, setPressed] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const onPointerDown = useCallback((event: ReactPointerEvent<T>) => {
    startRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPressed(true);
    callbacksRef.current.onPress?.();
  }, []);

  const onPointerUp = useCallback(() => {
    startRef.current = null;
    setPressed(false);
    callbacksRef.current.onRelease?.();
  }, []);

  const onPointerLeave = useCallback(() => {
    startRef.current = null;
    setPressed(false);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<T>) => {
      const start = startRef.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) >= threshold || Math.abs(dy) >= threshold) {
        callbacksRef.current.onMove?.({ x: dx, y: dy });
      }
    },
    [threshold],
  );

  const style: CSSProperties =
    pressed && !prefersReducedMotion()
      ? { transform: `scale(${scale})`, willChange: 'transform' }
      : { transform: 'none', willChange: 'transform' };

  return {
    handlers: { onPointerDown, onPointerUp, onPointerLeave, onPointerMove },
    pressed,
    style,
  };
}

// ---------------------------------------------------------------------------
// useStagger — per-item entrance delays for a list/grid
// ---------------------------------------------------------------------------

/** Returns per-item delays (ms) for staggering a group entrance. */
export function useStagger(count: number, options: StaggerOptions = {}): number[] {
  const { stagger, direction, baseDelay } = options;
  return useMemo(
    () => staggerSchedule(count, { stagger, direction, baseDelay }),
    [count, stagger, direction, baseDelay],
  );
}
