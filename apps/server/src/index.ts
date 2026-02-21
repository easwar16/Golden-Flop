import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@goldenflop/shared';

import { RoomManager } from './room/RoomManager';
import { TableRegistry } from './table/TableRegistry';
import { registerSocketHandlers } from './socket/SocketHandler';
import { initRedis, closeRedis } from './redis/RedisClient';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';

// ─────────────────────────────────────────────────────────────────────────────
// Express
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io
// ─────────────────────────────────────────────────────────────────────────────

const httpServer = createServer(app);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  // Recommended for React Native: disable HTTP long-polling
  transports: ['websocket'],
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot sequence  (async so Redis init can complete before tables are created)
// ─────────────────────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  // 1. Optional Redis — gracefully falls back to in-memory if not configured
  await initRedis();

  // 2. Room manager — handles all live table sessions
  const roomManager = new RoomManager(io);

  // 3. Table registry — creates predefined tables and restores persisted state
  const tableRegistry = new TableRegistry(io, roomManager);
  await tableRegistry.bootstrap();

  // 4. Socket handlers — wire events to room/table logic
  registerSocketHandlers(io, roomManager, tableRegistry);

  // 5. HTTP server
  httpServer.listen(PORT, () => {
    console.log(`\n🃏  GoldenFlop server listening on port ${PORT}\n`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[server] SIGTERM received — shutting down');
  await closeRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await closeRedis();
  process.exit(0);
});

boot().catch(err => {
  console.error('[server] boot failed:', err);
  process.exit(1);
});
