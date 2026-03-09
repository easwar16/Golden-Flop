/**
 * settlePlayerBalance – shared cash-out logic for both explicit leave and sit-out removal.
 *
 * Handles internal balance (off-chain) and vault (on-chain) settlement.
 */

import { processCashOut } from './BalanceService';
import { processPlayerCashOut } from '../solana/PayoutService';

export interface SettlementTarget {
  userId?: string | null;
  walletAddress?: string | null;
  isVaultPlayer?: boolean;
  chips: number;
  tokenType?: 'SOL' | 'SEEKER';
}

/**
 * Return a player's remaining chips to their balance or wallet.
 *
 * @param target   Player info (userId, walletAddress, isVaultPlayer, chips)
 * @param tableId  Room/table ID (needed for vault payout)
 * @param isPractice  If true, skip settlement (practice chips are ephemeral)
 * @returns  Transaction signature if vault payout, undefined otherwise
 */
export async function settlePlayerBalance(
  target: SettlementTarget,
  tableId: string,
  isPractice: boolean,
): Promise<{ txSignature?: string | null }> {
  if (target.chips <= 0 || isPractice) return {};

  if (target.isVaultPlayer && target.walletAddress && target.userId) {
    try {
      // SEEKER chips are whole tokens; on-chain SPL uses smallest units (6 decimals)
      const tokenType = target.tokenType ?? 'SOL';
      const onChainAmount = tokenType === 'SEEKER'
        ? BigInt(target.chips) * 1_000_000n
        : BigInt(target.chips);

      const sig = await processPlayerCashOut(
        tableId,
        target.userId,
        target.walletAddress,
        onChainAmount,
        tokenType,
      );
      if (sig) {
        console.log(`[economy] vault cash-out: ${target.chips} lamports → ${target.walletAddress} (tx: ${sig})`);
        return { txSignature: sig };
      }

      // On-chain transfer failed — fall back to crediting internal balance
      // so the player never loses their chips.
      console.warn(`[economy] vault cash-out failed for ${target.walletAddress}, falling back to internal balance credit`);
      await processCashOut(target.userId, BigInt(target.chips), tokenType);
      console.log(`[economy] fallback credit: ${target.chips} chips (${tokenType}) → userId:${target.userId}`);
      return { txSignature: 'internal' };
    } catch (err) {
      console.error(`[economy] vault cash-out error, falling back to internal balance:`, err);
      // Last resort: credit internal balance so chips aren't lost
      try {
        const tokenType = target.tokenType ?? 'SOL';
        await processCashOut(target.userId, BigInt(target.chips), tokenType);
        console.log(`[economy] fallback credit (after error): ${target.chips} chips (${tokenType}) → userId:${target.userId}`);
        return { txSignature: 'internal' };
      } catch (fallbackErr) {
        console.error(`[economy] CRITICAL: fallback credit also failed:`, fallbackErr);
        return { txSignature: null };
      }
    }
  } else if (target.userId) {
    await processCashOut(target.userId, BigInt(target.chips), target.tokenType ?? 'SOL');
    console.log(`[economy] cashed out ${target.chips} chips (${target.tokenType ?? 'SOL'}) → userId:${target.userId}`);
    return {};
  }

  return {};
}
