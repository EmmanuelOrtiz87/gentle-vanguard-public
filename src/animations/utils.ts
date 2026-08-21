/**
 * Animation core utilities — easing curves, spring physics, interpolation,
 * timing helpers and FLIP math.
 *
 * Deliberately framework-agnostic and DOM-free so it compiles and runs in
 * Node (the root tsconfig ships no DOM lib). Browser APIs are reached through
 * `globalThis` with safe fallbacks, which keeps the library usable from CLI
 * tooling, tests and the dashboard alike.
 */

export type EasingFunction = (t: number) => number;

export type AnimationKeyframe = Record<string, string | number>;

export interface AnimationTiming {
  duration?: number;
  delay?: number;
  iterations?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
}

export interface AnimationSequence {
  keyframes: AnimationKeyframe[];
  timing: AnimationTiming;
}

// ---------------------------------------------------------------------------
// Environment helpers (safe outside browsers)
// ---------------------------------------------------------------------------

/** High-resolution clock that falls back to `Date.now()` outside browsers. */
export function now(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
}

/**
 * Frame scheduler — prefers `requestAnimationFrame`, degrades to a 16ms
 * `setTimeout` loop in non-browser runtimes. Returns a cancel id.
 */
export function raf(callback: (time: number) => void): number {
  const g = globalThis as {
    requestAnimationFrame?: (cb: (time: number) => void) => number;
  };
  if (typeof g.requestAnimationFrame === 'function') {
    return g.requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(now()), 16) as unknown as number;
}

/** Cancels a scheduled frame. */
export function cancelRaf(id: number): void {
  const g = globalThis as { cancelAnimationFrame?: (id: number) => void };
  if (typeof g.cancelAnimationFrame === 'function') {
    g.cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}

/** True when the user requested reduced motion (accessible by default). */
export function prefersReducedMotion(): boolean {
  const g = globalThis as {
    matchMedia?: (query: string) => { matches: boolean };
  };
  if (typeof g.matchMedia !== 'function') return false;
  return g.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ease + interpolate a numeric value between `from` and `to`. */
export function interpolate(
  from: number,
  to: number,
  progress: number,
  easing: EasingFunction = linear,
): number {
  return lerp(from, to, easing(clamp(progress, 0, 1)));
}

/** Interpolate between two hex colors (`#rgb` or `#rrggbb`) over `progress`. */
export function interpolateColor(from: string, to: string, progress: number): string {
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  const t = clamp(progress, 0, 1);
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bl = Math.round(lerp(a.b, b.b, t));
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseHexColor(value: string): { r: number; g: number; b: number } {
  let hex = value.trim().replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const int = parseInt(hex, 16);
  if (Number.isNaN(int) || hex.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}

// ---------------------------------------------------------------------------
// Easing curves
// ---------------------------------------------------------------------------

export const linear: EasingFunction = (t) => t;

export const easeInQuad: EasingFunction = (t) => t * t;
export const easeOutQuad: EasingFunction = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export const easeInCubic: EasingFunction = (t) => t * t * t;
export const easeOutCubic: EasingFunction = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeInQuart: EasingFunction = (t) => t * t * t * t;
export const easeOutQuart: EasingFunction = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOutQuart: EasingFunction = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

export const easeInQuint: EasingFunction = (t) => t * t * t * t * t;
export const easeOutQuint: EasingFunction = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutQuint: EasingFunction = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

export const easeInCirc: EasingFunction = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2));
export const easeOutCirc: EasingFunction = (t) => Math.sqrt(1 - Math.pow(t - 1, 2));
export const easeInOutCirc: EasingFunction = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

export const easeInExpo: EasingFunction = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));
export const easeOutExpo: EasingFunction = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutExpo: EasingFunction = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;

const BACK_OVERSHOOT = 1.70158;
export const easeInBack: EasingFunction = (t) =>
  (BACK_OVERSHOOT + 1) * t * t * t - BACK_OVERSHOOT * t * t;
export const easeOutBack: EasingFunction = (t) => {
  const c1 = BACK_OVERSHOOT;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOutBack: EasingFunction = (t) => {
  const c1 = BACK_OVERSHOOT;
  const c2 = c1 * 1.525;
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
};

export const easeOutElastic: EasingFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const easeOutBounce: EasingFunction = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

/** Named easing family (mirrors the `easings.inOutCirc` style used in presets). */
export const easings = {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInQuint,
  easeOutQuint,
  easeInOutQuint,
  easeInCirc,
  easeOutCirc,
  easeInOutCirc,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeOutElastic,
  easeOutBounce,
} satisfies Record<string, EasingFunction>;

export type EasingName = keyof typeof easings;

export function easingByName(name: EasingName | string): EasingFunction {
  const fn = easings[name as EasingName];
  return typeof fn === 'function' ? fn : linear;
}

// ---------------------------------------------------------------------------
// Spring physics (damped harmonic oscillator, semi-implicit Euler)
// ---------------------------------------------------------------------------

export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
  precision?: number;
}

export interface SpringState {
  value: number;
  velocity: number;
}

const DEFAULT_SPRING: Required<SpringConfig> = {
  stiffness: 170,
  damping: 26,
  mass: 1,
  precision: 0.01,
};

/** Advances a spring state toward `target` by `dt` milliseconds. */
export function springStep(
  state: SpringState,
  target: number,
  config: SpringConfig = {},
  dt: number,
): SpringState {
  const stiffness = config.stiffness ?? DEFAULT_SPRING.stiffness;
  const damping = config.damping ?? DEFAULT_SPRING.damping;
  const mass = config.mass ?? DEFAULT_SPRING.mass;
  const maxStep = 1 / 60;
  const steps = Math.max(1, Math.ceil(dt / 1000 / maxStep));
  const h = dt / 1000 / steps;
  let value = state.value;
  let velocity = state.velocity;
  for (let i = 0; i < steps; i++) {
    const springForce = -stiffness * (value - target);
    const dampingForce = -damping * velocity;
    const acceleration = (springForce + dampingForce) / mass;
    velocity += acceleration * h;
    value += velocity * h;
  }
  return { value, velocity };
}

/** True when a spring state is (near) rest on `target`. */
export function springSettled(
  state: SpringState,
  target: number,
  config: SpringConfig = {},
): boolean {
  const precision = config.precision ?? DEFAULT_SPRING.precision;
  return Math.abs(state.value - target) < precision && Math.abs(state.velocity) < precision;
}

/** Returns a resolved spring configuration. */
export function resolveSpring(config: SpringConfig = {}): Required<SpringConfig> {
  return { ...DEFAULT_SPRING, ...config };
}

// ---------------------------------------------------------------------------
// FLIP (First-Last-Invert-Play) math
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlipDelta {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
}

/** Computes the delta needed to "invert" `last` back to `first`. */
export function computeFlipDelta(first: Rect, last: Rect): FlipDelta {
  return {
    dx: first.x - last.x,
    dy: first.y - last.y,
    scaleX: last.width ? first.width / last.width : 1,
    scaleY: last.height ? first.height / last.height : 1,
  };
}

/** Builds the inverted transform string that restores the "first" state. */
export function flipInvertTransform(delta: FlipDelta): string {
  return `translate(${delta.dx}px, ${delta.dy}px) scale(${delta.scaleX}, ${delta.scaleY})`;
}

/**
 * Keyframes that play the FLIP motion: starts from the inverted position and
 * animates back to the resting state. Animates `transform`/`opacity` only, so
 * it stays on the compositor thread.
 */
export function flipKeyframes(
  delta: FlipDelta,
  options: { opacity?: boolean; duration?: number } = {},
): AnimationSequence {
  const invert = flipInvertTransform(delta);
  const frames: AnimationKeyframe[] = [{ transform: invert }];
  if (options.opacity) frames[0].opacity = 0;
  frames.push({ transform: 'none' });
  if (options.opacity) frames[frames.length - 1].opacity = 1;
  return {
    keyframes: frames,
    timing: {
      duration: options.duration ?? 240,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      fill: 'both',
    },
  };
}

/** Full FLIP helper: from `first` to `last` rects, produce the sequence. */
export function flip(first: Rect, last: Rect, options?: { opacity?: boolean }): AnimationSequence {
  return flipKeyframes(computeFlipDelta(first, last), options);
}
