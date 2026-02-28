/**
 * Vault deposit routes – room-specific escrow vault endpoints.
 *
 * GET  /vault/:roomId/address     – returns room's vault public key + network
 * POST /vault/:roomId/verify-buy-in – verifies on-chain transfer to room vault
 *
 * The vault address endpoint is public (mobile needs it to build the TX).
 * The verify-buy-in endpoint requires JWT auth.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, type AuthRequest } from '../auth/jwtMiddleware';
import { verifySOLDepositToVault } from '../solana/SolanaService';
import { creditBalance } from '../balance/BalanceService';
import { generalLimiter } from '../middleware/rateLimiter';

const router = Router();
router.use(generalLimiter);

// ─── GET /vault/:roomId/address ──────────────────────────────────────────────

router.get('/:roomId/address', async (req: Request, res: Response) => {
  const { roomId } = req.params;

  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { vaultAddress: true, tokenType: true },
    });

    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    if (!room.vaultAddress) {
      res.status(404).json({ error: 'Room does not have a vault configured' });
      return;
    }

    res.json({
      vault: room.vaultAddress,
      network: process.env.SOLANA_NETWORK ?? 'devnet',
      tokenType: room.tokenType,
    });
  } catch (err) {
    console.error('[vaultDepositRoutes] Error fetching vault address:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /vault/:roomId/verify-buy-in ──────────────────────────────────────

router.post('/:roomId/verify-buy-in', requireAuth, async (req: Request, res: Response) => {
  const { userId, walletAddress } = (req as AuthRequest).jwtPayload;
  const { roomId } = req.params;
  const { transactionSignature, expectedAmountLamports } = req.body as {
    transactionSignature?: string;
    expectedAmountLamports?: string;
  };

  if (!transactionSignature || !expectedAmountLamports) {
    res.status(400).json({ error: 'transactionSignature and expectedAmountLamports are required' });
    return;
  }

  const expectedAmount = BigInt(expectedAmountLamports);

  // ── Look up room + vault ──────────────────────────────────────────────────
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { vaultAddress: true, tokenType: true },
  });

  if (!room?.vaultAddress) {
    res.status(404).json({ error: 'Room vault not configured' });
    return;
  }

  // ── Idempotency check ─────────────────────────────────────────────────────
  const existing = await prisma.deposit.findUnique({
    where: { transactionSignature },
  });
  if (existing) {
    if (existing.userId !== userId) {
      res.status(409).json({ error: 'Transaction already claimed by another user' });
      return;
    }
    res.json({
      deposit: serializeDeposit(existing),
      alreadyProcessed: true,
    });
    return;
  }

  // ── Create PENDING deposit record ─────────────────────────────────────────
  const deposit = await prisma.deposit.create({
    data: {
      userId,
      tokenType: room.tokenType,
      amount: expectedAmount,
      transactionSignature,
      status: 'PENDING',
    },
  });

  // ── Verify on-chain transfer to vault ─────────────────────────────────────
  const result = await verifySOLDepositToVault(
    transactionSignature,
    expectedAmount,
    walletAddress,
    room.vaultAddress,
  );

  if (!result.success) {
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: 'FAILED' },
    });
    res.status(422).json({ error: result.error, depositId: deposit.id });
    return;
  }

  // ── Confirm deposit ───────────────────────────────────────────────────────
  const confirmedAmount = result.confirmedAmount!;

  await prisma.deposit.update({
    where: { id: deposit.id },
    data: { status: 'CONFIRMED', amount: confirmedAmount },
  });

  const confirmed = await prisma.deposit.findUnique({ where: { id: deposit.id } });
  res.json({
    deposit: serializeDeposit(confirmed!),
    credited: confirmedAmount.toString(),
  });
});

// ─── Serialiser (BigInt → string for JSON) ──────────────────────────────────

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

export { router as vaultDepositRouter };
