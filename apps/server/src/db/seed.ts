/**
 * Database seeder – called automatically on server boot.
 *
 * Seeds 115 predefined rooms:
 *   - 50 SOL tables (micro/low/mid/high/VIP + turbo)
 *   - 50 SEEKER tables (micro/low/mid/high/VIP + turbo)
 *   - 15 Practice tables (beginner/casual/advanced/highroller/turbo/headsup)
 *
 * Also seeds a test user (development only).
 * Uses upsert so it's idempotent — safe to run on every boot.
 */

import { prisma } from './prisma';
import { getOrCreateVaultAddress, isVaultConfigured } from '../solana/VaultService';

// ── Helpers ─────────────────────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;
const sol = (amount: number) => BigInt(Math.round(amount * LAMPORTS_PER_SOL));
const NATIVE_SOL_MINT = 'SOL';
const SEEKER_MINT = process.env.SEEKER_MINT ?? 'SEEKER';

// ── Room definitions ────────────────────────────────────────────────────────

interface RoomDef {
  id: string;
  name: string;
  smallBlind: bigint;
  bigBlind: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  maxPlayers: number;
  turnTimeoutMs: number;
  tokenMint: string;
  isPremium: boolean;
  isPractice: boolean;
  rakePercentage: number;
  rakeCap: bigint;
}

// ── SOL table tier definitions ────────────────────────────────────────────────

interface SolTier {
  prefix: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  turnTimeoutMs: number;
  isPremium: boolean;
}

const SOL_TIERS: SolTier[] = [
  { prefix: 'micro-a', smallBlind: 0.001,   bigBlind: 0.002,   minBuyIn: 0.01,  maxBuyIn: 0.05,   turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'micro-b', smallBlind: 0.001,   bigBlind: 0.002,   minBuyIn: 0.01,  maxBuyIn: 0.08,   turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'low-a',   smallBlind: 0.002,   bigBlind: 0.005,   minBuyIn: 0.05,  maxBuyIn: 0.25,   turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'low-b',   smallBlind: 0.002,   bigBlind: 0.005,   minBuyIn: 0.05,  maxBuyIn: 0.30,   turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'mid-a',   smallBlind: 0.008,   bigBlind: 0.016,   minBuyIn: 0.80,  maxBuyIn: 4.00,   turnTimeoutMs: 30_000, isPremium: false },
  { prefix: 'mid-b',   smallBlind: 0.008,   bigBlind: 0.016,   minBuyIn: 0.80,  maxBuyIn: 5.00,   turnTimeoutMs: 30_000, isPremium: false },
  { prefix: 'high-a',  smallBlind: 0.01,    bigBlind: 0.02,    minBuyIn: 1.00,  maxBuyIn: 5.00,   turnTimeoutMs: 15_000, isPremium: false },
  { prefix: 'high-b',  smallBlind: 0.01,    bigBlind: 0.02,    minBuyIn: 1.00,  maxBuyIn: 10.00,  turnTimeoutMs: 15_000, isPremium: true  },
  { prefix: 'vip-a',   smallBlind: 0.025,   bigBlind: 0.05,    minBuyIn: 2.50,  maxBuyIn: 25.00,  turnTimeoutMs: 15_000, isPremium: true  },
  { prefix: 'vip-b',   smallBlind: 0.05,    bigBlind: 0.1,     minBuyIn: 5.00,  maxBuyIn: 50.00,  turnTimeoutMs: 15_000, isPremium: true  },
];

const SOL_DISTRIBUTION: Record<string, number> = {
  'micro-a': 4, 'micro-b': 4,
  'low-a': 5,   'low-b': 5,
  'mid-a': 6,   'mid-b': 6,
  'high-a': 5,  'high-b': 5,
  'vip-a': 2,   'vip-b': 2,
};

function generateSolRooms(): RoomDef[] {
  const rooms: RoomDef[] = [];
  for (const tier of SOL_TIERS) {
    const count = SOL_DISTRIBUTION[tier.prefix] ?? 2;
    for (let i = 1; i <= count; i++) {
      rooms.push({
        id: `table-${tier.prefix}-${i}`,
        name: `SOL ${tier.prefix} #${i}`,
        smallBlind: sol(tier.smallBlind),
        bigBlind: sol(tier.bigBlind),
        minBuyIn: sol(tier.minBuyIn),
        maxBuyIn: sol(tier.maxBuyIn),
        maxPlayers: 6,
        turnTimeoutMs: tier.turnTimeoutMs,
        tokenMint: NATIVE_SOL_MINT,
        isPremium: tier.isPremium,
        isPractice: false,
        rakePercentage: 2.5,
        rakeCap: sol(tier.bigBlind * 3),
      });
    }
  }
  const turboTiers = [
    { prefix: 'turbo-low',  sb: 0.002,  bb: 0.005,  min: 0.05,  max: 0.25,  count: 2 },
    { prefix: 'turbo-mid',  sb: 0.008,  bb: 0.016,  min: 0.80,  max: 4.00,  count: 2 },
    { prefix: 'turbo-high', sb: 0.01,   bb: 0.02,   min: 1.00,  max: 5.00,  count: 2 },
  ];
  for (const t of turboTiers) {
    for (let i = 1; i <= t.count; i++) {
      rooms.push({
        id: `table-${t.prefix}-${i}`,
        name: `Turbo ${t.prefix.replace('turbo-', '')} #${i}`,
        smallBlind: sol(t.sb),
        bigBlind: sol(t.bb),
        minBuyIn: sol(t.min),
        maxBuyIn: sol(t.max),
        maxPlayers: 6,
        turnTimeoutMs: 10_000,
        tokenMint: NATIVE_SOL_MINT,
        isPremium: false,
        isPractice: false,
        rakePercentage: 2.5,
        rakeCap: sol(t.bb * 3),
      });
    }
  }
  return rooms;
}

// ── SEEKER table tier definitions ────────────────────────────────────────────

interface SeekerTier {
  prefix: string;
  smallBlind: bigint;
  bigBlind: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  turnTimeoutMs: number;
  isPremium: boolean;
}

const SEEKER_TIERS: SeekerTier[] = [
  { prefix: 'seeker-micro-a', smallBlind: 4n,      bigBlind: 8n,        minBuyIn: 200n,        maxBuyIn: 2_000n,       turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'seeker-micro-b', smallBlind: 4n,      bigBlind: 8n,        minBuyIn: 200n,        maxBuyIn: 3_200n,       turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'seeker-low-a',   smallBlind: 8n,      bigBlind: 20n,       minBuyIn: 800n,        maxBuyIn: 8_000n,       turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'seeker-low-b',   smallBlind: 8n,      bigBlind: 20n,       minBuyIn: 800n,        maxBuyIn: 10_000n,      turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'seeker-mid-a',   smallBlind: 40n,     bigBlind: 80n,       minBuyIn: 4_000n,      maxBuyIn: 40_000n,      turnTimeoutMs: 30_000, isPremium: false },
  { prefix: 'seeker-mid-b',   smallBlind: 40n,     bigBlind: 80n,       minBuyIn: 4_000n,      maxBuyIn: 60_000n,      turnTimeoutMs: 30_000, isPremium: false },
  { prefix: 'seeker-high-a',  smallBlind: 200n,    bigBlind: 400n,      minBuyIn: 20_000n,     maxBuyIn: 200_000n,     turnTimeoutMs: 15_000, isPremium: false },
  { prefix: 'seeker-high-b',  smallBlind: 200n,    bigBlind: 400n,      minBuyIn: 20_000n,     maxBuyIn: 300_000n,     turnTimeoutMs: 15_000, isPremium: false },
  { prefix: 'seeker-vip-a',   smallBlind: 1_000n,  bigBlind: 2_000n,    minBuyIn: 100_000n,    maxBuyIn: 1_000_000n,   turnTimeoutMs: 15_000, isPremium: true  },
  { prefix: 'seeker-vip-b',   smallBlind: 2_000n,  bigBlind: 4_000n,    minBuyIn: 200_000n,    maxBuyIn: 2_000_000n,   turnTimeoutMs: 15_000, isPremium: true  },
];

const SEEKER_DISTRIBUTION: Record<string, number> = {
  'seeker-micro-a': 4, 'seeker-micro-b': 4,
  'seeker-low-a': 5,   'seeker-low-b': 5,
  'seeker-mid-a': 6,   'seeker-mid-b': 6,
  'seeker-high-a': 5,  'seeker-high-b': 5,
  'seeker-vip-a': 3,   'seeker-vip-b': 2,
};

const SEEKER_TURBO = [
  { prefix: 'seeker-turbo-low',  sb: 8n,    bb: 20n,    min: 800n,     max: 8_000n,    count: 2 },
  { prefix: 'seeker-turbo-mid',  sb: 40n,   bb: 80n,    min: 4_000n,   max: 40_000n,   count: 2 },
  { prefix: 'seeker-turbo-high', sb: 200n,  bb: 400n,   min: 20_000n,  max: 200_000n,  count: 1 },
];

function generateSeekerRooms(): RoomDef[] {
  const rooms: RoomDef[] = [];
  for (const tier of SEEKER_TIERS) {
    const count = SEEKER_DISTRIBUTION[tier.prefix] ?? 2;
    for (let i = 1; i <= count; i++) {
      rooms.push({
        id: `${tier.prefix}-${i}`,
        name: `SEEKER ${tier.prefix} #${i}`,
        smallBlind: tier.smallBlind,
        bigBlind: tier.bigBlind,
        minBuyIn: tier.minBuyIn,
        maxBuyIn: tier.maxBuyIn,
        maxPlayers: 6,
        turnTimeoutMs: tier.turnTimeoutMs,
        tokenMint: SEEKER_MINT,
        isPremium: tier.isPremium,
        isPractice: false,
        rakePercentage: 2.5,
        rakeCap: tier.bigBlind * 3n,
      });
    }
  }
  for (const t of SEEKER_TURBO) {
    for (let i = 1; i <= t.count; i++) {
      rooms.push({
        id: `${t.prefix}-${i}`,
        name: `SEEKER Turbo ${t.prefix.replace('seeker-turbo-', '')} #${i}`,
        smallBlind: t.sb,
        bigBlind: t.bb,
        minBuyIn: t.min,
        maxBuyIn: t.max,
        maxPlayers: 6,
        turnTimeoutMs: 10_000,
        tokenMint: SEEKER_MINT,
        isPremium: false,
        isPractice: false,
        rakePercentage: 2.5,
        rakeCap: t.bb * 3n,
      });
    }
  }
  return rooms;
}

// ── Practice rooms (15) ──────────────────────────────────────────────────────

const PRACTICE_ROOMS: RoomDef[] = [
  { id: 'practice-beginner-1', name: 'Beginner #1',   smallBlind: 5n,     bigBlind: 10n,      minBuyIn: 1_000n,   maxBuyIn: 2_000n,   maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-beginner-2', name: 'Beginner #2',   smallBlind: 5n,     bigBlind: 10n,      minBuyIn: 1_000n,   maxBuyIn: 2_000n,   maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-beginner-3', name: 'Beginner #3',   smallBlind: 10n,    bigBlind: 20n,      minBuyIn: 2_000n,   maxBuyIn: 4_000n,   maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-casual-1',   name: 'Casual #1',     smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-casual-2',   name: 'Casual #2',     smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-casual-3',   name: 'Casual #3',     smallBlind: 50n,    bigBlind: 100n,     minBuyIn: 10_000n,  maxBuyIn: 20_000n,  maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-advanced-1', name: 'Advanced #1',   smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-advanced-2', name: 'Advanced #2',   smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-advanced-3', name: 'Advanced #3',   smallBlind: 200n,   bigBlind: 400n,     minBuyIn: 40_000n,  maxBuyIn: 80_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-highroller-1', name: 'High Roller #1', smallBlind: 500n,  bigBlind: 1_000n,  minBuyIn: 100_000n, maxBuyIn: 200_000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-highroller-2', name: 'High Roller #2', smallBlind: 1_000n,bigBlind: 2_000n,  minBuyIn: 200_000n, maxBuyIn: 400_000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-turbo-1',    name: 'Turbo #1',      smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 10_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-turbo-2',    name: 'Turbo #2',      smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 10_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-headsup-1',  name: 'Heads Up #1',   smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 2, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-headsup-2',  name: 'Heads Up #2',   smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 2, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
];

const ROOMS: RoomDef[] = [
  ...generateSolRooms(),
  ...generateSeekerRooms(),
  ...PRACTICE_ROOMS,
];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Seed all rooms into the database. Idempotent (uses upsert).
 * Called automatically on server boot from app.ts.
 */
export async function seedDatabase(): Promise<void> {
  const roomCount = await prisma.room.count();
  if (roomCount >= ROOMS.length) {
    console.log(`[seed] ${roomCount} rooms already exist — skipping seed`);
    return;
  }

  console.log('[seed] seeding database...');

  const vaultEnabled = isVaultConfigured();

  for (const room of ROOMS) {
    const tokenType = room.tokenMint === NATIVE_SOL_MINT ? 'SOL' : 'SEEKER';

    let vaultAddress: string | null = null;
    if (vaultEnabled && !room.isPractice) {
      try {
        vaultAddress = getOrCreateVaultAddress(room.id);
      } catch {
        // No vault key for this room
      }
    }

    await prisma.room.upsert({
      where: { id: room.id },
      update: {
        name:           room.name,
        smallBlind:     room.smallBlind,
        bigBlind:       room.bigBlind,
        minBuyIn:       room.minBuyIn,
        maxBuyIn:       room.maxBuyIn,
        maxPlayers:     room.maxPlayers,
        turnTimeoutMs:  room.turnTimeoutMs,
        tokenMint:      room.tokenMint,
        isPremium:      room.isPremium,
        isPractice:     room.isPractice,
        rakePercentage: room.rakePercentage,
        rakeCap:        room.rakeCap,
        tokenType:      tokenType as any,
        ...(vaultAddress ? { vaultAddress } : {}),
      },
      create: {
        id:             room.id,
        name:           room.name,
        tokenType:      tokenType as any,
        smallBlind:     room.smallBlind,
        bigBlind:       room.bigBlind,
        minBuyIn:       room.minBuyIn,
        maxBuyIn:       room.maxBuyIn,
        maxPlayers:     room.maxPlayers,
        turnTimeoutMs:  room.turnTimeoutMs,
        tokenMint:      room.tokenMint,
        rakePercentage: room.rakePercentage,
        rakeCap:        room.rakeCap,
        isPremium:      room.isPremium,
        isPractice:     room.isPractice,
        vaultAddress,
      },
    });
  }

  console.log(`[seed] ${ROOMS.length} rooms seeded`);
}
