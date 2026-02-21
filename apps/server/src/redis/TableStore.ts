/**
 * TableStore – Redis persistence for table seat states.
 *
 * What is persisted:
 *   table:{tableId}:players  →  JSON array of PersistedPlayer
 *   table:{tableId}:config   →  JSON TableConfig snapshot
 *
 * What is NOT persisted:
 *   Hand state (ephemeral – hands restart cleanly after a server reboot)
 *   Socket IDs (they're meaningless after a restart)
 *
 * On server restart:
 *   1. TableRegistry creates the table rooms from definitions.ts
 *   2. TableStore.restoreTable() is called for each table
 *   3. Any previously seated players are re-added to the seat map with their
 *      last known chip counts; their socketId is set to '' (disconnected)
 *   4. When the player reconnects, SocketHandler finds their seat by playerId
 *      and updates the socketId as normal.
 */

import { getRedis } from './RedisClient';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PersistedPlayer {
  id: string;
  name: string;
  chips: number;
  seatIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Key helpers
// ─────────────────────────────────────────────────────────────────────────────

const KEY_PLAYERS = (tableId: string) => `table:${tableId}:players`;
const KEY_CONFIG  = (tableId: string) => `table:${tableId}:config`;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist the current player list for a table.
 * Call this after every join, leave, and chip-count change.
 */
export async function savePlayers(
  tableId: string,
  players: PersistedPlayer[],
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(KEY_PLAYERS(tableId), JSON.stringify(players));
  } catch (err) {
    console.warn(`[redis] savePlayers failed for ${tableId}:`, (err as Error).message);
  }
}

/**
 * Load persisted players for a table.
 * Returns an empty array if Redis is unavailable or no data exists.
 */
export async function loadPlayers(tableId: string): Promise<PersistedPlayer[]> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const raw = await redis.get(KEY_PLAYERS(tableId));
    if (!raw) return [];
    return JSON.parse(raw) as PersistedPlayer[];
  } catch (err) {
    console.warn(`[redis] loadPlayers failed for ${tableId}:`, (err as Error).message);
    return [];
  }
}

/** Remove all persisted data for a table (called when a table is destroyed). */
export async function deleteTable(tableId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(KEY_PLAYERS(tableId), KEY_CONFIG(tableId));
  } catch (err) {
    console.warn(`[redis] deleteTable failed for ${tableId}:`, (err as Error).message);
  }
}

/** List all table IDs that have persisted player data. */
export async function listPersistedTableIds(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const keys = await redis.keys('table:*:players');
    return keys.map(k => k.replace(/^table:(.+):players$/, '$1'));
  } catch (err) {
    console.warn('[redis] listPersistedTableIds failed:', (err as Error).message);
    return [];
  }
}
