/**
 * Withdrawal routes – request withdrawals from internal balance.
 *
 * POST /withdrawal/request  – create a withdrawal request (debits balance immediately)
 * GET  /withdrawal/history   – user's withdrawal history
 *
 * Withdrawals are created in PENDING state. A separate air-gapped signer
 * service is responsible for executing the on-chain transaction and updating
 * the status to COMPLETED.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, type AuthRequest } from '../auth/jwtMiddleware';
import { debitBalance } from '../balance/BalanceService';
import { generalLimiter } from '../middleware/rateLimiter';
import type { TokenType } from '@prisma/client';

const router = Router();

router.use(requireAuth);
router.use(generalLimiter);

// ─── POST /withdrawal/request ─────────────────────────────────────────────────

router.post('/request', async (req: Request, res: Response) => {
  const { userId } = (req as AuthRequest).jwtPayload;
  const { amount, destinationWallet, tokenType: rawTokenType } = req.body as {
    amount?: string;
    destinationWallet?: string;
    tokenType?: string;
  };

  // ── Validation ──────────────────────────────────────────────────────────
  if (!amount || !destinationWallet) {
    res.status(400).json({ error: 'amount and destinationWallet are required' });
    return;
  }

  const tokenType: TokenType = (rawTokenType === 'SEEKER' ? 'SEEKER' : 'SOL');

  let amountBigInt: bigint;
  try {
    amountBigInt = BigInt(amount);
  } catch {
    res.status(400).json({ error: 'Invalid amount format' });
    return;
  }

  if (amountBigInt <= 0n) {
    res.status(400).json({ error: 'Amount must be positive' });
    return;
  }

  // Basic wallet address validation (base58, 32-44 chars)
  if (destinationWallet.length < 32 || destinationWallet.length > 44) {
    res.status(400).json({ error: 'Invalid destination wallet address' });
    return;
  }

  // ── Atomic debit + create withdrawal ──────────────────────────────────
  try {
    const withdrawal = await prisma.$transaction(async (tx) => {
      // Debit balance within the transaction
      const row = await tx.internalBalance.findUnique({
        where: { userId_tokenType: { userId, tokenType } },
        select: { balance: true },
      });

      if (!row || row.balance < amountBigInt) {
        throw new Error('Insufficient balance');
      }

      await tx.internalBalance.update({
        where: { userId_tokenType: { userId, tokenType } },
        data:  { balance: { decrement: amountBigInt } },
      });

      return tx.withdrawal.create({
        data: {
          userId,
          tokenType,
          amount: amountBigInt,
          destinationWallet,
          status: 'PENDING',
        },
      });
    });

    res.json({
      withdrawal: {
        ...withdrawal,
        amount: withdrawal.amount.toString(),
      },
    });
  } catch (err: any) {
    if (err.message === 'Insufficient balance') {
      res.status(422).json({ error: 'Insufficient balance' });
      return;
    }
    console.error('[withdrawal] request failed:', err);
    res.status(500).json({ error: 'Withdrawal request failed' });
  }
});

// ─── GET /withdrawal/history ──────────────────────────────────────────────────

router.get('/history', async (req: Request, res: Response) => {
  const { userId } = (req as AuthRequest).jwtPayload;

  const withdrawals = await prisma.withdrawal.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    50,
  });

  res.json({
    withdrawals: withdrawals.map(w => ({
      ...w,
      amount: w.amount.toString(),
    })),
  });
});

export { router as withdrawalRouter };
