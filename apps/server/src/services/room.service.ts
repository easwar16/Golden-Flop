/**
 * RoomService – reads Room configuration from PostgreSQL.
 *
 * All room definitions live in prisma/seed.ts and are seeded via `prisma db seed`.
 * This module only provides runtime query/create functions.
 */

import { prisma } from '../db/prisma';
import type { TokenType } from '@prisma/client';

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
