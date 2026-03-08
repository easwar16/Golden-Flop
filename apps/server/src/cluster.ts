/**
 * Cluster entrypoint — forks one worker per CPU core.
 *
 * Each worker runs the full server (index.ts boot logic).
 * Requires Redis for Socket.io adapter (cross-worker pub/sub).
 *
 * Usage:
 *   CLUSTER=true node dist/cluster.js
 *   or: tsx src/cluster.ts
 */

import 'dotenv/config';
import cluster from 'node:cluster';
import os from 'node:os';

const WORKER_COUNT = Number(process.env.WORKERS ?? os.cpus().length);

if (cluster.isPrimary) {
  console.log(`\n🃏  GoldenFlop primary (PID ${process.pid}) — forking ${WORKER_COUNT} workers\n`);

  for (let i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[cluster] worker ${worker.process.pid} exited (code=${code}, signal=${signal}) — respawning`);
    cluster.fork();
  });

  // Graceful shutdown: signal all workers
  const shutdown = () => {
    console.log('[cluster] shutting down all workers');
    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 5_000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  // Worker — run the normal server boot
  import('./index');
}
