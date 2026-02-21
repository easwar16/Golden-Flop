/**
 * Lamport / SOL helpers.
 *
 * All monetary values inside the game engine are in lamports.
 * 1 SOL = 1,000,000,000 lamports.
 *
 * Using lamports avoids floating-point rounding errors in game logic
 * and maps directly to on-chain amounts when escrow is added.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Convert a SOL amount (float) to lamports (integer). */
export function sol(amount: number): number {
  return Math.round(amount * LAMPORTS_PER_SOL);
}

/** Convert lamports back to a display SOL string (e.g. "0.001 SOL"). */
export function lamportsToSolString(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, '')} SOL`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token mints
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel for native SOL (no SPL token mint involved). */
export const NATIVE_SOL_MINT = 'SOL';

/**
 * Wrapped SOL mint address on Solana mainnet.
 * Use this when integrating with SPL token programs that require a mint.
 */
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
