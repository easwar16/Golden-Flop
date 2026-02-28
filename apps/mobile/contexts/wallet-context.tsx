import React, { createContext, useCallback, useContext, useState } from 'react';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

/** Minimal type for account (Uint8Array address for backward compat with auth-context). */
type AccountLike = { address: Uint8Array };

type WalletContextValue = {
  accounts: AccountLike[] | null;
  authToken: Uint8Array | undefined;
  authorize: () => Promise<void>;
  deauthorize: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  isLoading: boolean;
  error: string | null;
};

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Inner bridge component — must render inside MobileWalletProvider.
 * Reads from useMobileWallet and exposes the legacy WalletContext shape.
 */
function WalletBridge({ children }: { children: React.ReactNode }) {
  const {
    account,
    connect,
    disconnect,
    signMessage: mwaSign,
  } = useMobileWallet();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert PublicKey → Uint8Array so existing consumers (auth-context, wallet screen) stay compatible
  const accounts: AccountLike[] | null = account
    ? [{ address: account.publicKey.toBytes() }]
    : null;

  const authorize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [connect]);

  const deauthorize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await disconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [disconnect]);

  const signMessage = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      if (!account) throw new Error('Wallet not connected');
      return await mwaSign(message);
    },
    [account, mwaSign],
  );

  const value: WalletContextValue = {
    accounts,
    authToken: undefined,
    authorize,
    deauthorize,
    signMessage,
    isLoading,
    error,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/**
 * WalletProvider must be rendered inside MobileWalletProvider (set up in _layout.tsx).
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  return <WalletBridge>{children}</WalletBridge>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
