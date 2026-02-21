/**
 * RoomManager – registry of all active rooms.
 *
 * Responsibilities:
 *  - Create / retrieve / destroy rooms
 *  - Route socket connections to the correct room
 *  - Maintain the lobby listing
 */

import { v4 as uuid } from 'uuid';
import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  CreateTablePayload,
  TableConfig,
} from '@goldenflop/shared';
import { Room } from './Room';

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

import { NATIVE_SOL_MINT } from '../table/constants';

const DEFAULT_CONFIG: Omit<TableConfig, 'smallBlind' | 'bigBlind' | 'minBuyIn' | 'maxBuyIn'> = {
  maxPlayers: 6,
  turnTimeoutMs: 30_000,
  tokenMint: NATIVE_SOL_MINT,
  isPremium: false,
};

export class RoomManager {
  private rooms = new Map<string, Room>();
  private io: IO;

  constructor(io: IO) {
    this.io = io;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  createRoom(payload: CreateTablePayload, creatorId: string): Room {
    const id = uuid();
    const config: TableConfig = {
      smallBlind: payload.smallBlind,
      bigBlind: payload.bigBlind,
      minBuyIn: payload.minBuyIn,
      maxBuyIn: payload.maxBuyIn,
      maxPlayers: payload.maxPlayers ?? DEFAULT_CONFIG.maxPlayers,
      turnTimeoutMs: DEFAULT_CONFIG.turnTimeoutMs,
      tokenMint: DEFAULT_CONFIG.tokenMint,
      isPremium: DEFAULT_CONFIG.isPremium,
    };
    const room = new Room(this.io, id, payload.name, creatorId, config, /* isPersistent */ false);
    this.rooms.set(id, room);
    this.broadcastLobby();
    return room;
  }

  /**
   * Register a pre-constructed persistent room (created by TableRegistry).
   * These rooms are never deleted by RoomManager.
   */
  registerPersistentRoom(room: Room): void {
    this.rooms.set(room.id, room);
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Only deletes non-persistent rooms. */
  deleteRoom(id: string): void {
    const room = this.rooms.get(id);
    if (!room || room.isPersistent) return;
    this.rooms.delete(id);
    this.broadcastLobby();
  }

  getLobby() {
    return [...this.rooms.values()].map(r => r.toTableInfo());
  }

  // ─── Socket routing ───────────────────────────────────────────────────────

  /** Find which room (if any) this socket is in. */
  getRoomForSocket(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room['socketToSeat'].has(socketId)) return room;
    }
    return undefined;
  }

  handleDisconnect(socketId: string): void {
    const room = this.getRoomForSocket(socketId);
    if (!room) return;

    // Mark player as disconnected but keep their seat for reconnection window
    for (const [, player] of room['seats']) {
      if (player.socketId === socketId) {
        player.isConnected = false;
        break;
      }
    }

    room.broadcastState();

    // Grace period: if player doesn't reconnect within 60s, remove them
    setTimeout(() => {
      const roomStillExists = this.rooms.get(room.id);
      if (!roomStillExists) return;
      for (const [, player] of room['seats']) {
        if (player.socketId === socketId && !player.isConnected) {
          room.leave(socketId);
          break;
        }
      }
      // Only destroy non-persistent (dynamic) rooms when they become empty
      if (room.playerCount === 0 && !room.isPersistent) {
        this.deleteRoom(room.id);
      }
    }, 60_000);
  }

  // ─── Lobby broadcast ──────────────────────────────────────────────────────

  broadcastLobby(): void {
    this.io.emit('tables_list', this.getLobby());
  }
}
