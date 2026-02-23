/**
 * useCardDealAnimation
 *
 * Animates cards flying from the deck origin to each seat.
 * One card per seat, staggered by 120ms.
 * Uses translateX / translateY + scale.
 * Purely visual — no card values here.
 */

import { useCallback } from 'react';
import {
  useSharedValue,
  withDelay,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import type { TableLayout } from './types';

export interface DealCardState {
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  scale:      SharedValue<number>;
  opacity:    SharedValue<number>;
}

const DEAL_DURATION  = 480; // ms per card travel
const DEAL_STAGGER   = 120; // ms between each card

const easeOutCubic = Easing.bezier(0.33, 1, 0.68, 1);

/**
 * Creates shared-value state for one flying card.
 * Must be called at component top-level (rules of hooks).
 */
export function createDealCardState(): DealCardState {
  return {
    translateX: useSharedValue(0),  // eslint-disable-line react-hooks/rules-of-hooks
    translateY: useSharedValue(0),
    scale:      useSharedValue(0),
    opacity:    useSharedValue(0),
  };
}

export interface CardDealAnimationResult {
  /** Call once per new hand with the current table layout */
  dealCards: (layout: TableLayout, seatIndices: number[], onDone?: () => void) => void;
  /** Reset all flying cards off-screen */
  resetCards: (cards: DealCardState[]) => void;
}

export function useCardDealAnimation(): CardDealAnimationResult {
  const dealCards = useCallback(
    (
      layout: TableLayout,
      seatIndices: number[],
      cards: DealCardState[],
      onDone?: () => void,
    ) => {
      const { deckOrigin, seats } = layout;

      seatIndices.forEach((seatIdx, i) => {
        const seat = seats[seatIdx];
        if (!seat) return;

        const card = cards[i];
        if (!card) return;

        const dx = seat.x - deckOrigin.x;
        const dy = seat.y - deckOrigin.y;
        const delay = i * DEAL_STAGGER;
        const cfg = { duration: DEAL_DURATION, easing: easeOutCubic };

        // Start: at deck, invisible, full size
        card.translateX.value = 0;
        card.translateY.value = 0;
        card.scale.value      = 1;
        card.opacity.value    = 0;

        card.opacity.value    = withDelay(delay, withTiming(1, { duration: 60 }));
        card.translateX.value = withDelay(delay, withTiming(dx, cfg));
        card.translateY.value = withDelay(delay, withTiming(dy, cfg));
        // Slight scale-down as it travels (perspective feel)
        card.scale.value      = withDelay(
          delay,
          withTiming(0.82, { duration: DEAL_DURATION * 0.6, easing: easeOutCubic }),
        );
      });

      // Fire onDone after last card lands
      if (onDone) {
        const totalMs = seatIndices.length * DEAL_STAGGER + DEAL_DURATION + 50;
        const timeoutId = setTimeout(() => runOnJS(onDone)(), totalMs);
        return () => clearTimeout(timeoutId);
      }
    },
    [],
  ) as unknown as CardDealAnimationResult['dealCards'];

  const resetCards = useCallback((cards: DealCardState[]) => {
    cards.forEach((c) => {
      c.translateX.value = 0;
      c.translateY.value = 0;
      c.scale.value      = 0;
      c.opacity.value    = 0;
    });
  }, []);

  return { dealCards, resetCards };
}
