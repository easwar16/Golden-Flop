/**
 * useTurnTimer – countdown timer driven by server `turnTimeoutAt`.
 *
 * Returns:
 *  - secondsLeft : integer seconds remaining
 *  - progress    : 0 → 1  (1 = full time, 0 = expired) — use for progress bars
 *  - isExpired   : convenience boolean
 *
 * The component re-renders once per second while the timer is running.
 * When `turnTimeoutAt` is null (not our turn) the hook is dormant.
 */

import { useEffect, useRef, useState } from 'react';

const TURN_DURATION_MS = 30_000; // must match server config

interface TurnTimerResult {
  secondsLeft: number;
  progress: number;   // 1 = full, 0 = expired
  isExpired: boolean;
}

export function useTurnTimer(turnTimeoutAt: number | null): TurnTimerResult {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!turnTimeoutAt) {
      setSecondsLeft(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, turnTimeoutAt - Date.now());
      setSecondsLeft(Math.ceil(remaining / 1_000));
    };

    tick(); // immediate first tick
    intervalRef.current = setInterval(tick, 250); // 4× per second for smoothness

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [turnTimeoutAt]);

  const progress = turnTimeoutAt
    ? Math.max(0, Math.min(1, (turnTimeoutAt - Date.now()) / TURN_DURATION_MS))
    : 0;

  return {
    secondsLeft,
    progress,
    isExpired: secondsLeft === 0 && turnTimeoutAt !== null,
  };
}
