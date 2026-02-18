import { useCallback, useRef, useState } from 'react';

/**
 * All-In Hammer: on Seeker, side-button double-tap triggers All-In.
 * We'd register for the hardware event via a native module (e.g. Seeker SDK).
 * For demo / non-Seeker devices, we use a double-tap gesture on a dedicated UI zone.
 */
const DOUBLE_TAP_MS = 400;

export function useAllInHammer(onAllIn: () => void) {
  const lastTap = useRef(0);
  const [hammerReady, setHammerReady] = useState(false);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current <= DOUBLE_TAP_MS) {
      onAllIn();
      setHammerReady(false);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
      setHammerReady(true);
    }
  }, [onAllIn]);

  return { handleTap, hammerReady };
}
