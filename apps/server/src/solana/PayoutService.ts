/**
 * PayoutService – orchestrates on-chain payouts from room vaults.
 *
 * Handles:
 *  - Player cash-outs (vault → player wallet)
 *  - Rake transfers (vault → treasury)
 *  - Retry logic with exponential backoff
 *  - Payout record management in PostgreSQL
 *
 * All payouts are recorded in the `Payout` table for auditability
 * and crash recovery. A mutex per room serializes vault transactions
 * (one keypair = one signer = sequential signing).
 */

import { prisma } from '../db/prisma';
import { transferSOLFromVault, getVaultBalance } from './VaultService';

// ─── Per-room mutex ──────────────────────────────────────────────────────────
// Vault has one keypair per room. Serialize signing to avoid nonce conflicts.

const roomLocks = new Map<string, Promise<void>>();

async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const prev = roomLocks.get(roomId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>(r => { resolve = r; });
  roomLocks.set(roomId, next);

  try {
    await prev;
    return await fn();
  } finally {
    resolve!();
  }
}

// ─── Retry helper ────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[PayoutService] retry ${attempt + 1}/${retries} after ${delay}ms:`, err);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

// ─── Treasury address ────────────────────────────────────────────────────────

function getTreasuryAddress(): string {
  const addr = process.env.TREASURY_WALLET;
  if (!addr) throw new Error('TREASURY_WALLET env var is not set');
  return addr;
}

// ─── Core payout operations ──────────────────────────────────────────────────

/**
 * Process a player's cash-out: transfer SOL from vault to player's wallet.
 *
 * Creates a Payout record, sends the on-chain transfer, and updates status.
 * Uses room-level mutex to prevent concurrent signing.
 *
 * @param roomId        Room whose vault sends the funds
 * @param userId        Database user ID (for Payout record FK)
 * @param playerWallet  Base58 destination wallet address
 * @param lamports      Amount to transfer
 * @returns Transaction signature, or null if transfer failed
 */
export async function processPlayerCashOut(
  roomId: string,
  userId: string,
  playerWallet: string,
  lamports: bigint,
): Promise<string | null> {
  if (lamports <= 0n) return null;

  return withRoomLock(roomId, async () => {
    // Idempotency: check for existing pending/sent payout for this cash-out
    const existing = await prisma.payout.findFirst({
      where: {
        roomId,
        userId,
        type: 'CASH_OUT',
        status: { in: ['PENDING', 'SENT'] },
      },
    });
    if (existing) {
      console.warn(`[PayoutService] existing cash-out payout ${existing.id} for user ${userId} in room ${roomId}`);
      return existing.transactionSignature;
    }

    // Create PENDING payout record
    const payout = await prisma.payout.create({
      data: {
        roomId,
        userId,
        type: 'CASH_OUT',
        amount: lamports,
        status: 'PENDING',
      },
    });

    try {
      // Check vault balance
      const vaultBalance = await getVaultBalance(roomId);
      if (vaultBalance < lamports) {
        console.error(
          `[PayoutService] Insufficient vault balance for room ${roomId}. ` +
          `Need ${lamports}, have ${vaultBalance}. Payout ${payout.id} marked FAILED.`,
        );
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'FAILED' },
        });
        return null;
      }

      // Send on-chain transfer with retry
      const signature = await withRetry(() =>
        transferSOLFromVault(roomId, playerWallet, lamports),
      );

      // Update payout record
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'CONFIRMED',
          transactionSignature: signature,
        },
      });

      console.log(
        `[PayoutService] cash-out: ${lamports} lamports → ${playerWallet} (tx: ${signature})`,
      );
      return signature;
    } catch (err) {
      console.error(`[PayoutService] cash-out failed for payout ${payout.id}:`, err);
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'FAILED' },
      });
      return null;
    }
  });
}

/**
 * Transfer accumulated rake from vault to treasury wallet.
 *
 * @param roomId     Room whose vault sends the rake
 * @param lamports   Rake amount in lamports
 * @param rakeUserId User ID to associate with the rake record (typically the winner or a system user)
 * @returns Transaction signature, or null if transfer failed
 */
export async function processRakeTransfer(
  roomId: string,
  lamports: bigint,
  rakeUserId: string,
): Promise<string | null> {
  if (lamports <= 0n) return null;

  return withRoomLock(roomId, async () => {
    const payout = await prisma.payout.create({
      data: {
        roomId,
        userId: rakeUserId,
        type: 'RAKE',
        amount: lamports,
        status: 'PENDING',
      },
    });

    try {
      const treasury = getTreasuryAddress();
      const signature = await withRetry(() =>
        transferSOLFromVault(roomId, treasury, lamports),
      );

      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'CONFIRMED',
          transactionSignature: signature,
        },
      });

      console.log(
        `[PayoutService] rake: ${lamports} lamports → treasury (tx: ${signature})`,
      );
      return signature;
    } catch (err) {
      console.error(`[PayoutService] rake transfer failed for payout ${payout.id}:`, err);
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'FAILED' },
      });
      return null;
    }
  });
}

/**
 * Retry stale payouts on server startup.
 * Finds PENDING/SENT payouts and logs them for manual resolution.
 * Full auto-retry is deferred to a future background job.
 */
export async function retryStalePayouts(): Promise<void> {
  const stale = await prisma.payout.findMany({
    where: { status: { in: ['PENDING', 'SENT'] } },
    orderBy: { createdAt: 'asc' },
  });

  if (stale.length > 0) {
    console.warn(
      `[PayoutService] Found ${stale.length} stale payout(s) on startup:`,
      stale.map((p: { id: string; roomId: string; type: string; amount: bigint }) => ({
        id: p.id, roomId: p.roomId, type: p.type, amount: p.amount.toString(),
      })),
    );
  }
}
