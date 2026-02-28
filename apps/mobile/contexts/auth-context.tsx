/**
 * AuthContext – JWT session management for GoldenFlop.
 *
 * Wraps Sign-In With Solana flow:
 *   1. User taps "Connect Wallet" → WalletContext.authorize()
 *   2. User taps "Sign In"        → signIn() (this context)
 *        a. GET nonce from server
 *        b. Sign message with wallet
 *        c. POST signature → receive JWT
 *   3. JWT persisted in expo-secure-store (survives app restarts)
 *   4. On boot: token loaded → /auth/me fetched to restore session
 *
 * Security:
 *  - JWT stored in SecureStore (hardware-backed on Android, Keychain on iOS)
 *  - Private keys never touch this file
 *  - Token verified server-side on every API call
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { useWallet } from './wallet-context';
import {
  getNonce,
  buildLoginMessage,
  signLoginMessage,
  verifySignature,
  fetchMe,
  type AuthUser,
} from '../services/AuthService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  /** Authenticated user profile, or null if not signed in */
  user: AuthUser | null;
  /** Off-chain internal balance in lamports as string (to preserve BigInt) */
  balance: string;
  /** Raw JWT — use this in API calls as Bearer token */
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /** Full SIWS flow: nonce → sign → verify → store JWT */
  signIn: () => Promise<void>;
  /** Clear JWT and user state */
  signOut: () => Promise<void>;
  /** Refresh balance and user profile from server */
  refreshBalance: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const JWT_KEY = 'goldenflop_jwt';

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { accounts, signMessage } = useWallet();

  const [user,      setUser]      = useState<AuthUser | null>(null);
  const [balance,   setBalance]   = useState('0');
  const [token,     setToken]     = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);  // true on boot while loading stored token
  const [error,     setError]     = useState<string | null>(null);

  // ── Load stored JWT on boot ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(JWT_KEY);
        if (stored) {
          // Validate token is still good by fetching /auth/me
          const { user: me, balance: bal } = await fetchMe(stored);
          setToken(stored);
          setUser(me);
          setBalance(bal);
        }
      } catch {
        // Token expired or invalid — clear it silently
        await SecureStore.deleteItemAsync(JWT_KEY).catch(() => {});
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── signIn ──────────────────────────────────────────────────────────────

  const signIn = useCallback(async () => {
    setError(null);

    const account = accounts?.[0];
    if (!account) {
      setError('Wallet not connected. Tap "Connect Wallet" first.');
      return;
    }

    // Convert Uint8Array wallet address → base58 string
    // @solana/web3.js PublicKey.toBase58() handles this cleanly
    let walletAddress: string;
    try {
      const { PublicKey } = await import('@solana/web3.js');
      walletAddress = new PublicKey(account.address).toBase58();
    } catch {
      setError('Invalid wallet address format');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Get nonce
      const nonce = await getNonce(walletAddress);

      // 2. Build + sign message
      const message   = buildLoginMessage(nonce);
      const signature = await signLoginMessage(message, signMessage);

      // 3. Verify with backend → JWT
      const { token: jwt, user: me } = await verifySignature(walletAddress, signature);

      // 4. Persist JWT securely
      await SecureStore.setItemAsync(JWT_KEY, jwt);
      setToken(jwt);
      setUser(me);

      // 5. Fetch balance
      const { balance: bal } = await fetchMe(jwt);
      setBalance(bal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [accounts, signMessage]);

  // ── signOut ─────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(JWT_KEY).catch(() => {});
    setToken(null);
    setUser(null);
    setBalance('0');
    setError(null);
  }, []);

  // ── refreshBalance ──────────────────────────────────────────────────────

  const refreshBalance = useCallback(async () => {
    if (!token) return;
    try {
      const { balance: bal, user: me } = await fetchMe(token);
      setBalance(bal);
      setUser(me);
    } catch {
      // Token expired — sign out
      await signOut();
    }
  }, [token, signOut]);

  const value: AuthContextValue = {
    user,
    balance,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    error,
    signIn,
    signOut,
    refreshBalance,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
