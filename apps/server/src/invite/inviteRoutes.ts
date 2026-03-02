/**
 * Invite REST endpoints.
 *
 * POST /api/invite/generate   — requireAuth + authLimiter, creates invite
 * GET  /api/invite/validate/:token — public, validates token + returns room info
 */

import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../auth/jwtMiddleware';
import { authLimiter } from '../middleware/rateLimiter';
import { createInvite, validateInvite } from './inviteService';
import type { RoomManager } from '../room/RoomManager';

export function createInviteRouter(roomManager: RoomManager): Router {
  const router = Router();

  // ── Generate invite (authenticated, rate-limited) ──────────────────────
  router.post('/generate', authLimiter, requireAuth, async (req, res) => {
    try {
      const { roomId } = req.body as { roomId?: string };
      if (!roomId) {
        res.status(400).json({ error: 'roomId is required' });
        return;
      }

      // Verify the room exists
      const room = roomManager.getRoom(roomId);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      const { userId } = (req as AuthRequest).jwtPayload;
      const result = await createInvite(roomId, userId);

      res.json({
        token: result.token,
        deepLink: result.deepLink,
        httpsLink: result.httpsLink,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (err) {
      console.error('[invite] generate error:', err);
      res.status(500).json({ error: 'Failed to generate invite' });
    }
  });

  // ── Validate invite (public) ──────────────────────────────────────────
  router.get('/validate/:token', async (req, res) => {
    try {
      const { token } = req.params;
      if (!token) {
        res.status(400).json({ valid: false, error: 'Token is required' });
        return;
      }

      const invite = await validateInvite(token);
      if (!invite) {
        res.json({ valid: false, error: 'Invite is invalid or expired' });
        return;
      }

      // Get live room state for seat availability
      const room = roomManager.getRoom(invite.roomId);
      const tableInfo = room?.toTableInfo();

      res.json({
        valid: true,
        roomId: invite.room.id,
        roomName: invite.room.name,
        inviterName: invite.inviter.username ?? invite.inviter.walletAddress.slice(0, 8) + '...',
        blinds: {
          small: Number(invite.room.smallBlind),
          big: Number(invite.room.bigBlind),
        },
        seats: tableInfo
          ? {
              total: tableInfo.maxPlayers,
              occupied: tableInfo.occupiedSeats.length,
              available: tableInfo.maxPlayers - tableInfo.occupiedSeats.length - tableInfo.reservedSeats.length,
            }
          : undefined,
      });
    } catch (err) {
      console.error('[invite] validate error:', err);
      res.status(500).json({ valid: false, error: 'Failed to validate invite' });
    }
  });

  return router;
}
