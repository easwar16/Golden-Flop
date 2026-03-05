import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  isVaultConfigured,
  getVaultBalance,
  transferSOLFromVault,
} from '../solana/VaultService';
import { LAMPORTS_PER_SOL } from '../table/constants';
import { listRooms } from '../services/room.service';
import { processPlayerCashOut } from '../solana/PayoutService';
import type { RoomManager } from '../room/RoomManager';

const SWEEP_DESTINATION = '26UGHSCAbjHo4vb3YbmxVoqCiECrYo3nzQvZktLF2yHg';

/** Minimum lamports to keep in each vault to cover tx fees. */
const TX_FEE_BUFFER = 10_000; // 0.00001 SOL

export const adminRouter = Router();

// ── RoomManager reference (set by app.ts after creation) ─────────────────────
let _roomManager: RoomManager | null = null;

export function setAdminRoomManager(rm: RoomManager): void {
  _roomManager = rm;
}

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'ADMIN_SECRET not configured' });
    return;
  }
  if (req.headers['x-admin-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

adminRouter.use(requireAdminSecret);

// ── GET /vault/balances ─────────────────────────────────────────────────────

adminRouter.get('/vault/balances', async (_req: Request, res: Response) => {
  if (!isVaultConfigured()) {
    res.status(503).json({ error: 'No vault keys configured' });
    return;
  }

  const rooms = await listRooms();

  const results: Array<{
    roomId: string;
    name: string;
    lamports: string;
    sol: number;
  }> = [];

  for (const room of rooms) {
    if (room.isPractice) continue;
    try {
      const balance = await getVaultBalance(room.id);
      results.push({
        roomId: room.id,
        name: room.name,
        lamports: balance.toString(),
        sol: Number(balance) / LAMPORTS_PER_SOL,
      });
    } catch (err) {
      results.push({
        roomId: room.id,
        name: room.name,
        lamports: '0',
        sol: 0,
      });
    }
  }

  const totalLamports = results.reduce((sum, r) => sum + BigInt(r.lamports), 0n);

  res.json({
    vaults: results,
    totalLamports: totalLamports.toString(),
    totalSol: Number(totalLamports) / LAMPORTS_PER_SOL,
  });
});

// ── POST /vault/sweep ───────────────────────────────────────────────────────

adminRouter.post('/vault/sweep', async (_req: Request, res: Response) => {
  if (!isVaultConfigured()) {
    res.status(503).json({ error: 'No vault keys configured' });
    return;
  }

  const rooms = await listRooms();

  const sweepResults: Array<{
    roomId: string;
    name: string;
    lamports: string;
    signature?: string;
    error?: string;
    skipped?: boolean;
  }> = [];

  for (const room of rooms) {
    if (room.isPractice) continue;
    try {
      const balance = await getVaultBalance(room.id);
      const sweepable = balance - BigInt(TX_FEE_BUFFER);

      if (sweepable <= 0n) {
        sweepResults.push({
          roomId: room.id,
          name: room.name,
          lamports: balance.toString(),
          skipped: true,
        });
        continue;
      }

      const signature = await transferSOLFromVault(
        room.id,
        SWEEP_DESTINATION,
        sweepable,
      );

      sweepResults.push({
        roomId: room.id,
        name: room.name,
        lamports: sweepable.toString(),
        signature,
      });
    } catch (err) {
      sweepResults.push({
        roomId: room.id,
        name: room.name,
        lamports: '0',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({
    destination: SWEEP_DESTINATION,
    results: sweepResults,
  });
});

// ── POST /purge-disconnected ─────────────────────────────────────────────────
// Force-remove all disconnected/ghost players from all rooms immediately.

adminRouter.post('/purge-disconnected', (_req: Request, res: Response) => {
  if (!_roomManager) {
    res.status(503).json({ error: 'RoomManager not initialized' });
    return;
  }

  const rooms = _roomManager.getAllRooms();
  let totalPurged = 0;
  const results: Array<{ roomId: string; name: string; purged: number }> = [];

  for (const room of rooms) {
    const purged = room.purgeDisconnectedPlayers();
    if (purged > 0) {
      results.push({ roomId: room.id, name: room.name, purged });
      totalPurged += purged;
    }
  }

  _roomManager.broadcastLobby();

  res.json({ totalPurged, rooms: results });
});

// ── POST /vault/refund ──────────────────────────────────────────────────────
// Emergency refund: return each seated vault player's chips back to their wallet.
// This reads live in-memory game state and processes individual cash-outs.

adminRouter.post('/vault/refund', async (_req: Request, res: Response) => {
  if (!_roomManager) {
    res.status(503).json({ error: 'RoomManager not initialized' });
    return;
  }
  if (!isVaultConfigured()) {
    res.status(503).json({ error: 'No vault keys configured' });
    return;
  }

  const rooms = _roomManager.getAllRooms();

  const refundResults: Array<{
    roomId: string;
    roomName: string;
    player: string;
    wallet: string;
    chips: number;
    lamports: string;
    tokenType: string;
    signature?: string | null;
    error?: string;
  }> = [];

  for (const room of rooms) {
    const info = room.toTableInfo();
    if (info.isPractice) continue;

    const tokenType = info.tokenType as 'SOL' | 'SEEKER';
    const vaultPlayers = room.getVaultPlayers();

    for (const player of vaultPlayers) {
      // chips are stored in the token's smallest unit (lamports for SOL, raw units for SEEKER)
      const amount = BigInt(Math.floor(player.chips));
      if (amount <= 0n) continue;

      try {
        const signature = await processPlayerCashOut(
          room.id,
          player.userId,
          player.walletAddress,
          amount,
          tokenType,
        );

        refundResults.push({
          roomId: room.id,
          roomName: info.name,
          player: player.userId,
          wallet: player.walletAddress,
          chips: player.chips,
          lamports: amount.toString(),
          tokenType,
          signature,
        });
      } catch (err) {
        refundResults.push({
          roomId: room.id,
          roomName: info.name,
          player: player.userId,
          wallet: player.walletAddress,
          chips: player.chips,
          lamports: amount.toString(),
          tokenType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const succeeded = refundResults.filter(r => r.signature && !r.error).length;
  const failed = refundResults.filter(r => r.error).length;

  res.json({
    summary: { total: refundResults.length, succeeded, failed },
    results: refundResults,
  });
});
