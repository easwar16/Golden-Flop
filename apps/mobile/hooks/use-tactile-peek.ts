import { useCallback } from 'react';

import { useGame } from '@/contexts/game-context';
import { useWallet } from '@/contexts/wallet-context';

/**
 * Tactile Peek: reveal hole cards only while user holds (e.g. thumb on fingerprint).
 * On Seeker, this should call MWA/Seed Vault to request local-only decryption in TEE;
 * the app would send encrypted card payload and receive plaintext only while authorized.
 * Until then we use in-memory decrypted cards and show/hide on press.
 */
export function useTactilePeek() {
  const { peekHoleCard, stopPeek } = useGame();
  const { accounts } = useWallet();

  const requestPeek = useCallback(
    async (cardIndex: number) => {
      // TODO(Phase 4): When Seed Vault / MWA expose "decrypt in TEE" or sign-to-decrypt:
      // await transact(async (wallet) => {
      //   const decrypted = await wallet.decryptPayload?.(encryptedCardPayload);
      //   return decrypted;
      // });
      // For now we reveal the card from local state (already decrypted in memory for demo).
      peekHoleCard(cardIndex);
    },
    [peekHoleCard]
  );

  const releasePeek = useCallback(() => {
    stopPeek();
  }, [stopPeek]);

  return {
    requestPeek,
    releasePeek,
    isWalletConnected: (accounts?.length ?? 0) > 0,
  };
}
