/**
 * RoomService – persists Room configuration to PostgreSQL.
 *
 * Predefined tables from definitions.ts are synced to the DB on startup.
 * This allows game results to reference rooms via FK and enables
 * future admin management of room configs.
 */

import { prisma } from '../db/prisma';
import type { TokenType } from '@prisma/client';
import { DEFAULT_TABLES } from '../table/definitions';
import { NATIVE_SOL_MINT } from '../table/constants';
import { getOrCreateVaultAddress, isVaultConfigured } from '../solana/VaultService';

/**
 * Sync all predefined tables to the Room table.
 * Uses upsert so it's safe to call on every server start.
 */
export async function syncFromDefinitions(): Promise<void> {
  const vaultEnabled = isVaultConfigured();
  let vaultCount = 0;

  for (const def of DEFAULT_TABLES) {
    const tokenType: TokenType = def.config.tokenMint === NATIVE_SOL_MINT ? 'SOL' : 'SEEKER';

    // Derive vault address from keypair if vault keys are configured
    let vaultAddress: string | undefined;
    if (vaultEnabled) {
      try {
        vaultAddress = getOrCreateVaultAddress(def.id);
        vaultCount++;
      } catch (err) {
        console.warn(`[room.service] no vault key for room ${def.id}:`, (err as Error).message);
      }
    }

    await prisma.room.upsert({
      where: { id: def.id },
      update: {
        name:       def.name,
        smallBlind: BigInt(def.config.smallBlind),
        bigBlind:   BigInt(def.config.bigBlind),
        minBuyIn:   BigInt(def.config.minBuyIn),
        maxBuyIn:   BigInt(def.config.maxBuyIn),
        maxPlayers: def.config.maxPlayers,
        isPremium:  def.config.isPremium ?? false,
        tokenType,
        ...(vaultAddress ? { vaultAddress } : {}),
      },
      create: {
        id:             def.id,
        name:           def.name,
        tokenType,
        smallBlind:     BigInt(def.config.smallBlind),
        bigBlind:       BigInt(def.config.bigBlind),
        minBuyIn:       BigInt(def.config.minBuyIn),
        maxBuyIn:       BigInt(def.config.maxBuyIn),
        maxPlayers:     def.config.maxPlayers,
        rakePercentage: 2.5,
        rakeCap:        0n,
        isPremium:      def.config.isPremium ?? false,
        vaultAddress:   vaultAddress ?? null,
      },
    });
  }

  console.log(
    `[room.service] synced ${DEFAULT_TABLES.length} predefined rooms to DB` +
    (vaultCount > 0 ? ` (${vaultCount} with vault addresses)` : ''),
  );
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
