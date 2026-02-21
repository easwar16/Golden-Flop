/**
 * SocketHandler – pure transport layer.
 *
 * Rules:
 *  - No game logic here.  Validate input shape, then delegate to RoomManager / Room.
 *  - All game state lives in Room / GameEngine.
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

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerSocketHandlers(
  io: IO,
  roomManager: RoomManager,
  tableRegistry: TableRegistry,
): void {
  io.on('connection', (socket: Sock) => {
    console.log(`[socket] connected: ${socket.id}`);

    // ── Middleware: attach player identity from auth ──────────────────────
    const { playerId, playerName } = socket.handshake.auth as {
      playerId?: string;
      playerName?: string;
    };

    if (!playerId || !playerName) {
      socket.emit('error', { code: 'AUTH_REQUIRED', message: 'playerId and playerName are required in handshake.auth' });
      socket.disconnect();
      return;
    }

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

    socket.on('join_table', (payload, ack) => {
      const room = roomManager.getRoom(payload.tableId);
      if (!room) {
        ack?.('Table not found');
        return;
      }

      const err = room.join(socket, playerId, playerName, payload.buyIn);
      if (err) {
        ack?.(err);
        return;
      }

      socket.data.currentTableId = payload.tableId;
      ack?.(null);
      roomManager.broadcastLobby();
      console.log(`[room] ${playerId} joined ${payload.tableId}`);
    });

    // ── Sit at specific seat (predefined tables) ──────────────────────────
    //
    // Identical to join_table but lets the player choose their seat index.
    // Works on both predefined and dynamic tables.

    socket.on('sit_at_seat', (payload, ack) => {
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

      const err = room.join(socket, playerId, playerName, payload.buyIn, payload.seatIndex);
      if (err) {
        ack?.({ error: err });
        return;
      }

      const seatIndex = payload.seatIndex ?? [...room['seats'].keys()].find(
        k => room['seats'].get(k)?.id === playerId
      ) ?? 0;

      socket.data.currentTableId = payload.tableId;
      ack?.({ seatIndex });
      roomManager.broadcastLobby();
      console.log(`[room] ${playerId} sat at seat ${seatIndex} @ ${payload.tableId}`);
    });

    // ── Leave table ───────────────────────────────────────────────────────

    socket.on('leave_table', (payload) => {
      const room = roomManager.getRoom(payload.tableId);
      if (!room) return;

      room.leave(socket.id);
      socket.leave(payload.tableId);
      socket.data.currentTableId = null;
      roomManager.broadcastLobby();
      console.log(`[room] ${playerId} left ${payload.tableId}`);
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
      console.log(`[socket] disconnected: ${socket.id} reason: ${reason}`);
      roomManager.handleDisconnect(socket.id);
    });
  });
}
