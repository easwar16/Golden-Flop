/**
 * BalanceService – manages off-chain internal chip balances.
 *
 * All amounts are in lamports (BigInt) to avoid floating-point errors.
 * Atomic operations use Prisma interactive transactions to prevent
 * race conditions during concurrent joins.
 *
 * Supports multiple token types (SOL, SEEKER) via compound key (userId, tokenType).
 */

import { PrismaClient } from '@prisma/client';
import type { TokenType } from '@prisma/client';
import { prisma } from '../db/prisma';

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getBalance(userId: string, tokenType: TokenType = 'SOL'): Promise<bigint> {
  const row = await prisma.internalBalance.findUnique({
    where: { userId_tokenType: { userId, tokenType } },
  });
  return row?.balance ?? 0n;
}

/**
 * Get all token balances for a user.
 */
export async function getBalances(userId: string): Promise<Record<TokenType, bigint>> {
  const rows = await prisma.internalBalance.findMany({ where: { userId } });
  const result: Record<string, bigint> = { SOL: 0n, SEEKER: 0n };
  for (const row of rows) {
    result[row.tokenType] = row.balance;
  }
  return result as Record<TokenType, bigint>;
}

export async function hasSufficientBalance(
  userId: string,
  amount: bigint,
  tokenType: TokenType = 'SOL',
): Promise<boolean> {
  const balance = await getBalance(userId, tokenType);
  return balance >= amount;
}

// ─── Write (atomic) ───────────────────────────────────────────────────────────

/**
 * Credit (add) an amount to a user's balance.
 * Creates the balance row if it doesn't exist.
 * Accepts an optional Prisma transaction client for composability.
 */
export async function creditBalance(
  userId: string,
  amount: bigint,
  tokenType: TokenType = 'SOL',
  tx?: TxClient,
): Promise<void> {
  if (amount <= 0n) throw new Error('Credit amount must be positive');

  const client = tx ?? prisma;

  await client.internalBalance.upsert({
    where:  { userId_tokenType: { userId, tokenType } },
    update: { balance: { increment: amount } },
    create: { userId, tokenType, balance: amount },
  });
}

/**
 * Debit (subtract) an amount from a user's balance.
 * Returns false if insufficient funds (no balance mutation in that case).
 * Accepts an optional Prisma transaction client for composability.
 *
 * Uses a conditional UPDATE to prevent races:
 * UPDATE internal_balance SET balance = balance - amount
 * WHERE user_id = $1 AND token_type = $2 AND balance >= amount
 */
export async function debitBalance(
  userId: string,
  amount: bigint,
  tokenType: TokenType = 'SOL',
  tx?: TxClient,
): Promise<boolean> {
  if (amount <= 0n) throw new Error('Debit amount must be positive');

  // Optimistic atomic debit: only succeeds if balance is sufficient.
  return await prisma.$transaction(async (txClient) => {
    const row = await txClient.internalBalance.findUnique({
      where: { userId_tokenType: { userId, tokenType } },
      select: { balance: true },
    });

    if (!row || row.balance < amount) return false;

    await txClient.internalBalance.update({
      where: { userId_tokenType: { userId, tokenType } },
      data:  { balance: { decrement: amount } },
    });

    return true;
  });
}

/**
 * Full atomic buy-in flow:
 *  1. Check balance
 *  2. Debit balance
 *  Returns false if insufficient funds.
 */
export async function processBuyIn(
  userId: string,
  tableId: string,
  amount: bigint,
  tokenType: TokenType = 'SOL',
): Promise<{ success: boolean; remainingBalance?: bigint; error?: string }> {
  const success = await debitBalance(userId, amount, tokenType);

  if (!success) {
    const balance = await getBalance(userId, tokenType);
    return {
      success: false,
      error: `Insufficient balance. Have ${balance} lamports, need ${amount}`,
    };
  }

  const remaining = await getBalance(userId, tokenType);
  return { success: true, remainingBalance: remaining };
}

/**
 * Full atomic cash-out flow:
 *  1. Credit player's internal balance with their final chip count
 *  2. Used when a player leaves the table
 */
export async function processCashOut(
  userId: string,
  finalChips: bigint,
  tokenType: TokenType = 'SOL',
): Promise<void> {
  if (finalChips > 0n) {
    await creditBalance(userId, finalChips, tokenType);
  }
}
