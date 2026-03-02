/**
 * RoomService – persists Room configuration to PostgreSQL.
 *
 * Predefined tables from definitions.ts are seeded to the DB on first run.
 * Existing rows are never overwritten, so admin changes persist across restarts.
 */

import { prisma } from '../db/prisma';
import type { TokenType } from '@prisma/client';
import { DEFAULT_TABLES } from '../table/definitions';
import { NATIVE_SOL_MINT } from '../table/constants';
import { getOrCreateVaultAddress, isVaultConfigured } from '../solana/VaultService';

/**
 * Seed default tables into the Room table.
 * Only creates rows that don't exist yet — preserves admin changes to existing rows.
 */
export async function seedDefaultTables(): Promise<void> {
  const vaultEnabled = isVaultConfigured();
  let created = 0;

  for (const def of DEFAULT_TABLES) {
    // Skip if this room already exists in the DB
    const existing = await prisma.room.findUnique({ where: { id: def.id } });
    if (existing) continue;

    const tokenType: TokenType = def.config.tokenMint === NATIVE_SOL_MINT ? 'SOL' : 'SEEKER';

    // Derive vault address from keypair if vault keys are configured
    let vaultAddress: string | undefined;
    if (vaultEnabled) {
      try {
        vaultAddress = getOrCreateVaultAddress(def.id);
      } catch (err) {
        console.warn(`[room.service] no vault key for room ${def.id}:`, (err as Error).message);
      }
    }

    await prisma.room.create({
      data: {
        id:             def.id,
        name:           def.name,
        tokenType,
        smallBlind:     BigInt(def.config.smallBlind),
        bigBlind:       BigInt(def.config.bigBlind),
        minBuyIn:       BigInt(def.config.minBuyIn),
        maxBuyIn:       BigInt(def.config.maxBuyIn),
        maxPlayers:     def.config.maxPlayers,
        turnTimeoutMs:  def.config.turnTimeoutMs,
        tokenMint:      def.config.tokenMint,
        rakePercentage: 2.5,
        rakeCap:        0n,
        isPremium:      def.config.isPremium ?? false,
        vaultAddress:   vaultAddress ?? null,
      },
    });
    created++;
  }

  // Patch turnTimeoutMs on existing rows to match current definitions
  let patched = 0;
  for (const def of DEFAULT_TABLES) {
    const existing = await prisma.room.findUnique({ where: { id: def.id } });
    if (existing && existing.turnTimeoutMs !== def.config.turnTimeoutMs) {
      await prisma.room.update({
        where: { id: def.id },
        data: { turnTimeoutMs: def.config.turnTimeoutMs },
      });
      patched++;
    }
  }

  if (created > 0 || patched > 0) {
    console.log(`[room.service] seeded ${created} new room(s), patched ${patched} existing room(s)`);
  } else {
    console.log(`[room.service] all ${DEFAULT_TABLES.length} default rooms already exist and up to date`);
  }

  // Seed practice tables (free-chip rooms stored directly in DB)
  await seedPracticeTables();
}

// ── Practice tables ──────────────────────────────────────────────────────────
// Defined here (not in definitions.ts) because they use raw chip values,
// not lamports, and don't need vaults.

interface PracticeTableDef {
  id: string;
  name: string;
  smallBlind: bigint;
  bigBlind: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  maxPlayers: number;
  turnTimeoutMs: number;
}

const PRACTICE_TABLES: PracticeTableDef[] = [
  { id: 'practice-beginner',    name: 'Beginner Table', smallBlind: 5n,   bigBlind: 10n,    minBuyIn: 1_000n,   maxBuyIn: 2_000n,   maxPlayers: 6, turnTimeoutMs: 45_000 },
  { id: 'practice-casual',      name: 'Casual Lounge',  smallBlind: 25n,  bigBlind: 50n,    minBuyIn: 5_000n,   maxBuyIn: 10_000n,  maxPlayers: 6, turnTimeoutMs: 30_000 },
  { id: 'practice-advanced',    name: 'Advanced Room',  smallBlind: 100n, bigBlind: 200n,   minBuyIn: 20_000n,  maxBuyIn: 40_000n,  maxPlayers: 6, turnTimeoutMs: 15_000 },
  { id: 'practice-highroller',  name: 'High Roller',    smallBlind: 500n, bigBlind: 1_000n, minBuyIn: 100_000n, maxBuyIn: 200_000n, maxPlayers: 6, turnTimeoutMs: 15_000 },
];

async function seedPracticeTables(): Promise<void> {
  let created = 0;

  for (const def of PRACTICE_TABLES) {
    const existing = await prisma.room.findUnique({ where: { id: def.id } });
    if (existing) continue;

    await prisma.room.create({
      data: {
        id:             def.id,
        name:           def.name,
        tokenType:      'SOL',
        smallBlind:     def.smallBlind,
        bigBlind:       def.bigBlind,
        minBuyIn:       def.minBuyIn,
        maxBuyIn:       def.maxBuyIn,
        maxPlayers:     def.maxPlayers,
        turnTimeoutMs:  def.turnTimeoutMs,
        tokenMint:      'SOL',
        rakePercentage: 0,
        rakeCap:        0n,
        isPremium:      false,
        isPractice:     true,
      },
    });
    created++;
  }

  if (created > 0) {
    console.log(`[room.service] seeded ${created} practice room(s)`);
  }
}

/**
 * Get a room's configuration from the database.
 */
export async function getRoom(roomId: string) {
  return prisma.room.findUnique({ where: { id: roomId } });
}

/**
 * List all rooms.
 */
export async function listRooms() {
  return prisma.room.findMany({ orderBy: { createdAt: 'asc' } });
}

/**
 * Create a dynamic room (player-created).
 */
export async function createRoom(data: {
  id: string;
  name: string;
  smallBlind: bigint;
  bigBlind: bigint;
  minBuyIn: bigint;
  maxBuyIn: bigint;
  maxPlayers: number;
  tokenType?: TokenType;
  rakePercentage?: number;
}) {
  return prisma.room.create({
    data: {
      id:             data.id,
      name:           data.name,
      tokenType:      data.tokenType ?? 'SOL',
      smallBlind:     data.smallBlind,
      bigBlind:       data.bigBlind,
      minBuyIn:       data.minBuyIn,
      maxBuyIn:       data.maxBuyIn,
      maxPlayers:     data.maxPlayers,
      rakePercentage: data.rakePercentage ?? 2.5,
      rakeCap:        0n,
    },
  });
}
