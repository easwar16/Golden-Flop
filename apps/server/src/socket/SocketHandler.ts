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

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerSocketHandlers(io: IO, roomManager: RoomManager): void {
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

    socket.on('request_tables', () => {
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

    // ── Disconnect ────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${socket.id} reason: ${reason}`);
      roomManager.handleDisconnect(socket.id);
    });
  });
}
