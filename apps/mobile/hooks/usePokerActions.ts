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
  const tableId = useGameStore((s) => s.tableId);
  const isMyTurn = useGameStore((s) => s.isMyTurn);
  const minRaise = useGameStore((s) => s.minRaise);
  const maxRaise = useGameStore((s) => s.maxRaise);
  const currentBet = useGameStore((s) => s.currentBet);
  const myChips = useGameStore((s) => s.myChips);
  const raiseAmount = useGameStore((s) => s.raiseAmount);

  const dispatch = useCallback(
    (action: Action, amount?: number) => {
      if (!tableId || !isMyTurn) return;

      try {
        Haptics.impactAsync(
          action === 'all-in'
            ? Haptics.ImpactFeedbackStyle.Heavy
            : Haptics.ImpactFeedbackStyle.Light
        );
      } catch {
        // Haptics not available (web / simulator)
      }

      SocketService.sendAction(tableId, action, amount);
    },
    [tableId, isMyTurn]
  );

  const fold = useCallback(() => dispatch('fold'), [dispatch]);

  const check = useCallback(() => dispatch('check'), [dispatch]);

  const call = useCallback(
    () => dispatch('call'),
    [dispatch]
  );

  const raise = useCallback(
    (amount?: number) => {
      const raw = amount ?? raiseAmount;
      const clamped = Math.max(minRaise, Math.min(maxRaise, raw));
      dispatch('raise', clamped);
    },
    [dispatch, raiseAmount, minRaise, maxRaise]
  );

  const allIn = useCallback(() => dispatch('all-in', myChips), [dispatch, myChips]);

  const callAmount = Math.min(currentBet, myChips);

  return { fold, check, call, raise, allIn, callAmount, minRaise, maxRaise, isMyTurn };
}
