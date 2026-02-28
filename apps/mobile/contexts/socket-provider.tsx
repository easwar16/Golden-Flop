/**
 * SocketProvider – manages the Socket.io connection lifecycle.
 *
 * Mount once at the root. It:
 *  1. Connects on mount using the player's stable identity
 *  2. Disconnects cleanly on unmount
 *  3. Exposes nothing via context — all state flows through Zustand stores
 *
 * The provider is intentionally thin: no game logic, no state.
 */

import React, { useEffect } from 'react';
import { SocketService } from '../services/SocketService';
import { loadIdentity, getPlayerId, getPlayerName } from '../utils/player-identity';
import { useUserStore } from '../stores/useUserStore';

interface Props {
  children: React.ReactNode;
}

export function SocketProvider({ children }: Props) {
  const avatarSeed = useUserStore((s) => s.avatarSeed);

  useEffect(() => {
    // Load persisted identity first, then connect. If loadIdentity resolves after
    // the sync fallback IDs were already generated, getPlayerId/Name will return
    // the persisted values from that point on.
    loadIdentity().then(() => {
      SocketService.connect(getPlayerId(), getPlayerName(), avatarSeed);
    });

    return () => {
      SocketService.disconnect();
    };
  }, []);

  return <>{children}</>;
}
