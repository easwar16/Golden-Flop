/**
 * Prisma seed script – run with: npx prisma db seed
 *
 * Delegates to src/db/seed.ts which contains the actual seed logic.
 * This file exists so `npx prisma db seed` still works for local development.
 */

import { PrismaClient } from '@prisma/client';

// We need to register ts-path aliases or use the compiled version.
// For local dev, ts-node will resolve the import from src/.
import { seedDatabase } from '../src/db/seed';

seedDatabase()
  .then(async () => {
    const prisma = new PrismaClient();
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    const prisma = new PrismaClient();
    await prisma.$disconnect();
    process.exit(1);
  });
