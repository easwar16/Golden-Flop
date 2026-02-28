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
import { initRedis } from './redis/RedisClient';
import { authRouter } from './auth/authRoutes';
import { depositRouter } from './deposit/depositRoutes';
import { vaultDepositRouter } from './deposit/vaultDepositRoutes';
import { withdrawalRouter } from './withdrawal/withdrawalRoutes';
import { adminRouter } from './admin/adminRoutes';
import { generalLimiter } from './middleware/rateLimiter';
import { syncFromDefinitions } from './services/room.service';

export interface AppOptions {
  skipBootstrap?: boolean;
  skipRedis?: boolean;
  corsOrigin?: string;
  skipDb?: boolean;
}

export interface AppInstance {
  app: express.Application;
  httpServer: ReturnType<typeof createServer>;
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  roomManager: RoomManager;
  tableRegistry: TableRegistry;
}

export async function createApp(opts: AppOptions = {}): Promise<AppInstance> {
  const { skipBootstrap = false, skipRedis = false, corsOrigin = '*', skipDb = false } = opts;

  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  // ── Rate limiting (all API routes) ─────────────────────────────────────
  app.use('/api', generalLimiter);

  // ── Health check ───────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // ── API routes ─────────────────────────────────────────────────────────
  app.use('/api/auth',       authRouter);
  app.use('/api/deposit',    depositRouter);
  app.use('/api/vault',      vaultDepositRouter);
  app.use('/api/withdrawal', withdrawalRouter);
  app.use('/api/admin',      adminRouter);

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
      transports: ['websocket'],
    },
  );

  if (!skipRedis) {
    await initRedis();
  }

  // ── Prisma connection (skip in unit tests) ─────────────────────────────
  if (!skipDb) {
    const { prisma } = await import('./db/prisma');
    await prisma.$connect();

    // Sync predefined room configs to PostgreSQL
    await syncFromDefinitions();
  }

  const roomManager = new RoomManager(io);
  const tableRegistry = new TableRegistry(io, roomManager);

  if (!skipBootstrap) {
    await tableRegistry.bootstrap();
  }

  registerSocketHandlers(io, roomManager, tableRegistry);

  return { app, httpServer, io, roomManager, tableRegistry };
}
