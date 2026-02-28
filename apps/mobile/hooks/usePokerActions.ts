/**
 * usePokerActions – the only way components dispatch game actions.
 *
 * Encapsulates:
 *  - Haptic feedback
 *  - Guard: action only fires if it's this player's turn
 *  - Raise amount clamping
 */

import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { SocketService } from '../services/SocketService';
import { useGameStore } from '../stores/useGameStore';

type Action = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export function usePokerActions() {
  const minRaise = useGameStore((s) => s.minRaise);
  const maxRaise = useGameStore((s) => s.maxRaise);
  const currentBet = useGameStore((s) => s.currentBet);
  const myChips = useGameStore((s) => s.myChips);
  const raiseAmount = useGameStore((s) => s.raiseAmount);

  const dispatch = useCallback(
    (action: Action, amount?: number) => {
      // Always read fresh state from the store — closure values can be stale
      // between rapid taps or when server pushes state updates mid-render.
      const state = useGameStore.getState();
      if (!state.tableId || !state.isMyTurn) return;

      // Guard: never send if the local seat is already folded or all-in
      const mySeat = state.mySeatIndex !== null ? state.seats[state.mySeatIndex] : null;
      if (mySeat?.isFolded || mySeat?.isAllIn) return;

      // Optimistically clear turn so rapid taps / race conditions can't double-send
      state.clearMyTurn();

      try {
        Haptics.impactAsync(
          action === 'all-in'
            ? Haptics.ImpactFeedbackStyle.Heavy
            : Haptics.ImpactFeedbackStyle.Light
        );
      } catch {
        // Haptics not available (web / simulator)
      }

      SocketService.sendAction(state.tableId, action, amount);
    },
    [] // no closure deps — reads live state via getState() every call
  );

  const fold = useCallback(() => dispatch('fold'), [dispatch]);

  const check = useCallback(() => dispatch('check'), [dispatch]);

  const call = useCallback(
    () => {
      if (myChips <= 0) return;
      dispatch('call');
    },
    [dispatch, myChips]
  );

  const raise = useCallback(
    (amount?: number) => {
      if (myChips <= 0) return;
      const raw = amount ?? raiseAmount;
      const clamped = Math.max(minRaise, Math.min(maxRaise, raw));
      dispatch('raise', clamped);
    },
    [dispatch, raiseAmount, minRaise, maxRaise, myChips]
  );

  const allIn = useCallback(() => {
    if (myChips <= 0) return;
    dispatch('all-in', myChips);
  }, [dispatch, myChips]);

  const callAmount = Math.min(currentBet, myChips);
  const isMyTurn = useGameStore((s) => s.isMyTurn);

  return { fold, check, call, raise, allIn, callAmount, minRaise, maxRaise, isMyTurn };
}
