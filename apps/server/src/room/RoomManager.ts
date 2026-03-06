/**
 * RoomManager – registry of all active rooms.
 *
 * Responsibilities:
 *  - Create / retrieve / destroy rooms
 *  - Route socket connections to the correct room
 *  - Maintain the lobby listing (throttled, selective)
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

/** Derive turn timeout from big blind when not explicitly set. Matches seed tiers. */
function deriveTurnTimeout(bigBlind: number): number {
  if (bigBlind >= 20_000_000) return 15_000;   // high stakes (≥ 0.02 SOL BB) → fast
  if (bigBlind >= 2_000_000) return 30_000;     // mid stakes (≥ 0.002 SOL BB) → normal
  return 45_000;                                 // low stakes → slow
}

/**
 * Socket.io room name for sockets actively viewing the lobby.
 * Only these sockets receive periodic `tables_list` updates.
 */
export const LOBBY_ROOM = '__lobby__';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private io: IO;

  // ── Throttled lobby broadcast ───────────────────────────────────────────
  private lobbyDirty = false;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly LOBBY_INTERVAL_MS = 500; // batch every 500ms — snappy but still deduplicates bursts

  constructor(io: IO) {
    this.io = io;
    this.startLobbyTicker();
  }

  /** Periodically flush lobby updates only to sockets in the lobby room. */
  private startLobbyTicker(): void {
    this.lobbyTimer = setInterval(() => {
      if (!this.lobbyDirty) return;
      this.lobbyDirty = false;
      this.io.to(LOBBY_ROOM).emit('tables_list', this.getLobby());
    }, RoomManager.LOBBY_INTERVAL_MS);
  }

  /** Clean up the interval (for graceful shutdown / tests). */
  dispose(): void {
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
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
      turnTimeoutMs: payload.turnTimeoutMs ?? deriveTurnTimeout(payload.bigBlind),
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

  getAllRooms(): Room[] {
    return [...this.rooms.values()];
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

    // Mark as disconnected (NOT remove) — player gets 60s to reconnect
    room.markDisconnected(socketId);

    this.broadcastLobby();
  }

  // ─── Lobby broadcast (throttled + selective) ───────────────────────────────

  /**
   * Mark the lobby as dirty. The next tick of the lobby timer will flush
   * the update to all sockets in the LOBBY_ROOM.
   *
   * This replaces the old `io.emit('tables_list', ...)` which sent to
   * every connected socket on every action.
   */
  broadcastLobby(): void {
    this.lobbyDirty = true;
  }

  /** Send lobby immediately to a single socket (e.g. on first request). */
  sendLobbyTo(socketId: string): void {
    const socket = this.io.sockets.sockets.get(socketId);
    socket?.emit('tables_list', this.getLobby());
  }
}
