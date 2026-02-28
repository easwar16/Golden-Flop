/**
 * SocketHandler – pure transport layer.
 *
 * Rules:
 *  - No game logic here.  Validate input shape, then delegate to RoomManager / Room.
 *  - All game state lives in Room / GameEngine.
 *
 * Auth:
 *  - playerId + playerName are always required (game identity layer).
 *  - token (JWT) is optional.  When present, userId is extracted and
 *    internal balance checks are applied before joining real-money tables.
 *  - Without a JWT the player can still spectate and play practice games.
 */

import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@goldenflop/shared';
import { RoomManager } from '../room/RoomManager';
import { TableRegistry } from '../table/TableRegistry';
import { extractSocketUser } from '../auth/jwtMiddleware';
import { processBuyIn, processCashOut } from '../balance/BalanceService';
import { verifySOLDepositToVault } from '../solana/SolanaService';
import { processPlayerCashOut } from '../solana/PayoutService';
import { prisma } from '../db/prisma';
import { findOrCreateUser } from '../services/user.service';

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// Prevent concurrent join attempts for the same player
const joinInFlight = new Set<string>();

export function registerSocketHandlers(
  io: IO,
  roomManager: RoomManager,
  tableRegistry: TableRegistry,
): void {
  io.on('connection', (socket: Sock) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── Middleware: attach player identity from auth ──────────────────────
    const { playerId, playerName, avatarSeed: rawAvatarSeed, token } = socket.handshake.auth as {
      playerId?: string;
      playerName?: string;
      avatarSeed?: string;
      token?: string;         // JWT from mobile SecureStore — optional
    };
    const avatarSeed = rawAvatarSeed ?? playerId ?? 'default';

    if (!playerId || !playerName) {
      socket.emit('error', { code: 'AUTH_REQUIRED', message: 'playerId and playerName are required in handshake.auth' });
      socket.disconnect();
      return;
    }

    // Extract DB userId from JWT if provided (nil = practice/guest mode)
    const jwtUser = extractSocketUser(token);
    const userId  = jwtUser?.userId ?? null; // null = guest, no balance checks

    socket.data.playerId = playerId;
    socket.data.playerName = playerName;
    socket.data.currentTableId = null;

    // ── Reconnection: rejoin any room the player was in ───────────────────
    const existingRoom = [...roomManager['rooms'].values()].find(r =>
      [...r['seats'].values()].some(p => p.id === playerId)
    );
    if (existingRoom) {
      existingRoom.reconnect(socket, playerId);
      socket.data.currentTableId = existingRoom.id;
    }

    // ── Lobby ─────────────────────────────────────────────────────────────
    // Both events return the same tables_list payload.
    // request_tables  – legacy name (kept for backwards compatibility)
    // get_tables      – preferred alias, same response
    //
    // tableRegistry is available here for future premium-gating checks,
    // per-table metadata enrichment, or seat-map queries.

    socket.on('request_tables', () => {
      socket.emit('tables_list', roomManager.getLobby());
    });

    socket.on('get_tables', () => {
      socket.emit('tables_list', roomManager.getLobby());
    });

    // ── Create table ──────────────────────────────────────────────────────

    socket.on('create_table', (payload, ack) => {
      if (!payload.name?.trim()) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Table name is required' });
        ack?.('');
        return;
      }
      if (payload.smallBlind <= 0 || payload.bigBlind <= payload.smallBlind) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid blind structure' });
        ack?.('');
        return;
      }

      const room = roomManager.createRoom(payload, playerId);
      console.log(`[room] created ${room.id} by ${playerId}`);
      ack?.(room.id);
      roomManager.broadcastLobby();
    });

    // ── Join table ────────────────────────────────────────────────────────

    socket.on('join_table', async (payload, ack) => {
      // ── Double-join guard ─────────────────────────────────────────────
      const joinKey = `${playerId}:${payload.tableId}`;
      if (joinInFlight.has(joinKey)) {
        ack?.('Join already in progress');
        return;
      }
      joinInFlight.add(joinKey);

      try {
        const room = roomManager.getRoom(payload.tableId);
        if (!room) {
          ack?.('Table not found');
          return;
        }

        // ── Balance check for authenticated users ──────────────────────────
        // Guests (no JWT) bypass the check — they use in-memory chips only.
        if (userId) {
          const buyInResult = await processBuyIn(userId, payload.tableId, BigInt(payload.buyIn));
          if (!buyInResult.success) {
            ack?.(buyInResult.error ?? 'Insufficient balance');
            return;
          }
        }

        const err = room.join(socket, playerId, playerName, avatarSeed, payload.buyIn, undefined, { userId });
        if (err) {
          // Refund the deducted balance if join itself fails
          if (userId) await processCashOut(userId, BigInt(payload.buyIn));
          ack?.(err);
          return;
        }

        socket.data.currentTableId = payload.tableId;
        ack?.(null);
        roomManager.broadcastLobby();
        console.log(`[room] ${playerId} (userId:${userId ?? 'guest'}) joined ${payload.tableId}`);
      } finally {
        joinInFlight.delete(joinKey);
      }
    });

    // ── Reserve seat (pre-wallet-tx lock) ──────────────────────────────────

    socket.on('reserve_seat', (payload, ack) => {
      const room = roomManager.getRoom(payload.tableId);
      if (!room) {
        ack?.({ error: 'Table not found' });
        return;
      }
      const err = room.reserveSeat(playerId, playerName, avatarSeed, payload.seatIndex);
      if (err) {
        ack?.({ error: err });
      } else {
        ack?.({ ok: true });
        roomManager.broadcastLobby();
      }
    });

    // ── Release seat reservation ───────────────────────────────────────────

    socket.on('release_seat', (payload) => {
      const room = roomManager.getRoom(payload.tableId);
      if (!room) return;
      room.releaseReservation(payload.seatIndex, playerId);
      roomManager.broadcastLobby();
    });

    // ── Sit at specific seat (predefined tables) ──────────────────────────
    //
    // Identical to join_table but lets the player choose their seat index.
    // Works on both predefined and dynamic tables.

    socket.on('sit_at_seat', async (payload, ack) => {
      // ── Double-join guard ─────────────────────────────────────────────
      const joinKey = `${playerId}:${payload.tableId}`;
      if (joinInFlight.has(joinKey)) {
        ack?.({ error: 'Join already in progress' });
        return;
      }
      joinInFlight.add(joinKey);

      try {
        const room = roomManager.getRoom(payload.tableId);
        if (!room) {
          ack?.({ error: 'Table not found' });
          return;
        }

        // Validate buy-in range
        if (payload.buyIn < room.config.minBuyIn) {
          ack?.({ error: `Minimum buy-in is ${room.config.minBuyIn} lamports` });
          return;
        }
        if (payload.buyIn > room.config.maxBuyIn) {
          ack?.({ error: `Maximum buy-in is ${room.config.maxBuyIn} lamports` });
          return;
        }

        const txSignature = (payload as any).txSignature as string | undefined;
        const payloadWallet = (payload as any).walletAddress as string | undefined;
        let isVaultPlayer = false;
        let walletAddress: string | null = null;
        let vaultUserId: string | null = null;

        if (txSignature && payloadWallet) {
          // ── Vault flow: verify on-chain deposit to room vault ─────────
          const dbRoom = await prisma.room.findUnique({
            where: { id: payload.tableId },
            select: { vaultAddress: true },
          });

          if (!dbRoom?.vaultAddress) {
            ack?.({ error: 'Room does not support vault deposits' });
            return;
          }

          walletAddress = payloadWallet;

          // Resolve user by wallet address (create if first time)
          const vaultUser = await findOrCreateUser(walletAddress);
          vaultUserId = vaultUser.id;

          // Idempotency: check if this tx was already used
          const existingDeposit = await prisma.deposit.findUnique({
            where: { transactionSignature: txSignature },
          });
          if (existingDeposit) {
            if (existingDeposit.userId !== vaultUserId) {
              ack?.({ error: 'Transaction already claimed by another user' });
              return;
            }
            // Already processed — allow re-seating with this deposit
          } else {
            // Verify on-chain
            const verification = await verifySOLDepositToVault(
              txSignature,
              BigInt(payload.buyIn),
              walletAddress,
              dbRoom.vaultAddress,
            );

            if (!verification.success) {
              ack?.({ error: verification.error ?? 'On-chain verification failed' });
              return;
            }

            // Record deposit
            await prisma.deposit.create({
              data: {
                userId: vaultUserId,
                tokenType: 'SOL',
                amount: verification.confirmedAmount!,
                transactionSignature: txSignature,
                status: 'CONFIRMED',
              },
            });
          }

          isVaultPlayer = true;
        } else if (userId) {
          // ── Internal balance flow (existing) ──────────────────────────
          const buyInResult = await processBuyIn(userId, payload.tableId, BigInt(payload.buyIn));
          if (!buyInResult.success) {
            ack?.({ error: buyInResult.error ?? 'Insufficient balance' });
            return;
          }
        }
        // else: guest mode — no balance checks

        // For vault players, use the DB userId resolved from wallet address
        // (not the JWT userId which may be null for mobile wallet-only users)
        const effectiveUserId = isVaultPlayer ? vaultUserId : userId;

        const err = room.join(
          socket,
          playerId,
          payload.playerName ?? playerName,
          payload.avatarSeed ?? avatarSeed,
          payload.buyIn,
          payload.seatIndex,
          { userId: effectiveUserId, walletAddress, isVaultPlayer },
        );
        if (err) {
          // Refund internal balance if join fails (vault deposits are already on-chain)
          if (userId && !isVaultPlayer) await processCashOut(userId, BigInt(payload.buyIn));
          ack?.({ error: err });
          return;
        }

        const seatIndex = payload.seatIndex ?? [...room['seats'].keys()].find(
          k => room['seats'].get(k)?.id === playerId
        ) ?? 0;

        socket.data.currentTableId = payload.tableId;
        ack?.({ seatIndex });
        roomManager.broadcastLobby();
        console.log(`[room] ${playerId} (userId:${userId ?? 'guest'}, vault:${isVaultPlayer}) sat at seat ${seatIndex} @ ${payload.tableId}`);
      } finally {
        joinInFlight.delete(joinKey);
      }
    });

    // ── Leave table ───────────────────────────────────────────────────────

    socket.on('leave_table', async (payload) => {
      const room = roomManager.getRoom(payload.tableId);
      if (!room) return;

      // Capture seat data BEFORE removing the player from the room
      const seat = room.getPlayerById(playerId);
      const cashOutAmount = seat?.chips ?? 0;
      const seatWallet = seat?.walletAddress ?? null;
      const seatUserId = seat?.userId ?? null;
      const seatIsVault = seat?.isVaultPlayer ?? false;

      // Remove player from the room immediately — don't block on payout
      room.leave(socket.id);
      socket.leave(payload.tableId);
      socket.data.currentTableId = null;
      roomManager.broadcastLobby();
      console.log(`[room] ${playerId} left ${payload.tableId}`);

      // Process payout after the player has been removed
      if (cashOutAmount > 0) {
        if (seatIsVault && seatWallet && seatUserId) {
          // ── Vault flow: transfer from vault to player's wallet on-chain ──
          try {
            const sig = await processPlayerCashOut(
              payload.tableId,
              seatUserId,
              seatWallet,
              BigInt(cashOutAmount),
            );
            socket.emit('cash_out_complete', {
              tableId: payload.tableId,
              amount: cashOutAmount,
              txSignature: sig,
            });
            if (sig) {
              console.log(`[economy] vault cash-out: ${cashOutAmount} lamports → ${seatWallet} (tx: ${sig})`);
            } else {
              console.error(`[economy] vault cash-out FAILED for ${seatWallet}, ${cashOutAmount} lamports`);
            }
          } catch (err) {
            console.error(`[economy] vault cash-out error:`, err);
            socket.emit('cash_out_complete', {
              tableId: payload.tableId,
              amount: cashOutAmount,
              txSignature: null,
            });
          }
        } else if (userId) {
          // ── Internal balance flow (existing) ──
          await processCashOut(userId, BigInt(cashOutAmount));
          console.log(`[economy] cashed out ${cashOutAmount} chips → userId:${userId}`);
        }
      }
    });

    // ── Watch table (spectator — gets public table_state, no hole cards) ──

    socket.on('watch_table', (payload: { tableId: string }) => {
      const room = roomManager.getRoom(payload.tableId);
      if (!room) { console.log(`[watch_table] room not found: ${payload.tableId}`); return; }
      socket.join(payload.tableId);
      socket.data.currentTableId = payload.tableId;
      console.log(`[watch_table] ${socket.id} joined room ${payload.tableId}`);
      // If this socket is a seated player, send personalized state (with mySeatIndex)
      const seatedPlayer = room.getPlayerBySocketId(socket.id);
      socket.emit('table_state', room.buildStateFor(seatedPlayer?.id ?? null));
    });

    // ── Player action ─────────────────────────────────────────────────────

    socket.on('player_action', (payload) => {
      const room = roomManager.getRoom(payload.tableId);
      if (!room) {
        socket.emit('error', { code: 'ROOM_NOT_FOUND', message: 'Table not found' });
        return;
      }
      room.handleAction(socket.id, payload.action, payload.amount);
    });

    // ── Latency ping (client measures round-trip) ─────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).on('ping', (cb: () => void) => {
      if (typeof cb === 'function') cb();
    });

    // ── Disconnect ────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${socket.id} (player: ${playerId}) reason: ${reason}`);
      // Don't release seat reservations on disconnect — the player may have
      // switched to their wallet app (backgrounding the socket). Let the
      // server-side timeout handle expiry instead.
      roomManager.handleDisconnect(socket.id);
    });
  });
}
