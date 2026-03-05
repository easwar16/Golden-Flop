/**
 * Prisma seed script – run with: npx prisma db seed
 *
 * Seeds all 16 predefined rooms (12 SOL tables + 4 practice tables)
 * and a test user (development only).
 *
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

const ROOMS: RoomDef[] = [
  // ── 🟢 Low Stakes (SOL) ── rake cap = 3 BB ────────────────────────────────
  { id: 'table-low-1', name: '🟢 Low Stakes #1', smallBlind: sol(0.0001), bigBlind: sol(0.0002), minBuyIn: sol(0.01), maxBuyIn: sol(0.10), maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.0006) },
  { id: 'table-low-2', name: '🟢 Low Stakes #2', smallBlind: sol(0.0001), bigBlind: sol(0.0002), minBuyIn: sol(0.01), maxBuyIn: sol(0.10), maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.0006) },
  { id: 'table-low-3', name: '🟢 Low Stakes #3', smallBlind: sol(0.0001), bigBlind: sol(0.0002), minBuyIn: sol(0.01), maxBuyIn: sol(0.10), maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.0006) },
  { id: 'table-low-4', name: '🟢 Low Stakes #4', smallBlind: sol(0.0002), bigBlind: sol(0.0004), minBuyIn: sol(0.02), maxBuyIn: sol(0.20), maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.0012) },
  { id: 'table-low-5', name: '🟢 Low Stakes #5', smallBlind: sol(0.0002), bigBlind: sol(0.0004), minBuyIn: sol(0.02), maxBuyIn: sol(0.20), maxPlayers: 9, turnTimeoutMs: 45_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.0012) },

  // ── 🟡 Mid Stakes (SOL) ── rake cap = 3 BB ────────────────────────────────
  { id: 'table-mid-1', name: '🟡 Mid Stakes #1', smallBlind: sol(0.001), bigBlind: sol(0.002), minBuyIn: sol(0.10), maxBuyIn: sol(1.00), maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.006) },
  { id: 'table-mid-2', name: '🟡 Mid Stakes #2', smallBlind: sol(0.001), bigBlind: sol(0.002), minBuyIn: sol(0.10), maxBuyIn: sol(1.00), maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.006) },
  { id: 'table-mid-3', name: '🟡 Mid Stakes #3', smallBlind: sol(0.001), bigBlind: sol(0.002), minBuyIn: sol(0.10), maxBuyIn: sol(1.00), maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.006) },
  { id: 'table-mid-4', name: '🟡 Mid Stakes #4', smallBlind: sol(0.002), bigBlind: sol(0.004), minBuyIn: sol(0.20), maxBuyIn: sol(2.00), maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.012) },
  { id: 'table-mid-5', name: '🟡 Mid Stakes #5', smallBlind: sol(0.002), bigBlind: sol(0.004), minBuyIn: sol(0.20), maxBuyIn: sol(2.00), maxPlayers: 9, turnTimeoutMs: 30_000, tokenMint: NATIVE_SOL_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.012) },

  // ── 🔴 High Roller (SOL) ── rake cap = 3 BB ───────────────────────────────
  { id: 'table-high-1', name: '🔴 High Roller #1', smallBlind: sol(0.01), bigBlind: sol(0.02), minBuyIn: sol(1.00), maxBuyIn: sol(10.00), maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: NATIVE_SOL_MINT, isPremium: true, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.06) },
  { id: 'table-high-2', name: '🔴 High Roller #2', smallBlind: sol(0.01), bigBlind: sol(0.02), minBuyIn: sol(1.00), maxBuyIn: sol(10.00), maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: NATIVE_SOL_MINT, isPremium: true, isPractice: false, rakePercentage: 2.5, rakeCap: sol(0.06) },

  // ── 🟣 SEEKER Token Tables ── rake cap = 3 BB ─────────────────────────────
  { id: 'seeker-low-1',  name: '🟣 Seeker Low',  smallBlind: 5n,   bigBlind: 10n,   minBuyIn: 500n,    maxBuyIn: 5_000n,    maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: SEEKER_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: 30n },
  { id: 'seeker-mid-1',  name: '🟣 Seeker Mid',  smallBlind: 25n,  bigBlind: 50n,   minBuyIn: 2_500n,  maxBuyIn: 25_000n,   maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: SEEKER_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: 150n },
  { id: 'seeker-high-1', name: '🟣 Seeker High', smallBlind: 100n, bigBlind: 200n,  minBuyIn: 10_000n, maxBuyIn: 100_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: SEEKER_MINT, isPremium: false, isPractice: false, rakePercentage: 2.5, rakeCap: 600n },

  // ── 🎯 Practice (free chips, no rake) ─────────────────────────────────────
  { id: 'practice-beginner',   name: 'Beginner Table', smallBlind: 5n,   bigBlind: 10n,    minBuyIn: 1_000n,   maxBuyIn: 2_000n,   maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-casual',     name: 'Casual Lounge',  smallBlind: 25n,  bigBlind: 50n,    minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-advanced',   name: 'Advanced Room',  smallBlind: 100n, bigBlind: 200n,   minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
  { id: 'practice-highroller', name: 'High Roller',    smallBlind: 500n, bigBlind: 1_000n, minBuyIn: 100_000n, maxBuyIn: 200_000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
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
