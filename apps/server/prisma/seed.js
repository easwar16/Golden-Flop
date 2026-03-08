"use strict";
/**
 * Prisma seed script – run with: npx prisma db seed
 *
 * Seeds 115 predefined rooms:
 *   - 50 SOL tables (micro/low/mid/high/VIP + turbo)
 *   - 50 SEEKER tables (micro/low/mid/high/VIP + turbo)
 *   - 15 Practice tables (beginner/casual/advanced/highroller/turbo/headsup)
 *
 * Also seeds a test user (development only).
 * Uses upsert so it's idempotent — safe to run multiple times.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const VaultService_1 = require("../src/solana/VaultService");
const prisma = new client_1.PrismaClient();
// ── Helpers ─────────────────────────────────────────────────────────────────
const LAMPORTS_PER_SOL = 1_000_000_000;
const sol = (amount) => BigInt(Math.round(amount * LAMPORTS_PER_SOL));
const NATIVE_SOL_MINT = 'SOL';
const SEEKER_MINT = process.env.SEEKER_MINT ?? 'SEEKER';
const SOL_TIERS = [
    // Micro — min buy-in 0.01 SOL
    { prefix: 'micro-a', smallBlind: 0.001, bigBlind: 0.002, minBuyIn: 0.01, maxBuyIn: 0.05, turnTimeoutMs: 45_000, isPremium: false },
    { prefix: 'micro-b', smallBlind: 0.001, bigBlind: 0.002, minBuyIn: 0.01, maxBuyIn: 0.08, turnTimeoutMs: 45_000, isPremium: false },
    // Low — min buy-in 0.05 SOL
    { prefix: 'low-a', smallBlind: 0.002, bigBlind: 0.005, minBuyIn: 0.05, maxBuyIn: 0.25, turnTimeoutMs: 45_000, isPremium: false },
    { prefix: 'low-b', smallBlind: 0.002, bigBlind: 0.005, minBuyIn: 0.05, maxBuyIn: 0.30, turnTimeoutMs: 45_000, isPremium: false },
    // Mid — min buy-in 0.8 SOL
    { prefix: 'mid-a', smallBlind: 0.008, bigBlind: 0.016, minBuyIn: 0.80, maxBuyIn: 4.00, turnTimeoutMs: 30_000, isPremium: false },
    { prefix: 'mid-b', smallBlind: 0.008, bigBlind: 0.016, minBuyIn: 0.80, maxBuyIn: 5.00, turnTimeoutMs: 30_000, isPremium: false },
    // High — min buy-in 1.0 SOL
    { prefix: 'high-a', smallBlind: 0.01, bigBlind: 0.02, minBuyIn: 1.00, maxBuyIn: 5.00, turnTimeoutMs: 15_000, isPremium: false },
    { prefix: 'high-b', smallBlind: 0.01, bigBlind: 0.02, minBuyIn: 1.00, maxBuyIn: 10.00, turnTimeoutMs: 15_000, isPremium: true },
    // VIP — unchanged
    { prefix: 'vip-a', smallBlind: 0.025, bigBlind: 0.05, minBuyIn: 2.50, maxBuyIn: 25.00, turnTimeoutMs: 15_000, isPremium: true },
    { prefix: 'vip-b', smallBlind: 0.05, bigBlind: 0.1, minBuyIn: 5.00, maxBuyIn: 50.00, turnTimeoutMs: 15_000, isPremium: true },
];
// Distribution: 50 SOL tables across tiers
// Micro: 8, Low: 10, Mid: 12, High: 10, VIP: 4, Turbo: 6
const SOL_DISTRIBUTION = {
    'micro-a': 4, 'micro-b': 4,
    'low-a': 5, 'low-b': 5,
    'mid-a': 6, 'mid-b': 6,
    'high-a': 5, 'high-b': 5,
    'vip-a': 2, 'vip-b': 2,
};
function generateSolRooms() {
    const rooms = [];
    for (const tier of SOL_TIERS) {
        const count = SOL_DISTRIBUTION[tier.prefix] ?? 2;
        for (let i = 1; i <= count; i++) {
            rooms.push({
                id: `table-${tier.prefix}-${i}`,
                name: `SOL ${tier.prefix} #${i}`,
                smallBlind: sol(tier.smallBlind),
                bigBlind: sol(tier.bigBlind),
                minBuyIn: sol(tier.minBuyIn),
                maxBuyIn: sol(tier.maxBuyIn),
                maxPlayers: 6,
                turnTimeoutMs: tier.turnTimeoutMs,
                tokenMint: NATIVE_SOL_MINT,
                isPremium: tier.isPremium,
                isPractice: false,
                rakePercentage: 2.5,
                rakeCap: sol(tier.bigBlind * 3),
            });
        }
    }
    // Turbo tables (10s timer) — 6 tables across low/mid/high
    const turboTiers = [
        { prefix: 'turbo-low', sb: 0.002, bb: 0.005, min: 0.05, max: 0.25, count: 2 },
        { prefix: 'turbo-mid', sb: 0.008, bb: 0.016, min: 0.80, max: 4.00, count: 2 },
        { prefix: 'turbo-high', sb: 0.01, bb: 0.02, min: 1.00, max: 5.00, count: 2 },
    ];
    for (const t of turboTiers) {
        for (let i = 1; i <= t.count; i++) {
            rooms.push({
                id: `table-${t.prefix}-${i}`,
                name: `Turbo ${t.prefix.replace('turbo-', '')} #${i}`,
                smallBlind: sol(t.sb),
                bigBlind: sol(t.bb),
                minBuyIn: sol(t.min),
                maxBuyIn: sol(t.max),
                maxPlayers: 6,
                turnTimeoutMs: 10_000,
                tokenMint: NATIVE_SOL_MINT,
                isPremium: false,
                isPractice: false,
                rakePercentage: 2.5,
                rakeCap: sol(t.bb * 3),
            });
        }
    }
    return rooms;
}
const SEEKER_TIERS = [
    // Micro — min 200 SEEKER
    { prefix: 'seeker-micro-a', smallBlind: 4n, bigBlind: 8n, minBuyIn: 200n, maxBuyIn: 2000n, turnTimeoutMs: 45_000, isPremium: false },
    { prefix: 'seeker-micro-b', smallBlind: 4n, bigBlind: 8n, minBuyIn: 200n, maxBuyIn: 3200n, turnTimeoutMs: 45_000, isPremium: false },
    // Low — min 800 SEEKER
    { prefix: 'seeker-low-a', smallBlind: 8n, bigBlind: 20n, minBuyIn: 800n, maxBuyIn: 8000n, turnTimeoutMs: 45_000, isPremium: false },
    { prefix: 'seeker-low-b', smallBlind: 8n, bigBlind: 20n, minBuyIn: 800n, maxBuyIn: 10000n, turnTimeoutMs: 45_000, isPremium: false },
    // Mid — min 4,000 SEEKER
    { prefix: 'seeker-mid-a', smallBlind: 40n, bigBlind: 80n, minBuyIn: 4000n, maxBuyIn: 40000n, turnTimeoutMs: 30_000, isPremium: false },
    { prefix: 'seeker-mid-b', smallBlind: 40n, bigBlind: 80n, minBuyIn: 4000n, maxBuyIn: 60000n, turnTimeoutMs: 30_000, isPremium: false },
    // High — min 20,000 SEEKER
    { prefix: 'seeker-high-a', smallBlind: 200n, bigBlind: 400n, minBuyIn: 20000n, maxBuyIn: 200000n, turnTimeoutMs: 15_000, isPremium: false },
    { prefix: 'seeker-high-b', smallBlind: 200n, bigBlind: 400n, minBuyIn: 20000n, maxBuyIn: 300000n, turnTimeoutMs: 15_000, isPremium: false },
    // VIP — min 100K SEEKER
    { prefix: 'seeker-vip-a', smallBlind: 1000n, bigBlind: 2000n, minBuyIn: 100000n, maxBuyIn: 1000000n, turnTimeoutMs: 15_000, isPremium: true },
    { prefix: 'seeker-vip-b', smallBlind: 2000n, bigBlind: 4000n, minBuyIn: 200000n, maxBuyIn: 2000000n, turnTimeoutMs: 15_000, isPremium: true },
];
// Distribution: 50 SEEKER tables
const SEEKER_DISTRIBUTION = {
    'seeker-micro-a': 4, 'seeker-micro-b': 4,
    'seeker-low-a': 5, 'seeker-low-b': 5,
    'seeker-mid-a': 6, 'seeker-mid-b': 6,
    'seeker-high-a': 5, 'seeker-high-b': 5,
    'seeker-vip-a': 3, 'seeker-vip-b': 2,
};
// Turbo SEEKER tables: 5 tables
const SEEKER_TURBO = [
    { prefix: 'seeker-turbo-low', sb: 8n, bb: 20n, min: 800n, max: 8000n, count: 2 },
    { prefix: 'seeker-turbo-mid', sb: 40n, bb: 80n, min: 4000n, max: 40000n, count: 2 },
    { prefix: 'seeker-turbo-high', sb: 200n, bb: 400n, min: 20000n, max: 200000n, count: 1 },
];
function generateSeekerRooms() {
    const rooms = [];
    for (const tier of SEEKER_TIERS) {
        const count = SEEKER_DISTRIBUTION[tier.prefix] ?? 2;
        for (let i = 1; i <= count; i++) {
            rooms.push({
                id: `${tier.prefix}-${i}`,
                name: `SEEKER ${tier.prefix} #${i}`,
                smallBlind: tier.smallBlind,
                bigBlind: tier.bigBlind,
                minBuyIn: tier.minBuyIn,
                maxBuyIn: tier.maxBuyIn,
                maxPlayers: 6,
                turnTimeoutMs: tier.turnTimeoutMs,
                tokenMint: SEEKER_MINT,
                isPremium: tier.isPremium,
                isPractice: false,
                rakePercentage: 2.5,
                rakeCap: tier.bigBlind * 3n,
            });
        }
    }
    for (const t of SEEKER_TURBO) {
        for (let i = 1; i <= t.count; i++) {
            rooms.push({
                id: `${t.prefix}-${i}`,
                name: `SEEKER Turbo ${t.prefix.replace('seeker-turbo-', '')} #${i}`,
                smallBlind: t.sb,
                bigBlind: t.bb,
                minBuyIn: t.min,
                maxBuyIn: t.max,
                maxPlayers: 6,
                turnTimeoutMs: 10_000,
                tokenMint: SEEKER_MINT,
                isPremium: false,
                isPractice: false,
                rakePercentage: 2.5,
                rakeCap: t.bb * 3n,
            });
        }
    }
    return rooms;
}
// ── Practice rooms (15) ──────────────────────────────────────────────────────
const PRACTICE_ROOMS = [
    // Beginner (3)
    { id: 'practice-beginner-1', name: 'Beginner #1', smallBlind: 5n, bigBlind: 10n, minBuyIn: 1000n, maxBuyIn: 2000n, maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-beginner-2', name: 'Beginner #2', smallBlind: 5n, bigBlind: 10n, minBuyIn: 1000n, maxBuyIn: 2000n, maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-beginner-3', name: 'Beginner #3', smallBlind: 10n, bigBlind: 20n, minBuyIn: 2000n, maxBuyIn: 4000n, maxPlayers: 6, turnTimeoutMs: 45_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    // Casual (3)
    { id: 'practice-casual-1', name: 'Casual #1', smallBlind: 25n, bigBlind: 50n, minBuyIn: 5000n, maxBuyIn: 10000n, maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-casual-2', name: 'Casual #2', smallBlind: 25n, bigBlind: 50n, minBuyIn: 5000n, maxBuyIn: 10000n, maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-casual-3', name: 'Casual #3', smallBlind: 50n, bigBlind: 100n, minBuyIn: 10000n, maxBuyIn: 20000n, maxPlayers: 6, turnTimeoutMs: 30_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    // Advanced (3)
    { id: 'practice-advanced-1', name: 'Advanced #1', smallBlind: 100n, bigBlind: 200n, minBuyIn: 20000n, maxBuyIn: 40000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-advanced-2', name: 'Advanced #2', smallBlind: 100n, bigBlind: 200n, minBuyIn: 20000n, maxBuyIn: 40000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-advanced-3', name: 'Advanced #3', smallBlind: 200n, bigBlind: 400n, minBuyIn: 40000n, maxBuyIn: 80000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    // High Roller (2)
    { id: 'practice-highroller-1', name: 'High Roller #1', smallBlind: 500n, bigBlind: 1000n, minBuyIn: 100000n, maxBuyIn: 200000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-highroller-2', name: 'High Roller #2', smallBlind: 1000n, bigBlind: 2000n, minBuyIn: 200000n, maxBuyIn: 400000n, maxPlayers: 6, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    // Turbo (2)
    { id: 'practice-turbo-1', name: 'Turbo #1', smallBlind: 25n, bigBlind: 50n, minBuyIn: 5000n, maxBuyIn: 10000n, maxPlayers: 6, turnTimeoutMs: 10_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-turbo-2', name: 'Turbo #2', smallBlind: 100n, bigBlind: 200n, minBuyIn: 20000n, maxBuyIn: 40000n, maxPlayers: 6, turnTimeoutMs: 10_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    // Heads Up (2)
    { id: 'practice-headsup-1', name: 'Heads Up #1', smallBlind: 25n, bigBlind: 50n, minBuyIn: 5000n, maxBuyIn: 10000n, maxPlayers: 2, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
    { id: 'practice-headsup-2', name: 'Heads Up #2', smallBlind: 100n, bigBlind: 200n, minBuyIn: 20000n, maxBuyIn: 40000n, maxPlayers: 2, turnTimeoutMs: 15_000, tokenMint: 'SOL', isPremium: false, isPractice: true, rakePercentage: 0, rakeCap: 0n },
];
const ROOMS = [
    ...generateSolRooms(),
    ...generateSeekerRooms(),
    ...PRACTICE_ROOMS,
];
// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    console.log('Seeding database...');
    const vaultEnabled = (0, VaultService_1.isVaultConfigured)();
    // ── 1. Seed all rooms ─────────────────────────────────────────────────────
    for (const room of ROOMS) {
        const tokenType = room.tokenMint === NATIVE_SOL_MINT ? 'SOL' : 'SEEKER';
        let vaultAddress = null;
        if (vaultEnabled && !room.isPractice) {
            try {
                vaultAddress = (0, VaultService_1.getOrCreateVaultAddress)(room.id);
            }
            catch {
                // No vault key for this room — that's fine
            }
        }
        await prisma.room.upsert({
            where: { id: room.id },
            update: {
                name: room.name,
                smallBlind: room.smallBlind,
                bigBlind: room.bigBlind,
                minBuyIn: room.minBuyIn,
                maxBuyIn: room.maxBuyIn,
                maxPlayers: room.maxPlayers,
                turnTimeoutMs: room.turnTimeoutMs,
                tokenMint: room.tokenMint,
                isPremium: room.isPremium,
                isPractice: room.isPractice,
                rakePercentage: room.rakePercentage,
                rakeCap: room.rakeCap,
                tokenType: tokenType,
                ...(vaultAddress ? { vaultAddress } : {}),
            },
            create: {
                id: room.id,
                name: room.name,
                tokenType: tokenType,
                smallBlind: room.smallBlind,
                bigBlind: room.bigBlind,
                minBuyIn: room.minBuyIn,
                maxBuyIn: room.maxBuyIn,
                maxPlayers: room.maxPlayers,
                turnTimeoutMs: room.turnTimeoutMs,
                tokenMint: room.tokenMint,
                rakePercentage: room.rakePercentage,
                rakeCap: room.rakeCap,
                isPremium: room.isPremium,
                isPractice: room.isPractice,
                vaultAddress,
            },
        });
    }
    console.log(`  ✓ ${ROOMS.length} rooms seeded`);
    // ── 2. Seed test user (development only) ──────────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
        const testWallet = 'TestWa11etAddressForDeve1opment11111111111111';
        const user = await prisma.user.upsert({
            where: { walletAddress: testWallet },
            update: {},
            create: { walletAddress: testWallet, username: 'TestPlayer' },
        });
        await prisma.internalBalance.upsert({
            where: { userId_tokenType: { userId: user.id, tokenType: 'SOL' } },
            update: { balance: 10000000000n }, // 10 SOL
            create: { userId: user.id, tokenType: 'SOL', balance: 10000000000n },
        });
        await prisma.internalBalance.upsert({
            where: { userId_tokenType: { userId: user.id, tokenType: 'SEEKER' } },
            update: { balance: 1000000000000n }, // 1000 SEEKER
            create: { userId: user.id, tokenType: 'SEEKER', balance: 1000000000000n },
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
