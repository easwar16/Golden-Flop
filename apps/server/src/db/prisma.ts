/**
 * Prisma client singleton.
 *
 * In production Node.js apps a single PrismaClient instance is enough.
 * During development tsx/ts-node hot-reloads can create multiple instances,
 * so we cache it on the global object as a precaution.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
