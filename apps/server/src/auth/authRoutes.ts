/**
 * Auth routes – Sign-In With Solana (SIWS)
 *
 * Flow:
 *   1. POST /auth/nonce   – client sends walletAddress → server returns nonce
 *   2. POST /auth/verify  – client sends walletAddress + signed message → JWT
 *   3. GET  /auth/me      – returns current user (requires JWT)
 *
 * Replay protection: nonce is single-use; deleted from Redis on first use.
 * Nonce TTL: 5 minutes (stored in Redis).
 */

import { Router, Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { getRedis, isRedisEnabled } from '../redis/RedisClient';
import { prisma } from '../db/prisma';
import { verifyWalletSignature } from '../solana/SolanaService';
import { requireAuth, type AuthRequest } from './jwtMiddleware';
import { authLimiter } from '../middleware/rateLimiter';
import { findOrCreateUser } from '../services/user.service';
import { getBalances } from '../balance/BalanceService';

const router = Router();

// In-memory nonce fallback if Redis is unavailable (dev only)
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();

// ─── Nonce storage helpers ────────────────────────────────────────────────────

async function storeNonce(walletAddress: string, nonce: string): Promise<void> {
  if (isRedisEnabled()) {
    await getRedis()!.set(`nonce:${walletAddress}`, nonce, 'EX', 300); // 5 min
  } else {
    nonceStore.set(walletAddress, { nonce, expiresAt: Date.now() + 300_000 });
  }
}

async function consumeNonce(walletAddress: string): Promise<string | null> {
  if (isRedisEnabled()) {
    const redis = getRedis()!;
    const nonce = await redis.get(`nonce:${walletAddress}`);
    if (nonce) await redis.del(`nonce:${walletAddress}`); // single-use
    return nonce;
  }
  const entry = nonceStore.get(walletAddress);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    nonceStore.delete(walletAddress);
    return null;
  }
  nonceStore.delete(walletAddress); // single-use
  return entry.nonce;
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function signJwt(payload: { userId: string; walletAddress: string }): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']) ?? '30d',
  });
}

// ─── POST /auth/nonce ─────────────────────────────────────────────────────────

router.post('/nonce', authLimiter, async (req: Request, res: Response) => {
  const { walletAddress } = req.body as { walletAddress?: string };

  if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.length < 32) {
    res.status(400).json({ error: 'walletAddress is required' });
    return;
  }

  // 16-byte hex nonce — enough entropy for replay protection
  const nonce = randomBytes(16).toString('hex');
  await storeNonce(walletAddress, nonce);

  res.json({ nonce });
});

// ─── POST /auth/verify ────────────────────────────────────────────────────────

router.post('/verify', authLimiter, async (req: Request, res: Response) => {
  const { walletAddress, signature } = req.body as {
    walletAddress?: string;
    // base64-encoded 64-byte ed25519 signature from the wallet
    signature?: string;
  };

  if (!walletAddress || !signature) {
    res.status(400).json({ error: 'walletAddress and signature are required' });
    return;
  }

  // 1. Retrieve & consume nonce (single-use, replay protection)
  const nonce = await consumeNonce(walletAddress);
  if (!nonce) {
    res.status(401).json({ error: 'Nonce expired or not found. Request a new one.' });
    return;
  }

  // 2. Reconstruct the exact message the client signed
  const message = `Sign this message to login to Golden Flop. Nonce: ${nonce}`;

  // 3. Verify ed25519 signature on-chain-style (tweetnacl, pure JS, no RPC needed)
  const isValid = verifyWalletSignature(walletAddress, message, signature);
  if (!isValid) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // 4. Upsert user + ensure balance rows for both SOL and SEEKER
  const user = await findOrCreateUser(walletAddress);

  // 5. Issue JWT
  const token = signJwt({ userId: user.id, walletAddress: user.walletAddress });

  // 6. Persist session for audit trail (fire-and-forget)
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresIn = process.env.JWT_EXPIRES_IN ?? '30d';
  const expiresMs = parseExpiry(expiresIn);
  void prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + expiresMs),
    },
  }).catch(err => console.error('[auth] session persist failed:', err));

  res.json({ token, user });
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { userId } = (req as AuthRequest).jwtPayload;

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, walletAddress: true, username: true, avatar: true, createdAt: true },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const balances = await getBalances(userId);

  res.json({
    user,
    balance: balances.SOL.toString(),
    balances: {
      SOL: balances.SOL.toString(),
      SEEKER: balances.SEEKER.toString(),
    },
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseExpiry(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30d
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default:  return 30 * 24 * 60 * 60 * 1000;
  }
}

export { router as authRouter };
