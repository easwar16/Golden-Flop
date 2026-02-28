/**
 * DepositService – build and submit Solana deposit transactions.
 *
 * Flow:
 *   1. Fetch treasury address from server
 *   2. Build unsigned transaction (SystemProgram.transfer for SOL,
 *      createTransferCheckedInstruction for SPL)
 *   3. Wallet signs + sends via transact()
 *   4. Call backend to verify on-chain and credit internal balance
 *
 * Private keys never touch this file.
 * Treasury address comes from the server (single source of truth).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4001';

// ─── Treasury info ────────────────────────────────────────────────────────────

interface TreasuryInfo {
  treasury: string;
  seekerMint: string | null;
  network: 'devnet' | 'mainnet-beta';
}

export async function fetchTreasuryInfo(): Promise<TreasuryInfo> {
  const res = await fetch(`${SERVER_URL}/api/deposit/address`);
  if (!res.ok) throw new Error('Failed to fetch treasury info');
  return res.json() as Promise<TreasuryInfo>;
}

// ─── Connection helper ────────────────────────────────────────────────────────

function getConnection(network: 'devnet' | 'mainnet-beta'): Connection {
  return new Connection(clusterApiUrl(network), 'confirmed');
}

// ─── SOL deposit ──────────────────────────────────────────────────────────────

/**
 * Build an unsigned SOL transfer Transaction.
 * The caller passes it to `wallet.signAndSendTransactions()` via MWA.
 *
 * @param fromAddress sender wallet (base58)
 * @param lamports    amount in lamports
 * @param network     devnet | mainnet-beta
 */
export async function buildSOLDepositTransaction(
  fromAddress: string,
  lamports: number,
  network: 'devnet' | 'mainnet-beta' = 'devnet',
): Promise<Transaction> {
  const info = await fetchTreasuryInfo();
  const connection = getConnection(network);

  const fromPubkey    = new PublicKey(fromAddress);
  const toPubkey      = new PublicKey(info.treasury);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: fromPubkey });
  tx.add(
    SystemProgram.transfer({ fromPubkey, toPubkey, lamports }),
  );

  return tx;
}

// ─── SPL (Seeker) deposit ─────────────────────────────────────────────────────

/**
 * Build an unsigned SPL token transfer transaction.
 * Uses transferChecked for safety (validates mint).
 *
 * @param fromAddress  sender wallet (base58)
 * @param amount       token amount in smallest unit
 * @param decimals     token decimals (e.g. 9 for Seeker)
 * @param network      devnet | mainnet-beta
 */
export async function buildSPLDepositTransaction(
  fromAddress: string,
  amount: bigint,
  decimals: number = 9,
  network: 'devnet' | 'mainnet-beta' = 'devnet',
): Promise<Transaction> {
  // Dynamic import — avoids bundling the full spl-token library if not needed
  const { getAssociatedTokenAddress, createTransferCheckedInstruction } =
    await import('@solana/spl-token');

  const info = await fetchTreasuryInfo();
  if (!info.seekerMint) throw new Error('Seeker mint not configured on server');

  const connection       = getConnection(network);
  const mintPubkey       = new PublicKey(info.seekerMint);
  const fromPubkey       = new PublicKey(fromAddress);
  const treasuryPubkey   = new PublicKey(info.treasury);

  // Derive associated token accounts
  const fromATA      = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
  const treasuryATA  = await getAssociatedTokenAddress(mintPubkey, treasuryPubkey);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: fromPubkey });

  tx.add(
    createTransferCheckedInstruction(
      fromATA,
      mintPubkey,
      treasuryATA,
      fromPubkey,
      amount,
      decimals,
    ),
  );

  return tx;
}

// ─── Notify backend of a completed deposit ────────────────────────────────────

export interface DepositResult {
  deposit: {
    id: string;
    tokenType: string;
    amount: string;
    status: string;
    transactionSignature: string;
  };
  credited?: string;
  alreadyProcessed?: boolean;
}

/**
 * Notify the backend that a transaction has been sent.
 * The backend fetches it on-chain, verifies it, and credits internal balance.
 *
 * @param token              JWT from AuthContext
 * @param tokenType          'SOL' | 'SEEKER'
 * @param transactionSignature base58 tx signature (from wallet.signAndSendTransactions)
 * @param amount             expected amount (lamports / token units) as string
 */
export async function notifyDeposit(
  token: string,
  tokenType: 'SOL' | 'SEEKER',
  transactionSignature: string,
  amount: string,
): Promise<DepositResult> {
  const endpoint = tokenType === 'SOL' ? '/api/deposit/sol' : '/api/deposit/spl';

  const body =
    tokenType === 'SOL'
      ? { transactionSignature, expectedAmountLamports: amount }
      : { transactionSignature, expectedAmount: amount };

  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err.error as string) ?? `Deposit failed (${res.status})`);
  }

  return res.json() as Promise<DepositResult>;
}

// ─── Vault (room-specific) deposits ──────────────────────────────────────────

interface VaultInfo {
  vault: string;
  network: 'devnet' | 'mainnet-beta';
  tokenType: 'SOL' | 'SEEKER';
}

/**
 * Fetch the vault address for a specific room.
 *
 * @param roomId  Room/table ID (e.g. "table-low-1")
 * @returns Vault public key + network info
 */
export async function fetchVaultAddress(roomId: string): Promise<VaultInfo> {
  const res = await fetch(`${SERVER_URL}/api/vault/${encodeURIComponent(roomId)}/address`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err.error as string) ?? `Failed to fetch vault address (${res.status})`);
  }
  return res.json() as Promise<VaultInfo>;
}

/**
 * Build an unsigned SOL transfer Transaction to a room's vault.
 * The caller passes it to `wallet.signAndSendTransactions()` via MWA.
 *
 * @param fromAddress  sender wallet (base58)
 * @param lamports     amount in lamports
 * @param roomId       room whose vault receives the deposit
 * @param network      devnet | mainnet-beta (optional, fetched from server if omitted)
 */
export async function buildVaultBuyInTransaction(
  fromAddress: string,
  lamports: number,
  roomId: string,
  network?: 'devnet' | 'mainnet-beta',
): Promise<Transaction> {
  const vaultInfo = await fetchVaultAddress(roomId);
  const conn = getConnection(network ?? vaultInfo.network);

  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(vaultInfo.vault);
  const { blockhash } = await conn.getLatestBlockhash('confirmed');

  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: fromPubkey });
  tx.add(
    SystemProgram.transfer({ fromPubkey, toPubkey, lamports }),
  );

  return tx;
}

// ─── Deposit history ─────────────────────────────────────────────────────────

/** Convenience: fetch user's deposit history. */
export async function fetchDepositHistory(token: string): Promise<DepositResult['deposit'][]> {
  const res = await fetch(`${SERVER_URL}/api/deposit/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch deposit history');
  const data = await res.json() as { deposits: DepositResult['deposit'][] };
  return data.deposits;
}
