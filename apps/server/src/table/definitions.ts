/**
 * Default table definitions – created at server startup and never destroyed.
 *
 * All monetary values are in lamports (see constants.ts).
 *
 * Tier breakdown:
 *   🟢 Low    – 0.0001/0.0002 SOL blinds, 0.01 SOL min buy-in
 *   🟡 Mid    – 0.001/0.002 SOL blinds,   0.10 SOL min buy-in
 *   🔴 High   – 0.01/0.02 SOL blinds,     1.00 SOL min buy-in  (isPremium)
 */

import type { TableConfig } from '@goldenflop/shared';
import { sol, NATIVE_SOL_MINT } from './constants';

export interface TableDefinition {
  /** Stable UUID — hard-coded so Redis keys survive restarts. */
  id: string;
  name: string;
  config: TableConfig;
}

export const DEFAULT_TABLES: TableDefinition[] = [
  // ── 🟢 Low Stakes (0.03/0.05 SOL blinds) ────────────────────────────────
  {
    id: 'table-low-1',
    name: '🟢 Low Stakes #1',
    config: {
      smallBlind:   sol(0.0001),
      bigBlind:     sol(0.0002),
      minBuyIn:     sol(0.01),
      maxBuyIn:     sol(0.10),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-low-2',
    name: '🟢 Low Stakes #2',
    config: {
      smallBlind:   sol(0.0001),
      bigBlind:     sol(0.0002),
      minBuyIn:     sol(0.01),
      maxBuyIn:     sol(0.10),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-low-3',
    name: '🟢 Low Stakes #3',
    config: {
      smallBlind:   sol(0.0001),
      bigBlind:     sol(0.0002),
      minBuyIn:     sol(0.01),
      maxBuyIn:     sol(0.10),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-low-4',
    name: '🟢 Low Stakes #4',
    config: {
      smallBlind:   sol(0.0002),
      bigBlind:     sol(0.0004),
      minBuyIn:     sol(0.02),
      maxBuyIn:     sol(0.20),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-low-5',
    name: '🟢 Low Stakes #5',
    config: {
      smallBlind:   sol(0.0002),
      bigBlind:     sol(0.0004),
      minBuyIn:     sol(0.02),
      maxBuyIn:     sol(0.20),
      maxPlayers:   9,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },

  // ── 🟡 Mid Stakes ─────────────────────────────────────────────────────────
  {
    id: 'table-mid-1',
    name: '🟡 Mid Stakes #1',
    config: {
      smallBlind:   sol(0.001),
      bigBlind:     sol(0.002),
      minBuyIn:     sol(0.10),
      maxBuyIn:     sol(1.00),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-mid-2',
    name: '🟡 Mid Stakes #2',
    config: {
      smallBlind:   sol(0.001),
      bigBlind:     sol(0.002),
      minBuyIn:     sol(0.10),
      maxBuyIn:     sol(1.00),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-mid-3',
    name: '🟡 Mid Stakes #3',
    config: {
      smallBlind:   sol(0.001),
      bigBlind:     sol(0.002),
      minBuyIn:     sol(0.10),
      maxBuyIn:     sol(1.00),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-mid-4',
    name: '🟡 Mid Stakes #4',
    config: {
      smallBlind:   sol(0.002),
      bigBlind:     sol(0.004),
      minBuyIn:     sol(0.20),
      maxBuyIn:     sol(2.00),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },
  {
    id: 'table-mid-5',
    name: '🟡 Mid Stakes #5',
    config: {
      smallBlind:   sol(0.002),
      bigBlind:     sol(0.004),
      minBuyIn:     sol(0.20),
      maxBuyIn:     sol(2.00),
      maxPlayers:   9,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    false,
    },
  },

  // ── 🔴 High Roller ────────────────────────────────────────────────────────
  {
    id: 'table-high-1',
    name: '🔴 High Roller #1',
    config: {
      smallBlind:   sol(0.01),
      bigBlind:     sol(0.02),
      minBuyIn:     sol(1.00),
      maxBuyIn:     sol(10.00),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    true,
    },
  },
  {
    id: 'table-high-2',
    name: '🔴 High Roller #2',
    config: {
      smallBlind:   sol(0.01),
      bigBlind:     sol(0.02),
      minBuyIn:     sol(1.00),
      maxBuyIn:     sol(10.00),
      maxPlayers:   6,
      turnTimeoutMs: 30_000,
      tokenMint:    NATIVE_SOL_MINT,
      isPremium:    true,
    },
  },
];
