/**
 * Public animation hook API for the dashboard. Re-exports the React bindings
 * implemented in `src/lib/animations/react-hooks.ts`, backed by the core
 * framework-agnostic library in `src/animations`.
 *
 * Usage:
 *   import { useAnimatedValue, useExitAnimation, presetClass } from './useAnimation';
 *
 *   const opacity = useAnimatedValue(open ? 1 : 0, { duration: 200 });
 *   const { shouldRender, exiting } = useExitAnimation<HTMLDivElement>({ open });
 *   <div className={presetClass('fadeIn')} />
 */

export {
  presetClass,
  useAnimatedValue,
  useSpring,
  useExitAnimation,
  useIntersectionAnimation,
  useGestureAnimation,
  useStagger,
} from '../lib/animations/react-hooks';

export type {
  AnimatedValueOptions,
  ExitAnimationOptions,
  ExitAnimationResult,
  IntersectionAnimationOptions,
  IntersectionAnimationResult,
  GestureAnimationOptions,
  GestureAnimationResult,
} from '../lib/animations/react-hooks';

export type { AnimationPreset, PresetName, TimingInput } from '../../../../src/animations';
