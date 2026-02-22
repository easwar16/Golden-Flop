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

export interface AppOptions {
  skipBootstrap?: boolean;
  skipRedis?: boolean;
  corsOrigin?: string;
}

export interface AppInstance {
  app: express.Application;
  httpServer: ReturnType<typeof createServer>;
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  roomManager: RoomManager;
  tableRegistry: TableRegistry;
}

export async function createApp(opts: AppOptions = {}): Promise<AppInstance> {
  const { skipBootstrap = false, skipRedis = false, corsOrigin = '*' } = opts;

  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

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

  const roomManager = new RoomManager(io);
  const tableRegistry = new TableRegistry(io, roomManager);

  if (!skipBootstrap) {
    await tableRegistry.bootstrap();
  }

  registerSocketHandlers(io, roomManager, tableRegistry);

  return { app, httpServer, io, roomManager, tableRegistry };
}
