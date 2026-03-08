/**
 * TableRegistry – owns the lifecycle of predefined 6-max tables.
 *
 * Responsibilities:
 *  - Load active Room configs from the database at startup
 *  - Create Room instances and register them with RoomManager as persistent
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
  TableConfig,
} from '@goldenflop/shared';
import { Room } from '../room/Room';
import { RoomManager } from '../room/RoomManager';
import { prisma } from '../db/prisma';
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
   * Load all active tables from the database and register them with RoomManager.
   * Call once at server startup, after Redis and DB are initialised.
   */
  async bootstrap(): Promise<void> {
    console.log('[table-registry] bootstrapping tables from database…');

    const dbRooms = await prisma.room.findMany({ where: { isActive: true } });

    for (const row of dbRooms) {
      const config: TableConfig = {
        smallBlind:    Number(row.smallBlind),
        bigBlind:      Number(row.bigBlind),
        minBuyIn:      Number(row.minBuyIn),
        maxBuyIn:      Number(row.maxBuyIn),
        maxPlayers:    row.maxPlayers,
        turnTimeoutMs: row.turnTimeoutMs,
        tokenMint:     row.tokenMint,
        isPremium:     row.isPremium,
        isPractice:    row.isPractice,
      };

      const room = new Room(
        this.io,
        row.id,
        row.name,
        'system',       // creator = system
        config,
        true,           // isPersistent
      );

      // Restore any players that were seated before the server last restarted
      await this.restorePlayersFromRedis(room, row.id);

      this.tables.set(row.id, room);
      this.roomManager.registerPersistentRoom(room);

      console.log(
        `[table-registry] ✓ ${row.name} (${row.id})` +
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
        presenceState: 'disconnected',
        sitOutTimer: null,
        sitOutTimeoutAt: null,
      });
    }
  }
}
