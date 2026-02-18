import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

import { APP_IDENTITY, CLUSTER } from '@/constants/solana';

/** Minimal type for account from Solana MWA (avoids loading native module at startup). */
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

/** Lazy-load Solana MWA only when needed (avoids crash in Expo Go / when native module not built). */
async function getSolanaAdapter() {
  const mod = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  return mod;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<AccountLike[] | null>(null);
  const [authToken, setAuthToken] = useState<Uint8Array | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authTokenRef = useRef<Uint8Array | undefined>(authToken);
  authTokenRef.current = authToken;

  const authorize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { transact } = await getSolanaAdapter();
      const result = await transact(async (wallet) => {
        const authResult = await wallet.authorize({
          cluster: CLUSTER,
          identity: APP_IDENTITY,
          auth_token: authTokenRef.current,
        });
        return authResult;
      });
      setAccounts(result.accounts as AccountLike[]);
      setAuthToken(result.auth_token);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.includes('SolanaMobileWalletAdapter') || message.includes('TurboModuleRegistry')
          ? 'Wallet adapter requires a development build. Run with expo run:android or expo run:ios.'
          : message
      );
      setAccounts(null);
      setAuthToken(undefined);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deauthorize = useCallback(async () => {
    if (!authToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const { transact } = await getSolanaAdapter();
      await transact(async (wallet) => {
        await wallet.deauthorize({ auth_token: authToken });
      });
      setAccounts(null);
      setAuthToken(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.includes('SolanaMobileWalletAdapter') || message.includes('TurboModuleRegistry')
          ? 'Wallet adapter requires a development build.'
          : message
      );
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    if (!authToken || !accounts?.length) {
      throw new Error('Wallet not authorized');
    }
    const { transact } = await getSolanaAdapter();
    const accountAddress = accounts[0].address;
    const [signed] = await transact(async (wallet) => {
      await wallet.authorize({
        cluster: CLUSTER,
        identity: APP_IDENTITY,
        auth_token: authToken,
      });
      const signedMessages = await wallet.signMessages({
        addresses: [accountAddress],
        payloads: [message],
      });
      return signedMessages;
    });
    return signed;
  }, [authToken, accounts]);

  const value: WalletContextValue = {
    accounts,
    authToken,
    authorize,
    deauthorize,
    signMessage,
    isLoading,
    error,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
