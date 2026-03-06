/**
 * Prisma seed script – run with: npx prisma db seed
 *
 * Seeds 115 predefined rooms:
 *   - 50 SOL tables (micro/low/mid/high/VIP + turbo)
 *   - 50 SEEKER tables (micro/low/mid/high/VIP + turbo)
 *   - 15 Practice tables (beginner/casual/advanced/highroller/turbo/headsup)
 *
 * Also seeds a test user (development only).
 * Uses upsert so it's idempotent — safe to run multiple times.
 */

import { PrismaClient } from '@prisma/client';
import { getOrCreateVaultAddress, isVaultConfigured } from '../src/solana/VaultService';

const prisma = new PrismaClient();

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
  smallBlind: number;  // in SOL
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  turnTimeoutMs: number;
  isPremium: boolean;
}

const SOL_TIERS: SolTier[] = [
  // Micro — min buy-in 0.01 SOL
  { prefix: 'micro-a', smallBlind: 0.001,   bigBlind: 0.002,   minBuyIn: 0.01,  maxBuyIn: 0.05,   turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'micro-b', smallBlind: 0.001,   bigBlind: 0.002,   minBuyIn: 0.01,  maxBuyIn: 0.08,   turnTimeoutMs: 45_000, isPremium: false },
  // Low — min buy-in 0.05 SOL
  { prefix: 'low-a',   smallBlind: 0.002,   bigBlind: 0.005,   minBuyIn: 0.05,  maxBuyIn: 0.25,   turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'low-b',   smallBlind: 0.002,   bigBlind: 0.005,   minBuyIn: 0.05,  maxBuyIn: 0.30,   turnTimeoutMs: 45_000, isPremium: false },
  // Mid — min buy-in 0.8 SOL
  { prefix: 'mid-a',   smallBlind: 0.008,   bigBlind: 0.016,   minBuyIn: 0.80,  maxBuyIn: 4.00,   turnTimeoutMs: 30_000, isPremium: false },
  { prefix: 'mid-b',   smallBlind: 0.008,   bigBlind: 0.016,   minBuyIn: 0.80,  maxBuyIn: 5.00,   turnTimeoutMs: 30_000, isPremium: false },
  // High — min buy-in 1.0 SOL
  { prefix: 'high-a',  smallBlind: 0.01,    bigBlind: 0.02,    minBuyIn: 1.00,  maxBuyIn: 5.00,   turnTimeoutMs: 15_000, isPremium: false },
  { prefix: 'high-b',  smallBlind: 0.01,    bigBlind: 0.02,    minBuyIn: 1.00,  maxBuyIn: 10.00,  turnTimeoutMs: 15_000, isPremium: true  },
  // VIP — unchanged
  { prefix: 'vip-a',   smallBlind: 0.025,   bigBlind: 0.05,    minBuyIn: 2.50,  maxBuyIn: 25.00,  turnTimeoutMs: 15_000, isPremium: true  },
  { prefix: 'vip-b',   smallBlind: 0.05,    bigBlind: 0.1,     minBuyIn: 5.00,  maxBuyIn: 50.00,  turnTimeoutMs: 15_000, isPremium: true  },
];

// Distribution: 50 SOL tables across tiers
// Micro: 8, Low: 10, Mid: 12, High: 10, VIP: 4, Turbo: 6
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
  // Turbo tables (10s timer) — 6 tables across low/mid/high
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
  // Micro — min 50 SEEKER (very low friction)
  { prefix: 'seeker-micro-a', smallBlind: 1n,    bigBlind: 2n,      minBuyIn: 50n,       maxBuyIn: 500n,       turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'seeker-micro-b', smallBlind: 1n,    bigBlind: 2n,      minBuyIn: 50n,       maxBuyIn: 800n,       turnTimeoutMs: 45_000, isPremium: false },
  // Low — min 200 SEEKER
  { prefix: 'seeker-low-a',   smallBlind: 2n,    bigBlind: 5n,      minBuyIn: 200n,      maxBuyIn: 2_000n,     turnTimeoutMs: 45_000, isPremium: false },
  { prefix: 'seeker-low-b',   smallBlind: 2n,    bigBlind: 5n,      minBuyIn: 200n,      maxBuyIn: 2_500n,     turnTimeoutMs: 45_000, isPremium: false },
  // Mid — min 1000 SEEKER
  { prefix: 'seeker-mid-a',   smallBlind: 10n,   bigBlind: 20n,     minBuyIn: 1_000n,    maxBuyIn: 10_000n,    turnTimeoutMs: 30_000, isPremium: false },
  { prefix: 'seeker-mid-b',   smallBlind: 10n,   bigBlind: 20n,     minBuyIn: 1_000n,    maxBuyIn: 15_000n,    turnTimeoutMs: 30_000, isPremium: false },
  // High — min 5000 SEEKER
  { prefix: 'seeker-high-a',  smallBlind: 50n,   bigBlind: 100n,    minBuyIn: 5_000n,    maxBuyIn: 50_000n,    turnTimeoutMs: 15_000, isPremium: false },
  { prefix: 'seeker-high-b',  smallBlind: 50n,   bigBlind: 100n,    minBuyIn: 5_000n,    maxBuyIn: 75_000n,    turnTimeoutMs: 15_000, isPremium: false },
  // VIP — min 25K SEEKER
  { prefix: 'seeker-vip-a',   smallBlind: 250n,  bigBlind: 500n,    minBuyIn: 25_000n,   maxBuyIn: 250_000n,   turnTimeoutMs: 15_000, isPremium: true  },
  { prefix: 'seeker-vip-b',   smallBlind: 500n,  bigBlind: 1_000n,  minBuyIn: 50_000n,   maxBuyIn: 500_000n,   turnTimeoutMs: 15_000, isPremium: true  },
];

// Distribution: 50 SEEKER tables
const SEEKER_DISTRIBUTION: Record<string, number> = {
  'seeker-micro-a': 4, 'seeker-micro-b': 4,
  'seeker-low-a': 5,   'seeker-low-b': 5,
  'seeker-mid-a': 6,   'seeker-mid-b': 6,
  'seeker-high-a': 5,  'seeker-high-b': 5,
  'seeker-vip-a': 3,   'seeker-vip-b': 2,
};

// Turbo SEEKER tables: 5 tables
const SEEKER_TURBO = [
  { prefix: 'seeker-turbo-low',  sb: 2n,   bb: 5n,    min: 200n,    max: 2_000n,   count: 2 },
  { prefix: 'seeker-turbo-mid',  sb: 10n,  bb: 20n,   min: 1_000n,  max: 10_000n,  count: 2 },
  { prefix: 'seeker-turbo-high', sb: 50n,  bb: 100n,  min: 5_000n,  max: 50_000n,  count: 1 },
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
  // Beginner (3)
  { id: 'practice-beginner-1', name: 'Beginner #1',   smallBlind: 5n,     bigBlind: 10n,      minBuyIn: 1_000n,   maxBuyIn: 2_000n,   maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-beginner-2', name: 'Beginner #2',   smallBlind: 5n,     bigBlind: 10n,      minBuyIn: 1_000n,   maxBuyIn: 2_000n,   maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-beginner-3', name: 'Beginner #3',   smallBlind: 10n,    bigBlind: 20n,      minBuyIn: 2_000n,   maxBuyIn: 4_000n,   maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  // Casual (3)
  { id: 'practice-casual-1',   name: 'Casual #1',     smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-casual-2',   name: 'Casual #2',     smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-casual-3',   name: 'Casual #3',     smallBlind: 50n,    bigBlind: 100n,     minBuyIn: 10_000n,  maxBuyIn: 20_000n,  maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  // Advanced (3)
  { id: 'practice-advanced-1', name: 'Advanced #1',   smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-advanced-2', name: 'Advanced #2',   smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-advanced-3', name: 'Advanced #3',   smallBlind: 200n,   bigBlind: 400n,     minBuyIn: 40_000n,  maxBuyIn: 80_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  // High Roller (2)
  { id: 'practice-highroller-1', name: 'High Roller #1', smallBlind: 500n,  bigBlind: 1_000n,  minBuyIn: 100_000n, maxBuyIn: 200_000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-highroller-2', name: 'High Roller #2', smallBlind: 1_000n,bigBlind: 2_000n,  minBuyIn: 200_000n, maxBuyIn: 400_000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  // Turbo (2)
  { id: 'practice-turbo-1',    name: 'Turbo #1',      smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 10_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-turbo-2',    name: 'Turbo #2',      smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 10_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  // Heads Up (2)
  { id: 'practice-headsup-1',  name: 'Heads Up #1',   smallBlind: 25n,    bigBlind: 50n,      minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 2, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-headsup-2',  name: 'Heads Up #2',   smallBlind: 100n,   bigBlind: 200n,     minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 2, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
];

const ROOMS: RoomDef[] = [
  ...generateSolRooms(),
  ...generateSeekerRooms(),
  ...PRACTICE_ROOMS,
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database...');

  const vaultEnabled = isVaultConfigured();

  // ── 1. Seed all rooms ─────────────────────────────────────────────────────
  for (const room of ROOMS) {
    const tokenType = room.tokenMint === NATIVE_SOL_MINT ? 'SOL' : 'SEEKER';

    let vaultAddress: string | null = null;
    if (vaultEnabled && !room.isPractice) {
      try {
        vaultAddress = getOrCreateVaultAddress(room.id);
      } catch {
        // No vault key for this room — that's fine
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
  console.log(`  ✓ ${ROOMS.length} rooms seeded`);

  // ── 2. Seed test user (development only) ──────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const testWallet = 'TestWa11etAddressForDeve1opment11111111111111';

    const user = await prisma.user.upsert({
      where:  { walletAddress: testWallet },
      update: {},
      create: { walletAddress: testWallet, username: 'TestPlayer' },
    });

    await prisma.internalBalance.upsert({
      where:  { userId_tokenType: { userId: user.id, tokenType: 'SOL' } },
      update: { balance: 10_000_000_000n }, // 10 SOL
      create: { userId: user.id, tokenType: 'SOL', balance: 10_000_000_000n },
    });

    await prisma.internalBalance.upsert({
      where:  { userId_tokenType: { userId: user.id, tokenType: 'SEEKER' } },
      update: { balance: 1_000_000_000_000n }, // 1000 SEEKER
      create: { userId: user.id, tokenType: 'SEEKER', balance: 1_000_000_000_000n },
    });

    console.log(`  ✓ Test user seeded: ${testWallet} (10 SOL, 1000 SEEKER)`);
  }

  console.log('Seeding complete.');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
