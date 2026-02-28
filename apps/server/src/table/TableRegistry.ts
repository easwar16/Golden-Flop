/**
 * TableRegistry – owns the lifecycle of predefined 6-max tables.
 *
 * Responsibilities:
 *  - Create Room instances from DEFAULT_TABLES at startup
 *  - Register them with RoomManager as persistent
 *  - Restore seated players from Redis (chip counts survive a server restart)
 *  - Expose getTable / getAllTables for the socket layer
 *
 * Tables created here are never destroyed by RoomManager, even when empty.
 */

import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@goldenflop/shared';
import { Room } from '../room/Room';
import { RoomManager } from '../room/RoomManager';
import { DEFAULT_TABLES } from './definitions';
import { loadPlayers } from '../redis/TableStore';

type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export class TableRegistry {
  private tables = new Map<string, Room>();
  private io: IO;
  private roomManager: RoomManager;

  constructor(io: IO, roomManager: RoomManager) {
    this.io = io;
    this.roomManager = roomManager;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  /**
   * Create all predefined tables and register them with RoomManager.
   * Call once at server startup, after Redis is initialised.
   */
  async bootstrap(): Promise<void> {
    console.log('[table-registry] bootstrapping predefined tables…');

    for (const def of DEFAULT_TABLES) {
      // Create a persistent room with the hard-coded stable ID
      const room = new Room(
        this.io,
        def.id,
        def.name,
        'system',       // creator = system
        def.config,
        true,           // isPersistent
      );

      // Restore any players that were seated before the server last restarted
      await this.restorePlayersFromRedis(room, def.id);

      this.tables.set(def.id, room);
      this.roomManager.registerPersistentRoom(room);

      console.log(
        `[table-registry] ✓ ${def.name} (${def.id})` +
        (room.playerCount > 0 ? ` — restored ${room.playerCount} player(s)` : ''),
      );
    }

    console.log(`[table-registry] ${this.tables.size} tables ready\n`);

    // Broadcast the initial lobby listing
    this.roomManager.broadcastLobby();
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  getTable(id: string): Room | undefined {
    return this.tables.get(id);
  }

  getAllTables(): Room[] {
    return [...this.tables.values()];
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Load persisted players from Redis and re-seat them.
   * Their socketId is empty — they'll be matched on reconnect.
   */
  private async restorePlayersFromRedis(room: Room, tableId: string): Promise<void> {
    const persisted = await loadPlayers(tableId);

    for (const p of persisted) {
      room.restorePlayer({
        id: p.id,
        socketId: '',         // stale after restart; reconnect updates this
        name: p.name,
        avatarSeed: p.id,    // fallback: player will send true seed on reconnect
        chips: p.chips,
        seatIndex: p.seatIndex,
        isConnected: false,   // treated as disconnected until they reconnect
      });
    }
  }
}
