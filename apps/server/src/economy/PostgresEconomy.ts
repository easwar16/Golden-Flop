/**
 * PostgresEconomy – production implementation of IEconomy backed by PostgreSQL.
 *
 * Replaces the InMemoryEconomy for authenticated, real-money games.
 * The `userId` here is the database User.id (from JWT), not a socket playerId.
 *
 * This implements the existing IEconomy interface so it can be swapped in
 * without changing Room / GameEngine code.
 */

import type { IEconomy, EconomyTransaction } from './EconomyInterface';
import { prisma } from '../db/prisma';
import {
  getBalance,
  debitBalance,
  creditBalance,
} from '../balance/BalanceService';

export class PostgresEconomy implements IEconomy {
  /**
   * Deduct buy-in chips from the user's internal balance.
   * Returns false if insufficient funds (no mutation in that case).
   */
  async debitBuyIn(userId: string, tableId: string, amount: number): Promise<boolean> {
    return debitBalance(userId, BigInt(amount), 'SOL');
  }

  /**
   * Credit chips back to the user when they leave the table.
   */
  async creditCashOut(userId: string, tableId: string, amount: number): Promise<void> {
    if (amount > 0) await creditBalance(userId, BigInt(amount), 'SOL');
  }

  /**
   * Record a win in GameResult (for history/leaderboard).
   * Does NOT modify balance — chips are already in the player's stack in-game.
   * The stack is cashed out via creditCashOut when the player leaves.
   */
  async recordWin(
    userId: string,
    tableId: string,
    amount: number,
    handId: string,
  ): Promise<void> {
    // Non-critical: log failure but don't throw
    try {
      await prisma.gameResult.upsert({
        where:  { handId },
        update: { potSize: BigInt(amount) },
        create: {
          handId,
          roomId:   tableId,
          tableId,
          winnerId: userId,
          potSize:  BigInt(amount),
          rake:     BigInt(0),
          players:  [],
        },
      });
    } catch (err) {
      console.error('[economy] recordWin failed:', err);
    }
  }

  async getBalance(userId: string): Promise<number> {
    const bal = await getBalance(userId, 'SOL');
    // Safe cast: chip counts fit in JS number range (< 2^53)
    return Number(bal);
  }

  async getTransactions(
    filter: { playerId?: string; tableId?: string },
  ): Promise<EconomyTransaction[]> {
    // Return deposit history as a simplified transaction log
    if (!filter.playerId) return [];

    const deposits = await prisma.deposit.findMany({
      where:   { userId: filter.playerId, status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });

    return deposits.map((d) => ({
      playerId:  d.userId,
      tableId:   filter.tableId ?? '',
      amount:    Number(d.amount),
      type:      'buy_in' as const,
      timestamp: d.createdAt.getTime(),
    }));
  }
}

export const postgresEconomy = new PostgresEconomy();
