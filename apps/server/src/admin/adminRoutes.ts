import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  isVaultConfigured,
  getVaultBalance,
  transferSOLFromVault,
} from '../solana/VaultService';
import { LAMPORTS_PER_SOL } from '../table/constants';
import { listRooms } from '../services/room.service';

const SWEEP_DESTINATION = '26UGHSCAbjHo4vb3YbmxVoqCiECrYo3nzQvZktLF2yHg';

/** Minimum lamports to keep in each vault to cover tx fees. */
const TX_FEE_BUFFER = 10_000; // 0.00001 SOL

export const adminRouter = Router();

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
