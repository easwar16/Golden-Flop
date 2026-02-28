/**
 * Deposit routes – verify on-chain transfers and credit internal balance.
 *
 * POST /deposit/sol    – verify a SOL deposit
 * POST /deposit/spl    – verify a Seeker SPL token deposit
 * GET  /deposit/history – user's deposit history
 * GET  /deposit/address – treasury address (for UI to build transactions)
 *
 * All routes require a valid JWT.
 *
 * Idempotency: `transactionSignature` is unique in the Deposit table.
 * Sending the same tx twice returns the existing record, not a double-credit.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, type AuthRequest } from '../auth/jwtMiddleware';
import {
  verifySOLDeposit,
  verifySPLDeposit,
  getTreasuryAddress,
} from '../solana/SolanaService';
import { creditBalance } from '../balance/BalanceService';
import { generalLimiter } from '../middleware/rateLimiter';

const router = Router();

// All deposit routes require auth
router.use(requireAuth);
router.use(generalLimiter);

// ─── GET /deposit/address ─────────────────────────────────────────────────────

router.get('/address', (_req: Request, res: Response) => {
  try {
    res.json({
      treasury: getTreasuryAddress(),
      seekerMint: process.env.SEEKER_MINT ?? null,
      network: process.env.SOLANA_NETWORK ?? 'devnet',
    });
  } catch (err) {
    res.status(500).json({ error: 'Treasury not configured' });
  }
});

// ─── POST /deposit/sol ────────────────────────────────────────────────────────

router.post('/sol', async (req: Request, res: Response) => {
  const { userId, walletAddress } = (req as AuthRequest).jwtPayload;
  const { transactionSignature, expectedAmountLamports } = req.body as {
    transactionSignature?: string;
    expectedAmountLamports?: string; // sent as string to preserve BigInt precision
  };

  if (!transactionSignature || !expectedAmountLamports) {
    res.status(400).json({ error: 'transactionSignature and expectedAmountLamports are required' });
    return;
  }

  const expectedAmount = BigInt(expectedAmountLamports);

  // ── Idempotency check ───────────────────────────────────────────────────
  const existing = await prisma.deposit.findUnique({
    where: { transactionSignature },
  });
  if (existing) {
    if (existing.userId !== userId) {
      res.status(409).json({ error: 'Transaction already claimed by another user' });
      return;
    }
    res.json({ deposit: serializeDeposit(existing), alreadyProcessed: true });
    return;
  }

  // ── Create PENDING record ───────────────────────────────────────────────
  const deposit = await prisma.deposit.create({
    data: {
      userId,
      tokenType: 'SOL',
      amount: expectedAmount,
      transactionSignature,
      status: 'PENDING',
    },
  });

  // ── Verify on-chain ─────────────────────────────────────────────────────
  const result = await verifySOLDeposit(transactionSignature, expectedAmount, walletAddress);

  if (!result.success) {
    await prisma.deposit.update({
      where: { id: deposit.id },
      data:  { status: 'FAILED' },
    });
    res.status(422).json({ error: result.error, depositId: deposit.id });
    return;
  }

  // ── Confirm & credit ────────────────────────────────────────────────────
  const confirmedAmount = result.confirmedAmount!;

  await prisma.$transaction(async (tx) => {
    await tx.deposit.update({
      where: { id: deposit.id },
      data:  { status: 'CONFIRMED', amount: confirmedAmount },
    });
    await creditBalance(userId, confirmedAmount, 'SOL', tx as any);
  });

  const confirmed = await prisma.deposit.findUnique({ where: { id: deposit.id } });
  res.json({ deposit: serializeDeposit(confirmed!), credited: confirmedAmount.toString() });
});

// ─── POST /deposit/spl ────────────────────────────────────────────────────────

router.post('/spl', async (req: Request, res: Response) => {
  const { userId, walletAddress } = (req as AuthRequest).jwtPayload;
  const { transactionSignature, expectedAmount } = req.body as {
    transactionSignature?: string;
    expectedAmount?: string;
  };

  if (!transactionSignature || !expectedAmount) {
    res.status(400).json({ error: 'transactionSignature and expectedAmount are required' });
    return;
  }

  const expected = BigInt(expectedAmount);

  // ── Idempotency check ───────────────────────────────────────────────────
  const existing = await prisma.deposit.findUnique({ where: { transactionSignature } });
  if (existing) {
    if (existing.userId !== userId) {
      res.status(409).json({ error: 'Transaction already claimed by another user' });
      return;
    }
    res.json({ deposit: serializeDeposit(existing), alreadyProcessed: true });
    return;
  }

  // ── Create PENDING record ───────────────────────────────────────────────
  const deposit = await prisma.deposit.create({
    data: {
      userId,
      tokenType: 'SEEKER',
      amount: expected,
      transactionSignature,
      status: 'PENDING',
    },
  });

  // ── Verify on-chain ─────────────────────────────────────────────────────
  const result = await verifySPLDeposit(transactionSignature, expected, walletAddress);

  if (!result.success) {
    await prisma.deposit.update({
      where: { id: deposit.id },
      data:  { status: 'FAILED' },
    });
    res.status(422).json({ error: result.error, depositId: deposit.id });
    return;
  }

  const confirmedAmount = result.confirmedAmount!;

  await prisma.$transaction(async (tx) => {
    await tx.deposit.update({
      where: { id: deposit.id },
      data:  { status: 'CONFIRMED', amount: confirmedAmount },
    });
    await creditBalance(userId, confirmedAmount, 'SEEKER', tx as any);
  });

  const confirmed = await prisma.deposit.findUnique({ where: { id: deposit.id } });
  res.json({ deposit: serializeDeposit(confirmed!), credited: confirmedAmount.toString() });
});

// ─── GET /deposit/history ─────────────────────────────────────────────────────

router.get('/history', async (req: Request, res: Response) => {
  const { userId } = (req as AuthRequest).jwtPayload;

  const deposits = await prisma.deposit.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({ deposits: deposits.map(serializeDeposit) });
});

// ─── Serialiser (BigInt → string for JSON) ────────────────────────────────────

function serializeDeposit(d: {
  id: string;
  userId: string;
  tokenType: string;
  amount: bigint;
  transactionSignature: string;
  status: string;
  createdAt: Date;
}) {
  return { ...d, amount: d.amount.toString() };
}

export { router as depositRouter };
