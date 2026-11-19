/**
 * Gentle-Vanguard animation library — elegant, composable, 60fps UI motion.
 *
 * The core (`src/animations`) is framework-agnostic and DOM-free so it runs in
 * Node (CLI, tests) and in the browser. React bindings live in the dashboard:
 * `apps/web-dashboard/src/lib/animations/react-hooks.ts` (re-exported via
 * `apps/web-dashboard/src/hooks/useAnimation.ts`).
 *
 * Quick start:
 *   import { fadeIn, slideUp, scalePop, staggerSequences } from './animations';
 *   const entrance = fadeIn();                       // { keyframes, timing }
 *   const wave = staggerSequences(fadeIn(), 5, { stagger: 60 });
 */

export * from './utils.js';
export * from './presets.js';
export * from './fade.js';
export * from './slide.js';
export * from './scale.js';
export * from './stagger.js';
export * from './spring.js';
export * from './morph.js';
export * from './css.js';
export * from './hooks.js';
