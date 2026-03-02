/**
 * AuthContext – JWT session management for GoldenFlop.
 *
 * Uses a module-level singleton so auth state is shared across all consumers
 * without a React Provider in the tree. This avoids the re-render cascade
 * that a Provider causes when it subscribes to WalletContext.
 *
 * Flow:
 *   1. User taps "Connect Wallet" → WalletContext.authorize()
 *   2. User taps "Sign In"        → signIn() (this module)
 *        a. GET nonce from server
 *        b. Sign message with wallet
 *        c. POST signature → receive JWT
 *   3. JWT persisted in expo-secure-store (survives app restarts)
 *   4. On boot: token loaded → /auth/me fetched to restore session
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  getNonce,
  buildLoginMessage,
  signLoginMessage,
  verifySignature,
  fetchMe,
  type AuthUser,
} from '../services/AuthService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthContextValue {
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
  signIn: (walletAddress: string, signMessageFn: (msg: Uint8Array) => Promise<Uint8Array>) => Promise<void>;
  /** Clear JWT and user state */
  signOut: () => Promise<void>;
  /** Refresh balance and user profile from server */
  refreshBalance: () => Promise<void>;
}

const JWT_KEY = 'goldenflop_jwt';

// ─── Singleton store ──────────────────────────────────────────────────────────

interface AuthState {
  user: AuthUser | null;
  balance: string;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

let state: AuthState = {
  user: null,
  balance: '0',
  token: null,
  isLoading: true, // true until boot check completes
  error: null,
};

const listeners = new Set<() => void>();

function getSnapshot(): AuthState {
  return state;
}

function setState(partial: Partial<AuthState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── Boot: load stored JWT once ───────────────────────────────────────────────

let bootStarted = false;

async function bootIfNeeded() {
  if (bootStarted) return;
  bootStarted = true;

  try {
    const stored = await SecureStore.getItemAsync(JWT_KEY);
    if (stored) {
      const { user: me, balance: bal } = await fetchMe(stored);
      setState({ token: stored, user: me, balance: bal, isLoading: false });
    } else {
      setState({ isLoading: false });
    }
  } catch {
    await SecureStore.deleteItemAsync(JWT_KEY).catch(() => {});
    setState({ isLoading: false });
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function signIn(
  walletAddress: string,
  signMessageFn: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<void> {
  setState({ error: null, isLoading: true });

  try {
    const nonce = await getNonce(walletAddress);
    const message = buildLoginMessage(nonce);
    const signature = await signLoginMessage(message, signMessageFn);
    const { token: jwt, user: me } = await verifySignature(walletAddress, signature);

    await SecureStore.setItemAsync(JWT_KEY, jwt);
    setState({ token: jwt, user: me });

    const { balance: bal } = await fetchMe(jwt);
    setState({ balance: bal, isLoading: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState({ error: msg, isLoading: false });
  }
}

async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(JWT_KEY).catch(() => {});
  setState({ token: null, user: null, balance: '0', error: null });
}

async function refreshBalance(): Promise<void> {
  const { token } = state;
  if (!token) return;
  try {
    const { balance: bal, user: me } = await fetchMe(token);
    setState({ balance: bal, user: me });
  } catch {
    await signOut();
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  // Kick off the one-time boot check on first render
  useEffect(() => { bootIfNeeded(); }, []);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<AuthContextValue>(() => ({
    user: snap.user,
    balance: snap.balance,
    token: snap.token,
    isAuthenticated: !!snap.token && !!snap.user,
    isLoading: snap.isLoading,
    error: snap.error,
    signIn,
    signOut,
    refreshBalance,
  }), [snap]);
}
