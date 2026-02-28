/**
 * GameService – persists hand results and manages game history.
 *
 * Called from Room.finishHand() after showdown. Records the GameResult
 * with full player details and rake amount in an atomic transaction.
 */

import { prisma } from '../db/prisma';

export interface PlayerHandResult {
  playerId: string;
  name: string;
  seatIndex: number;
  startChips: number;
  endChips: number;
  winAmount: number;
}

export interface HandResultInput {
  handId: string;
  tableId: string;
  roomId: string;
  winnerId: string | null; // DB userId of winner (null if unauthenticated)
  potSize: number;
  rakeAmount: number;
  players: PlayerHandResult[];
}

/**
 * Persist a completed hand to the database.
 *
 * This is fire-and-forget from the Room's perspective — game state is
 * authoritative in memory/Redis. DB persistence is for history/audit.
 */
export async function recordHandResult(input: HandResultInput): Promise<void> {
  try {
    await prisma.gameResult.upsert({
      where:  { handId: input.handId },
      update: {
        potSize: BigInt(input.potSize),
        rake:    BigInt(input.rakeAmount),
        players: input.players as any,
      },
      create: {
        handId:   input.handId,
        roomId:   input.roomId,
        tableId:  input.tableId,
        winnerId: input.winnerId,
        potSize:  BigInt(input.potSize),
        rake:     BigInt(input.rakeAmount),
        players:  input.players as any,
      },
    });
  } catch (err) {
    // Non-critical: don't crash the game loop
    console.error('[game.service] recordHandResult failed:', err);
  }
}

/**
 * Get hand history for a user (as winner).
 */
export async function getHandHistory(
  userId: string,
  limit = 50,
) {
  return prisma.gameResult.findMany({
    where:   { winnerId: userId },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  });
}

/**
 * Get hand history for a specific room/table.
 */
export async function getRoomHistory(
  roomId: string,
  limit = 50,
) {
  return prisma.gameResult.findMany({
    where:   { roomId },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  });
}
