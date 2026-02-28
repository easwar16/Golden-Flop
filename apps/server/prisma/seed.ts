/**
 * Prisma seed script – run with: npx prisma db seed
 *
 * Seeds:
 *  1. All predefined rooms from definitions.ts
 *  2. A test user with initial balance (development only)
 */

import { PrismaClient } from '@prisma/client';
import { DEFAULT_TABLES } from '../src/table/definitions';
import { NATIVE_SOL_MINT } from '../src/table/constants';
import { getOrCreateVaultAddress, isVaultConfigured } from '../src/solana/VaultService';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ── 1. Seed predefined rooms ────────────────────────────────────────────
  for (const def of DEFAULT_TABLES) {
    const tokenType = def.config.tokenMint === NATIVE_SOL_MINT ? 'SOL' : 'SEEKER';

    // Derive vault address if vault keys are configured
    let vaultAddress: string | null = null;
    if (isVaultConfigured()) {
      try {
        vaultAddress = getOrCreateVaultAddress(def.id);
      } catch {
        // No vault key for this room — that's fine
      }
    }

    await prisma.room.upsert({
      where: { id: def.id },
      update: {
        name:       def.name,
        smallBlind: BigInt(def.config.smallBlind),
        bigBlind:   BigInt(def.config.bigBlind),
        minBuyIn:   BigInt(def.config.minBuyIn),
        maxBuyIn:   BigInt(def.config.maxBuyIn),
        maxPlayers: def.config.maxPlayers,
        isPremium:  def.config.isPremium ?? false,
        tokenType:  tokenType as any,
        ...(vaultAddress ? { vaultAddress } : {}),
      },
      create: {
        id:             def.id,
        name:           def.name,
        tokenType:      tokenType as any,
        smallBlind:     BigInt(def.config.smallBlind),
        bigBlind:       BigInt(def.config.bigBlind),
        minBuyIn:       BigInt(def.config.minBuyIn),
        maxBuyIn:       BigInt(def.config.maxBuyIn),
        maxPlayers:     def.config.maxPlayers,
        rakePercentage: 2.5,
        rakeCap:        0n,
        isPremium:      def.config.isPremium ?? false,
        vaultAddress,
      },
    });
  }
  console.log(`  ✓ ${DEFAULT_TABLES.length} rooms seeded`);

  // ── 2. Seed test user (development only) ────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const testWallet = 'TestWa11etAddressForDeve1opment11111111111111';

    const user = await prisma.user.upsert({
      where:  { walletAddress: testWallet },
      update: {},
      create: { walletAddress: testWallet, username: 'TestPlayer' },
    });

    // Give test user 10 SOL and 1000 SEEKER tokens
    await prisma.internalBalance.upsert({
      where:  { userId_tokenType: { userId: user.id, tokenType: 'SOL' } },
      update: { balance: 10_000_000_000n }, // 10 SOL
      create: { userId: user.id, tokenType: 'SOL', balance: 10_000_000_000n },
    });

    await prisma.internalBalance.upsert({
      where:  { userId_tokenType: { userId: user.id, tokenType: 'SEEKER' } },
      update: { balance: 1_000_000_000_000n }, // 1000 SEEKER
      create: { userId: user.id, tokenType: 'SEEKER', balance: 1_000_000_000_000n },
    });

    console.log(`  ✓ Test user seeded: ${testWallet} (10 SOL, 1000 SEEKER)`);
  }

  console.log('Seeding complete.');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
