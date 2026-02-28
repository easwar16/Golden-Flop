/**
 * DepositService – extracted from depositRoutes.ts for reusability.
 *
 * Handles deposit creation, on-chain verification, and balance crediting.
 */

import { prisma } from '../db/prisma';
import type { TokenType } from '@prisma/client';
import { creditBalance } from '../balance/BalanceService';

export interface DepositRecord {
  id: string;
  userId: string;
  tokenType: string;
  amount: string;   // BigInt serialised as string
  transactionSignature: string;
  status: string;
  createdAt: Date;
}

/**
 * Check if a transaction signature has already been processed.
 * Returns the existing deposit if found, null otherwise.
 */
export async function findBySignature(transactionSignature: string) {
  return prisma.deposit.findUnique({ where: { transactionSignature } });
}

/**
 * Create a PENDING deposit record.
 */
export async function createPendingDeposit(
  userId: string,
  tokenType: TokenType,
  amount: bigint,
  transactionSignature: string,
) {
  return prisma.deposit.create({
    data: {
      userId,
      tokenType,
      amount,
      transactionSignature,
      status: 'PENDING',
    },
  });
}

/**
 * Mark deposit as FAILED.
 */
export async function markFailed(depositId: string) {
  return prisma.deposit.update({
    where: { id: depositId },
    data:  { status: 'FAILED' },
  });
}

/**
 * Confirm a deposit and credit the user's balance atomically.
 */
export async function confirmAndCredit(
  depositId: string,
  userId: string,
  confirmedAmount: bigint,
  tokenType: TokenType = 'SOL',
) {
  await prisma.$transaction(async (tx) => {
    await tx.deposit.update({
      where: { id: depositId },
      data:  { status: 'CONFIRMED', amount: confirmedAmount },
    });
    await creditBalance(userId, confirmedAmount, tokenType, tx as any);
  });
}

/**
 * Get deposit history for a user.
 */
export async function getHistory(userId: string, limit = 50) {
  const deposits = await prisma.deposit.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  });

  return deposits.map(d => ({
    ...d,
    amount: d.amount.toString(),
  }));
}
