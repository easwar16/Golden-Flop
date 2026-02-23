/**
 * useTableAnimations
 *
 * Central animation manager for the poker table screen.
 *
 * Subscribes to Zustand store changes and fires the correct animations:
 *   - phase → 'preflop'   →  shuffle deck, then deal 2 cards per active seat
 *   - hand_result arrives  →  winner glow + chips fly to winner
 *   - activePlayerSeatIndex changes → chip bet animation (future hook-in)
 *
 * Architecture rules:
 *   - No animation state in Zustand
 *   - All SharedValues live here (local to this hook)
 *   - Components receive state objects; the hook drives the values
 *   - onDone callbacks chain animations sequentially without blocking the JS thread
 */

import { useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '../stores/useGameStore';
import type { TableLayout } from './types';
import { useShuffleAnimation } from './useShuffleAnimation';
import { useCardDealAnimation, createDealCardState } from './useCardDealAnimation';
import { useChipAnimation, createChipStackState } from './useChipAnimation';
import { useWinnerAnimation, createWinnerAnimState } from './useWinnerAnimation';

const MAX_SEATS = 6;

export function useTableAnimations(layout: TableLayout | null) {
  // ── Shuffle ──────────────────────────────────────────────────────────────────
  const shuffle = useShuffleAnimation();

  // ── Card deal (2 flying cards — one per hole card) ───────────────────────────
  const dealAnim = useCardDealAnimation();
  // Two cards per seat, pre-allocated
  const flyingCards = useMemo(
    () => Array.from({ length: MAX_SEATS * 2 }, () => createDealCardState()),
    [],
  );

  // ── Chips (one stack per seat) ────────────────────────────────────────────────
  const chipAnim = useChipAnimation();
  const chipStacks = useMemo(
    () => Array.from({ length: MAX_SEATS }, () => createChipStackState()),
    [],
  );

  // ── Winner glow (one per seat) ────────────────────────────────────────────────
  const winAnim   = useWinnerAnimation();
  const winStates = useMemo(
    () => Array.from({ length: MAX_SEATS }, () => createWinnerAnimState()),
    [],
  );

  // ── Track previous phase to detect transitions ────────────────────────────────
  const prevPhase = useRef<string | null>(null);

  // ── Subscribe to store ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = useGameStore.subscribe((state) => {
      const { phase, seats, lastHandResult } = state;

      // New hand started → shuffle then deal
      if (phase === 'preflop' && prevPhase.current !== 'preflop') {
        prevPhase.current = 'preflop';

        // 1. Shuffle the deck
        shuffle.triggerShuffle();

        // 2. After shuffle completes, deal cards to each occupied seat
        if (layout) {
          const activeSeatIndices = seats
            .map((s, i) => (s ? i : null))
            .filter((i): i is number => i !== null);

          const SHUFFLE_TOTAL_MS = 750;
          setTimeout(() => {
            dealAnim.dealCards(layout, activeSeatIndices, flyingCards, () => {
              // Cards have arrived — hide flying cards (table screen shows real cards)
              dealAnim.resetCards(flyingCards);
            });
          }, SHUFFLE_TOTAL_MS);
        }
      } else {
        prevPhase.current = phase;
      }

      // Winner declared
      if (lastHandResult && layout) {
        lastHandResult.winners.forEach((w) => {
          const seatIdx = w.seatIndex;
          if (seatIdx < 0 || seatIdx >= MAX_SEATS) return;

          // Glow on winning seat
          winAnim.triggerWin(winStates[seatIdx], () => {
            winAnim.resetWinner(winStates[seatIdx]);
          });

          // Chips fly from pot to winner
          chipAnim.animateWin(chipStacks[seatIdx], layout, seatIdx);
        });
      }
    });

    return unsub;
  }, [layout, shuffle, dealAnim, flyingCards, chipAnim, chipStacks, winAnim, winStates]);

  return {
    // expose to table screen so components can be rendered
    shuffleCards: shuffle.cards,
    triggerShuffle: shuffle.triggerShuffle,
    flyingCards,
    chipStacks,
    winStates,
  };
}
