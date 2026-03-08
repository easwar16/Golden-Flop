import 'dotenv/config';
import { createApp, AppInstance } from './app';
import { closeRedis } from './redis/RedisClient';

const PORT = Number(process.env.PORT ?? 4000);

let instance: AppInstance | null = null;

async function boot(): Promise<void> {
  instance = await createApp({ skipDb: !process.env.DATABASE_URL });

  instance.httpServer.listen(PORT, () => {
    console.log(`\n🃏  GoldenFlop server listening on port ${PORT}\n`);
  });
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — graceful shutdown`);

  if (instance) {
    // Stop accepting new connections
    instance.httpServer.close();

    // Disconnect all sockets so clients know to reconnect
    instance.io.disconnectSockets(true);

    // Close the database connection
    try {
      const { prisma } = await import('./db/prisma');
      await prisma.$disconnect();
    } catch { /* db may not have been connected */ }
  }

  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

boot().catch(err => {
  console.error('[server] boot failed:', err);
  process.exit(1);
});
