/**
 * SolanaService – all chain interactions live here.
 *
 * Responsibilities:
 *  - Verify wallet message signatures (auth, no RPC required)
 *  - Verify SOL transfer deposits (checks on-chain tx)
 *  - Verify SPL token (Seeker) deposits (checks on-chain tx)
 *
 * Treasury private key NEVER touches this file.
 * Withdrawals (signing with treasury key) should be handled by a
 * separate, air-gapped signer process — out of scope for this module.
 *
 * Network is controlled by SOLANA_NETWORK env var ("devnet" | "mainnet-beta").
 */

import {
  Connection,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// ─── RPC connection ───────────────────────────────────────────────────────────

type SolanaCluster = 'devnet' | 'mainnet-beta';

function getConnection(): Connection {
  const network = (process.env.SOLANA_NETWORK ?? 'devnet') as SolanaCluster;
  return new Connection(clusterApiUrl(network), 'confirmed');
}

// ─── Treasury helpers ─────────────────────────────────────────────────────────

function getTreasuryPublicKey(): PublicKey {
  const addr = process.env.TREASURY_WALLET;
  if (!addr) throw new Error('TREASURY_WALLET env var is not set');
  return new PublicKey(addr);
}

function getSeekerMint(): PublicKey {
  const addr = process.env.SEEKER_MINT;
  if (!addr) throw new Error('SEEKER_MINT env var is not set');
  return new PublicKey(addr);
}

// ─── Signature verification (no RPC) ─────────────────────────────────────────

/**
 * Verify a Solana wallet message signature using ed25519.
 * Used for login — no network call needed.
 *
 * @param walletAddress  base58 Solana public key
 * @param message        the exact plaintext string that was signed
 * @param signatureB64   base64-encoded 64-byte ed25519 signature from wallet
 */
export function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signatureB64: string,
): boolean {
  try {
    const publicKeyBytes = new PublicKey(walletAddress).toBytes();
    const messageBytes   = Buffer.from(message, 'utf8');
    const signatureBytes = Buffer.from(signatureB64, 'base64');

    if (signatureBytes.length !== 64) return false;

    return nacl.sign.detached.verify(
      new Uint8Array(messageBytes),
      new Uint8Array(signatureBytes),
      new Uint8Array(publicKeyBytes),
    );
  } catch {
    return false;
  }
}

// ─── Deposit verification result ─────────────────────────────────────────────

export interface DepositVerification {
  success: boolean;
  confirmedAmount?: bigint; // lamports or token smallest unit
  error?: string;
}

// ─── SOL deposit verification ─────────────────────────────────────────────────

/**
 * Verify that a SOL transfer on-chain:
 *  - Is confirmed
 *  - Destination = treasury
 *  - Source     = senderAddress
 *  - Amount     ≥ expectedAmountLamports
 *
 * @param txSignature          base58 Solana transaction signature
 * @param expectedAmountLamports minimum lamports expected
 * @param senderAddress        base58 sender wallet (must match tx)
 */
export async function verifySOLDeposit(
  txSignature: string,
  expectedAmountLamports: bigint,
  senderAddress: string,
): Promise<DepositVerification> {
  try {
    const connection = getConnection();
    const treasury   = getTreasuryPublicKey();

    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      return { success: false, error: 'Transaction not found or not confirmed' };
    }
    if (tx.meta?.err) {
      return { success: false, error: 'Transaction failed on-chain' };
    }

    // Walk through instructions to find a SOL system transfer
    const instructions = tx.transaction.message.instructions;
    for (const ix of instructions) {
      if (!('parsed' in ix)) continue;

      const { type, info } = ix.parsed as {
        type: string;
        info: { source: string; destination: string; lamports: number };
      };

      if (
        type === 'transfer' &&
        info.destination === treasury.toBase58() &&
        info.source     === senderAddress
      ) {
        const transferred = BigInt(info.lamports);
        if (transferred < expectedAmountLamports) {
          return {
            success: false,
            error: `Amount ${transferred} lamports below expected ${expectedAmountLamports}`,
          };
        }
        return { success: true, confirmedAmount: transferred };
      }
    }

    return { success: false, error: 'No matching SOL transfer found in transaction' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Verification error: ${message}` };
  }
}

// ─── SOL deposit verification (vault-specific) ──────────────────────────────

/**
 * Verify that a SOL transfer on-chain went to a specific vault address.
 * Same logic as verifySOLDeposit() but checks against a room vault
 * instead of the treasury.
 *
 * @param txSignature          base58 Solana transaction signature
 * @param expectedAmountLamports minimum lamports expected
 * @param senderAddress        base58 sender wallet (must match tx)
 * @param vaultAddress         base58 vault public key to check destination against
 */
export async function verifySOLDepositToVault(
  txSignature: string,
  expectedAmountLamports: bigint,
  senderAddress: string,
  vaultAddress: string,
): Promise<DepositVerification> {
  try {
    const connection = getConnection();

    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      return { success: false, error: 'Transaction not found or not confirmed' };
    }
    if (tx.meta?.err) {
      return { success: false, error: 'Transaction failed on-chain' };
    }

    const instructions = tx.transaction.message.instructions;
    for (const ix of instructions) {
      if (!('parsed' in ix)) continue;

      const { type, info } = ix.parsed as {
        type: string;
        info: { source: string; destination: string; lamports: number };
      };

      if (
        type === 'transfer' &&
        info.destination === vaultAddress &&
        info.source     === senderAddress
      ) {
        const transferred = BigInt(info.lamports);
        if (transferred < expectedAmountLamports) {
          return {
            success: false,
            error: `Amount ${transferred} lamports below expected ${expectedAmountLamports}`,
          };
        }
        return { success: true, confirmedAmount: transferred };
      }
    }

    return { success: false, error: 'No matching SOL transfer to vault found in transaction' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Verification error: ${message}` };
  }
}

// ─── SPL token (Seeker) deposit verification ──────────────────────────────────

/**
 * Verify that a Seeker SPL token transfer on-chain:
 *  - Is confirmed
 *  - Mint = SEEKER_MINT
 *  - Destination = treasury's associated token account
 *  - Source owner = senderAddress
 *  - Amount ≥ expectedAmount
 *
 * @param txSignature    base58 transaction signature
 * @param expectedAmount minimum token units expected
 * @param senderAddress  base58 sender wallet
 */
export async function verifySPLDeposit(
  txSignature: string,
  expectedAmount: bigint,
  senderAddress: string,
): Promise<DepositVerification> {
  try {
    const connection = getConnection();
    const treasury   = getTreasuryPublicKey();
    const mint       = getSeekerMint();

    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx) {
      return { success: false, error: 'Transaction not found or not confirmed' };
    }
    if (tx.meta?.err) {
      return { success: false, error: 'Transaction failed on-chain' };
    }

    const innerInstructions = tx.meta?.innerInstructions ?? [];
    const allInstructions   = [
      ...tx.transaction.message.instructions,
      ...innerInstructions.flatMap((ii) => ii.instructions),
    ];

    for (const ix of allInstructions) {
      if (!('parsed' in ix)) continue;

      const { type, info } = ix.parsed as {
        type: string;
        info: {
          mint?: string;
          authority?: string;
          source?: string;
          destination?: string;
          tokenAmount?: { amount: string };
          amount?: string;
        };
      };

      // spl-token transferChecked or transfer
      if (type !== 'transferChecked' && type !== 'transfer') continue;

      // Verify mint
      if (info.mint && info.mint !== mint.toBase58()) continue;

      // Verify sender authority
      if (info.authority !== senderAddress) continue;

      // Parse amount
      const rawAmount = info.tokenAmount?.amount ?? info.amount ?? '0';
      const transferred = BigInt(rawAmount);

      if (transferred < expectedAmount) {
        return {
          success: false,
          error: `Amount ${transferred} below expected ${expectedAmount}`,
        };
      }

      return { success: true, confirmedAmount: transferred };
    }

    return { success: false, error: 'No matching SPL transfer found in transaction' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Verification error: ${message}` };
  }
}

/** Convenience: return treasury wallet address as base58 string. */
export function getTreasuryAddress(): string {
  return getTreasuryPublicKey().toBase58();
}
