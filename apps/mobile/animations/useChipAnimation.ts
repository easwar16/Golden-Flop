/**
 * useChipAnimation
 *
 * Manages chip stacks flying from seats → pot (on bet) and pot → winner (on win).
 *
 * Arc movement: achieved by animating a progress value 0→1 and deriving
 * x/y from a quadratic bezier on the UI thread (worklet).
 *
 * Purely visual — chip counts come from the Zustand store, not from here.
 */

import { useCallback } from 'react';
import {
  useSharedValue,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  useDerivedValue,
  interpolate,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import type { Point, TableLayout } from './types';

export interface ChipStackState {
  /** 0 = at origin, 1 = at destination */
  progress:  SharedValue<number>;
  scale:     SharedValue<number>;
  opacity:   SharedValue<number>;
  /** Runtime-settable origin / destination for the arc */
  fromX:     SharedValue<number>;
  fromY:     SharedValue<number>;
  toX:       SharedValue<number>;
  toY:       SharedValue<number>;
  /** Derived arc position (computed on UI thread) */
  x:         SharedValue<number>;
  y:         SharedValue<number>;
}

const CHIP_TRAVEL = 520;
const easeOutBack = Easing.bezier(0.34, 1.56, 0.64, 1);

function lerp(a: number, b: number, t: number) {
  'worklet';
  return a + (b - a) * t;
}

/** Quadratic bezier arc control point — lifts the path upward */
function arcPoint(from: Point, to: Point): Point {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx   = to.x - from.x;
  const dy   = to.y - from.y;
  // Perpendicular offset (upward arc)
  const len  = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: midX - (dy / len) * 40,
    y: midY + (dx / len) * 40 - 30, // bias upward
  };
}

/**
 * Create shared-value state for one chip stack.
 * Call at component top-level.
 */
export function createChipStackState(): ChipStackState {
  const fromX    = useSharedValue(0);   // eslint-disable-line react-hooks/rules-of-hooks
  const fromY    = useSharedValue(0);
  const toX      = useSharedValue(0);
  const toY      = useSharedValue(0);
  const progress = useSharedValue(0);
  const scale    = useSharedValue(1);
  const opacity  = useSharedValue(0);

  // Derive screen position along the arc (runs on UI thread)
  const x = useDerivedValue(() => {   // eslint-disable-line react-hooks/rules-of-hooks
    const t  = progress.value;
    const cx = (fromX.value + toX.value) / 2 - ((toY.value - fromY.value) / (Math.sqrt(
      Math.pow(toX.value - fromX.value, 2) + Math.pow(toY.value - fromY.value, 2)) || 1)) * 40;
    return lerp(lerp(fromX.value, cx, t), lerp(cx, toX.value, t), t);
  });

  const y = useDerivedValue(() => {   // eslint-disable-line react-hooks/rules-of-hooks
    const t  = progress.value;
    const cy = (fromY.value + toY.value) / 2 + ((toX.value - fromX.value) / (Math.sqrt(
      Math.pow(toX.value - fromX.value, 2) + Math.pow(toY.value - fromY.value, 2)) || 1)) * 40 - 30;
    return lerp(lerp(fromY.value, cy, t), lerp(cy, toY.value, t), t);
  });

  return { progress, scale, opacity, fromX, fromY, toX, toY, x, y };
}

export interface ChipAnimationResult {
  /** Animate chips from a seat to the pot */
  animateBet: (chip: ChipStackState, layout: TableLayout, seatIdx: number, onDone?: () => void) => void;
  /** Animate chips from the pot to the winner seat */
  animateWin: (chip: ChipStackState, layout: TableLayout, winnerSeatIdx: number, onDone?: () => void) => void;
  /** Hide chip stack */
  resetChip:  (chip: ChipStackState) => void;
}

export function useChipAnimation(): ChipAnimationResult {
  const animateBet = useCallback(
    (chip: ChipStackState, layout: TableLayout, seatIdx: number, onDone?: () => void) => {
      const from = layout.seats[seatIdx];
      const to   = layout.potCenter;
      if (!from) return;

      chip.fromX.value    = from.x;
      chip.fromY.value    = from.y;
      chip.toX.value      = to.x;
      chip.toY.value      = to.y;
      chip.progress.value = 0;
      chip.opacity.value  = 1;
      chip.scale.value    = 1;

      chip.progress.value = withTiming(1, { duration: CHIP_TRAVEL, easing: Easing.out(Easing.cubic) });
      chip.scale.value    = withTiming(0.85, { duration: CHIP_TRAVEL });

      if (onDone) setTimeout(() => runOnJS(onDone)(), CHIP_TRAVEL + 50);
    },
    [],
  );

  const animateWin = useCallback(
    (chip: ChipStackState, layout: TableLayout, winnerSeatIdx: number, onDone?: () => void) => {
      const from = layout.potCenter;
      const to   = layout.seats[winnerSeatIdx];
      if (!to) return;

      chip.fromX.value    = from.x;
      chip.fromY.value    = from.y;
      chip.toX.value      = to.x;
      chip.toY.value      = to.y;
      chip.progress.value = 0;
      chip.opacity.value  = 1;
      chip.scale.value    = 0.85;

      chip.progress.value = withTiming(1, { duration: CHIP_TRAVEL, easing: Easing.inOut(Easing.cubic) });
      // Scale up slightly on arrival for emphasis
      chip.scale.value    = withDelay(
        CHIP_TRAVEL * 0.7,
        withSpring(1.15, { damping: 10, stiffness: 180 }),
      );

      const hideDelay = CHIP_TRAVEL + 400;
      chip.opacity.value = withDelay(hideDelay, withTiming(0, { duration: 200 }));

      if (onDone) setTimeout(() => runOnJS(onDone)(), hideDelay + 200);
    },
    [],
  );

  const resetChip = useCallback((chip: ChipStackState) => {
    chip.progress.value = 0;
    chip.opacity.value  = 0;
    chip.scale.value    = 1;
  }, []);

  return { animateBet, animateWin, resetChip };
}
