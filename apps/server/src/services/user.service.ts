/**
 * UserService – user lifecycle operations.
 *
 * Extracted from authRoutes.ts for reusability across routes and services.
 */

import { prisma } from '../db/prisma';

export interface UserProfile {
  id: string;
  walletAddress: string;
  username: string | null;
  avatar: string | null;
  createdAt: Date;
}

/**
 * Find or create a user by wallet address.
 * Also ensures InternalBalance rows exist for both SOL and SEEKER tokens.
 */
export async function findOrCreateUser(walletAddress: string): Promise<UserProfile> {
  const user = await prisma.user.upsert({
    where:  { walletAddress },
    update: { updatedAt: new Date() },
    create: { walletAddress },
    select: { id: true, walletAddress: true, username: true, avatar: true, createdAt: true },
  });

  // Ensure balance rows exist for both token types
  await Promise.all([
    prisma.internalBalance.upsert({
      where:  { userId_tokenType: { userId: user.id, tokenType: 'SOL' } },
      update: {},
      create: { userId: user.id, tokenType: 'SOL', balance: 0n },
    }),
    prisma.internalBalance.upsert({
      where:  { userId_tokenType: { userId: user.id, tokenType: 'SEEKER' } },
      update: {},
      create: { userId: user.id, tokenType: 'SEEKER', balance: 0n },
    }),
  ]);

  return user;
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  return prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, walletAddress: true, username: true, avatar: true, createdAt: true },
  });
}

export async function updateProfile(
  userId: string,
  data: { username?: string; avatar?: string },
): Promise<UserProfile> {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, walletAddress: true, username: true, avatar: true, createdAt: true },
  });
}
