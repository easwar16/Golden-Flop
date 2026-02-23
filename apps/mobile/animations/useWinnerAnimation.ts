/**
 * useWinnerAnimation
 *
 * Gold shimmer + scale-up on the winning seat when hand_result arrives.
 * Duration: ~800ms. No particles. Transform-only.
 */

import { useCallback } from 'react';
import {
  useSharedValue,
  withSequence,
  withTiming,
  withSpring,
  withDelay,
  Easing,
  SharedValue,
} from 'react-native-reanimated';

export interface WinnerAnimState {
  glowOpacity:  SharedValue<number>;
  glowScale:    SharedValue<number>;
  cardScale:    SharedValue<number>;
  shimmerPos:   SharedValue<number>; // 0→1 shimmer sweep position
}

const GLOW_DURATION    = 800;
const SHIMMER_DURATION = 700;

export function createWinnerAnimState(): WinnerAnimState {
  return {
    glowOpacity: useSharedValue(0),   // eslint-disable-line react-hooks/rules-of-hooks
    glowScale:   useSharedValue(1),
    cardScale:   useSharedValue(1),
    shimmerPos:  useSharedValue(-1),  // off-screen left
  };
}

export interface WinnerAnimationResult {
  triggerWin:  (state: WinnerAnimState, onDone?: () => void) => void;
  resetWinner: (state: WinnerAnimState) => void;
}

export function useWinnerAnimation(): WinnerAnimationResult {
  const triggerWin = useCallback(
    (state: WinnerAnimState, onDone?: () => void) => {
      const { glowOpacity, glowScale, cardScale, shimmerPos } = state;

      // 1. Glow fades in, pulses twice, fades out
      glowOpacity.value = withSequence(
        withTiming(0.85, { duration: 200, easing: Easing.out(Easing.quad) }),
        withTiming(0.5,  { duration: 200 }),
        withTiming(0.85, { duration: 200 }),
        withTiming(0,    { duration: 200 }),
      );

      // 2. Glow scale breathes
      glowScale.value = withSequence(
        withTiming(1.25, { duration: 300, easing: Easing.out(Easing.quad) }),
        withTiming(1.1,  { duration: 200 }),
        withTiming(1.3,  { duration: 200 }),
        withSpring(1,    { damping: 12, stiffness: 120 }),
      );

      // 3. Winning cards pop up
      cardScale.value = withSequence(
        withTiming(1.18, { duration: 250, easing: Easing.out(Easing.back(2)) }),
        withDelay(500, withSpring(1, { damping: 14, stiffness: 160 })),
      );

      // 4. Shimmer sweep across the card
      shimmerPos.value = -1;
      shimmerPos.value = withDelay(
        100,
        withTiming(2, { duration: SHIMMER_DURATION, easing: Easing.inOut(Easing.quad) }),
      );

      if (onDone) setTimeout(onDone, GLOW_DURATION + 100);
    },
    [],
  );

  const resetWinner = useCallback((state: WinnerAnimState) => {
    state.glowOpacity.value = 0;
    state.glowScale.value   = 1;
    state.cardScale.value   = 1;
    state.shimmerPos.value  = -1;
  }, []);

  return { triggerWin, resetWinner };
}
