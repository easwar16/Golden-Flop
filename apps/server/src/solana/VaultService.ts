/**
 * VaultService – manages per-room escrow vault keypairs and on-chain transfers.
 *
 * Each poker room can have its own on-chain vault wallet. Players deposit
 * directly to the vault when joining; payouts are sent from the vault.
 *
 * Keypair loading priority:
 *   1. VAULT_KEY_<ROOM_ID_UPPERCASED> env var (per-room, production)
 *   2. VAULT_PRIVATE_KEY env var (shared, dev/testing)
 *
 * All private keys are base58-encoded Solana secret keys (64 bytes).
 *
 * Security: In production, vault keys should be loaded from a secrets
 * manager (AWS Secrets Manager, HashiCorp Vault). The env var approach
 * is a stepping stone. A future upgrade would use Solana PDAs with an
 * on-chain escrow program.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

// ─── RPC connection ───────────────────────────────────────────────────────────

type SolanaCluster = 'devnet' | 'mainnet-beta';

function getConnection(): Connection {
  const network = (process.env.SOLANA_NETWORK ?? 'devnet') as SolanaCluster;
  return new Connection(clusterApiUrl(network), 'confirmed');
}

// ─── Keypair cache ────────────────────────────────────────────────────────────

const keypairCache = new Map<string, Keypair>();

/**
 * Convert a room ID to an env-var-safe suffix.
 * e.g. "table-low-1" → "TABLE_LOW_1"
 */
function roomIdToEnvKey(roomId: string): string {
  return roomId.replace(/-/g, '_').toUpperCase();
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Load the vault keypair for a room.
 *
 * Checks VAULT_KEY_<ROOM_ID> first, then falls back to VAULT_PRIVATE_KEY.
 * Caches keypairs in memory to avoid repeated base58 decoding.
 *
 * @throws Error if no vault key is configured
 */
export function getVaultKeypair(roomId: string): Keypair {
  const cached = keypairCache.get(roomId);
  if (cached) return cached;

  // Per-room key takes priority
  const perRoomKey = process.env[`VAULT_KEY_${roomIdToEnvKey(roomId)}`];
  const sharedKey = process.env.VAULT_PRIVATE_KEY;
  const secretKeyBase58 = perRoomKey ?? sharedKey;

  if (!secretKeyBase58) {
    throw new Error(
      `No vault key configured for room "${roomId}". ` +
      `Set VAULT_KEY_${roomIdToEnvKey(roomId)} or VAULT_PRIVATE_KEY.`,
    );
  }

  const secretKey = bs58.decode(secretKeyBase58);
  const keypair = Keypair.fromSecretKey(secretKey);
  keypairCache.set(roomId, keypair);
  return keypair;
}

/**
 * Returns the vault's public key as base58 for a given room.
 * Derives it from the keypair.
 */
export function getOrCreateVaultAddress(roomId: string): string {
  const keypair = getVaultKeypair(roomId);
  return keypair.publicKey.toBase58();
}

/**
 * Check whether vault keys are configured (at least VAULT_PRIVATE_KEY).
 */
export function isVaultConfigured(): boolean {
  return !!process.env.VAULT_PRIVATE_KEY;
}

/**
 * Transfer SOL from the room vault to a destination wallet.
 *
 * @param roomId      Room whose vault is the source
 * @param destination Base58 recipient public key
 * @param lamports    Amount in lamports
 * @returns Transaction signature (base58)
 */
export async function transferSOLFromVault(
  roomId: string,
  destination: string,
  lamports: bigint,
): Promise<string> {
  const connection = getConnection();
  const vaultKeypair = getVaultKeypair(roomId);
  const toPubkey = new PublicKey(destination);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: vaultKeypair.publicKey,
      toPubkey,
      lamports: Number(lamports),
    }),
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [vaultKeypair],
    { commitment: 'confirmed' },
  );

  return signature;
}

/**
 * Transfer SPL tokens from the room vault to a destination wallet.
 *
 * @param roomId      Room whose vault is the source
 * @param destination Base58 recipient public key
 * @param amount      Token amount in smallest unit
 * @param mint        Base58 SPL token mint address
 * @param decimals    Token decimals (default 9)
 * @returns Transaction signature (base58)
 */
export async function transferSPLFromVault(
  roomId: string,
  destination: string,
  amount: bigint,
  mint: string,
  decimals: number = 9,
): Promise<string> {
  const {
    getAssociatedTokenAddress,
    createTransferCheckedInstruction,
    createAssociatedTokenAccountInstruction,
    getAccount,
  } = await import('@solana/spl-token');

  const connection = getConnection();
  const vaultKeypair = getVaultKeypair(roomId);
  const mintPubkey = new PublicKey(mint);
  const destPubkey = new PublicKey(destination);

  const sourceATA = await getAssociatedTokenAddress(mintPubkey, vaultKeypair.publicKey);
  const destATA = await getAssociatedTokenAddress(mintPubkey, destPubkey);

  const transaction = new Transaction();

  // Create destination ATA if it doesn't exist
  try {
    await getAccount(connection, destATA);
  } catch {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        vaultKeypair.publicKey, // payer
        destATA,
        destPubkey,
        mintPubkey,
      ),
    );
  }

  transaction.add(
    createTransferCheckedInstruction(
      sourceATA,
      mintPubkey,
      destATA,
      vaultKeypair.publicKey,
      amount,
      decimals,
    ),
  );

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [vaultKeypair],
    { commitment: 'confirmed' },
  );

  return signature;
}

/**
 * Query the on-chain SOL balance of a room's vault.
 *
 * @param roomId Room ID
 * @returns Balance in lamports
 */
export async function getVaultBalance(roomId: string): Promise<bigint> {
  const connection = getConnection();
  const keypair = getVaultKeypair(roomId);
  const balance = await connection.getBalance(keypair.publicKey, 'confirmed');
  return BigInt(balance);
}

/**
 * Clear the keypair cache. Useful for testing.
 */
export function clearKeypairCache(): void {
  keypairCache.clear();
}
