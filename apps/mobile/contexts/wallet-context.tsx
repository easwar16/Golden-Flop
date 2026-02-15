import {
  transact,
  type AuthorizationResult,
  type Web3MobileWallet,
} from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import type { Account } from '@solana-mobile/mobile-wallet-adapter-protocol';
import React, { createContext, useCallback, useContext, useState } from 'react';

import { APP_IDENTITY, CLUSTER } from '@/constants/solana';

type WalletContextValue = {
  accounts: Account[] | null;
  authToken: Uint8Array | undefined;
  authorize: () => Promise<void>;
  deauthorize: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  isLoading: boolean;
  error: string | null;
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [authToken, setAuthToken] = useState<Uint8Array | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await transact(async (wallet: Web3MobileWallet): Promise<AuthorizationResult> => {
        const authResult = await wallet.authorize({
          cluster: CLUSTER,
          identity: APP_IDENTITY,
          auth_token: authToken,
        });
        return authResult;
      });
      setAccounts(result.accounts);
      setAuthToken(result.auth_token);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setAccounts(null);
      setAuthToken(undefined);
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  const deauthorize = useCallback(async () => {
    if (!authToken) return;
    setIsLoading(true);
    setError(null);
    try {
      await transact(async (wallet: Web3MobileWallet) => {
        await wallet.deauthorize({ auth_token: authToken });
      });
      setAccounts(null);
      setAuthToken(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  const signMessage = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      if (!authToken || !accounts?.length) {
        throw new Error('Wallet not authorized');
      }
      const accountAddress = accounts[0].address;
      const [signed] = await transact(async (wallet: Web3MobileWallet) => {
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
    },
    [authToken, accounts]
  );

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
