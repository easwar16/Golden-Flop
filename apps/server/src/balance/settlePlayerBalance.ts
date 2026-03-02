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
      const sig = await processPlayerCashOut(
        tableId,
        target.userId,
        target.walletAddress,
        BigInt(target.chips),
      );
      if (sig) {
        console.log(`[economy] vault cash-out: ${target.chips} lamports → ${target.walletAddress} (tx: ${sig})`);
      } else {
        console.error(`[economy] vault cash-out FAILED for ${target.walletAddress}, ${target.chips} lamports`);
      }
      return { txSignature: sig };
    } catch (err) {
      console.error(`[economy] vault cash-out error:`, err);
      return { txSignature: null };
    }
  } else if (target.userId) {
    await processCashOut(target.userId, BigInt(target.chips));
    console.log(`[economy] cashed out ${target.chips} chips → userId:${target.userId}`);
    return {};
  }

  return {};
}
