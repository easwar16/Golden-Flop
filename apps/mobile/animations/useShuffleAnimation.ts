/**
 * useShuffleAnimation
 *
 * Drives a fake deck shuffle: 6 card-back layers fan left/right then snap to stack.
 * Call `triggerShuffle()` at the start of each new hand.
 * Purely visual — zero game logic.
 */

import { useCallback, useRef } from 'react';
import {
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  Easing,
  SharedValue,
} from 'react-native-reanimated';

export const SHUFFLE_CARD_COUNT = 6;

interface ShuffleCard {
  translateX: SharedValue<number>;
  rotate: SharedValue<number>;
  opacity: SharedValue<number>;
}

export interface ShuffleAnimationResult {
  cards: ShuffleCard[];
  isShuffling: SharedValue<number>; // 1 = active, 0 = idle
  triggerShuffle: () => void;
}

const DURATION = 100; // ms per step
const SNAP     = 200; // ms snap-back

// Pre-computed resting offsets so the deck looks slightly fanned
const REST_X   = [-4, -2, 0, 2, 4, 6];
const REST_ROT = [-3, -1.5, 0, 1.5, 3, 4];

export function useShuffleAnimation(): ShuffleAnimationResult {
  const isShuffling = useSharedValue(0);

  // Create one set of shared values per card — stable across renders
  const cards = useRef<ShuffleCard[]>(
    Array.from({ length: SHUFFLE_CARD_COUNT }, (_, i) => ({
      translateX: useSharedValue(REST_X[i]),  // eslint-disable-line react-hooks/rules-of-hooks
      rotate:     useSharedValue(REST_ROT[i]),
      opacity:    useSharedValue(1),
    }))
  ).current;

  const triggerShuffle = useCallback(() => {
    isShuffling.value = 1;

    const cfg = (dur: number) =>
      ({ duration: dur, easing: Easing.inOut(Easing.quad) } as const);

    cards.forEach((card, i) => {
      // Each card staggers slightly so the motion looks mechanical
      const stagger = i * 18;

      // Phase 1: fan left, Phase 2: fan right, Phase 3: snap to rest
      const fanLeft  = -(20 + i * 8);
      const fanRight =  (18 + i * 6);

      card.translateX.value = withDelay(
        stagger,
        withSequence(
          withTiming(fanLeft,       cfg(DURATION)),
          withTiming(fanRight,      cfg(DURATION)),
          withTiming(fanLeft * 0.6, cfg(DURATION)),
          withTiming(fanRight * 0.5,cfg(DURATION)),
          withTiming(REST_X[i],     { duration: SNAP, easing: Easing.out(Easing.back(1.5)) }),
        ),
      );

      const rotFan = REST_ROT[i] + (i % 2 === 0 ? -6 : 6);
      card.rotate.value = withDelay(
        stagger,
        withSequence(
          withTiming(rotFan,        cfg(DURATION * 2)),
          withTiming(-rotFan * 0.5, cfg(DURATION * 2)),
          withTiming(REST_ROT[i],   { duration: SNAP, easing: Easing.out(Easing.back(1.2)) }),
        ),
      );
    });

    // Mark done after last card finishes
    const totalDuration = SHUFFLE_CARD_COUNT * 18 + DURATION * 4 + SNAP + 50;
    isShuffling.value = withDelay(totalDuration, withTiming(0, { duration: 1 }));
  }, [cards, isShuffling]);

  return { cards, isShuffling, triggerShuffle };
}
