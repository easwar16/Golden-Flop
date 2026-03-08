import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';

/** Minimal type for account (Uint8Array address for backward compat with auth-context). */
type AccountLike = { address: Uint8Array };

type WalletContextValue = {
  accounts: AccountLike[] | null;
  /** Base58 wallet address — stable string, safe for useEffect dependencies. */
  walletAddress: string | null;
  authToken: Uint8Array | undefined;
  authorize: () => Promise<void>;
  deauthorize: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signAndSendTransaction: (transaction: Transaction | VersionedTransaction, minContextSlot?: number) => Promise<string>;
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
    signAndSendTransaction: mwaSignAndSend,
  } = useMobileWallet();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive a stable base58 string from the SDK's PublicKey.
  const walletAddress = account?.publicKey.toBase58() ?? null;

  // Build the legacy accounts array. Memoised on walletAddress (string comparison)
  // so the reference stays stable across re-renders when the key hasn't changed.
  const accounts: AccountLike[] | null = useMemo(
    () => (account ? [{ address: account.publicKey.toBytes() }] : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- walletAddress is the stable proxy
    [walletAddress],
  );

  const authorize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await connect();
        setIsLoading(false);
        return; // success
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // On last attempt, surface the error
        if (attempt === MAX_RETRIES - 1) {
          setError(`${msg} — please make sure Solflare is open and try again.`);
        }
        // Brief pause before retry
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }
    setIsLoading(false);
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

  const signAndSendTransaction = useCallback(
    async (transaction: Transaction | VersionedTransaction, minContextSlot?: number): Promise<string> => {
      if (!account) throw new Error('Wallet not connected');
      // Timeout guard — MWA can hang if the user dismisses the wallet dialog
      const TIMEOUT_MS = 30_000;
      const result = await Promise.race([
        mwaSignAndSend(transaction, minContextSlot ?? 0),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Wallet request timed out. Please try again.')), TIMEOUT_MS),
        ),
      ]);
      return result;
    },
    [account, mwaSignAndSend],
  );

  const value: WalletContextValue = useMemo(() => ({
    accounts,
    walletAddress,
    authToken: undefined,
    authorize,
    deauthorize,
    signMessage,
    signAndSendTransaction,
    isLoading,
    error,
  }), [accounts, walletAddress, authorize, deauthorize, signMessage, signAndSendTransaction, isLoading, error]);

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
