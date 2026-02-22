import { createApp } from './app';
import { closeRedis } from './redis/RedisClient';

const PORT = Number(process.env.PORT ?? 4000);

async function boot(): Promise<void> {
  const { httpServer } = await createApp();

  httpServer.listen(PORT, () => {
    console.log(`\n🃏  GoldenFlop server listening on port ${PORT}\n`);
  });
}

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
