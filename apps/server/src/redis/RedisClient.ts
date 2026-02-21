/**
 * RedisClient – optional connection wrapper.
 *
 * If REDIS_URL is not set the module exports a null client and all TableStore
 * methods become no-ops.  The rest of the server never needs to null-check Redis
 * because TableStore handles it internally.
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379  npm run dev
 */

import Redis from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  return _redis;
}

export function isRedisEnabled(): boolean {
  return _redis !== null;
}

/**
 * Call once at server startup.
 * Returns true if connection was established, false if Redis is not configured.
 */
export async function initRedis(): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('[redis] REDIS_URL not set – running without persistence');
    return false;
  }

  try {
    _redis = new Redis(url, {
      // Don't crash the process on Redis unavailability
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    await _redis.connect();
    await _redis.ping();   // confirms the connection is alive

    console.log(`[redis] connected to ${url}`);
    return true;
  } catch (err) {
    console.warn('[redis] connection failed – running without persistence:', (err as Error).message);
    _redis = null;
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
