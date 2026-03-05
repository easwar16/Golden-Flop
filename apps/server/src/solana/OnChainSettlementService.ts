/**
 * OnChainSettlementService — bridges the off-chain game engine with
 * the on-chain GoldenFlop Anchor program.
 *
 * Flow per hand:
 *   1. createOnChainGame()   → creates Game PDA (escrow)
 *   2. [players call join_game from their wallets via the mobile app]
 *   3. commitAndSettle()     → hashes result, commits hash, settles pot
 *
 * The authority keypair is the backend's Solana signer.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import * as borsh from 'borsh';

// ─── Config ──────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  process.env.GOLDENFLOP_PROGRAM_ID ?? 'F1opGoldenFLop111111111111111111111111111',
);

const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';

// ─── Authority keypair ──────────────────────────────────────────────────────

let _authority: Keypair | null = null;

function getAuthority(): Keypair {
  if (_authority) return _authority;
  const key = process.env.SETTLEMENT_AUTHORITY_KEY;
  if (!key) throw new Error('SETTLEMENT_AUTHORITY_KEY env var not set (base58 secret key)');
  const { default: bs58 } = require('bs58') as { default: { decode: (s: string) => Uint8Array } };
  _authority = Keypair.fromSecretKey(bs58.decode(key));
  return _authority;
}

function getConnection(): Connection {
  return new Connection(SOLANA_RPC, 'confirmed');
}

// ─── PDA derivation ─────────────────────────────────────────────────────────

export function deriveGamePDA(authority: PublicKey, gameId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(gameId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game'), authority.toBuffer(), buf],
    PROGRAM_ID,
  );
}

// ─── Result hashing ─────────────────────────────────────────────────────────

export interface GameResultPayload {
  gameId: string;
  players: Array<{
    wallet: string;
    startChips: number;
    endChips: number;
    actions: string[];
  }>;
  communityCards: string[];
  winner: string;
  potSize: number;
  rake?: number;
  timestamp: number;
}

/**
 * Deterministic SHA-256 hash of a game result.
 * Uses sorted JSON keys for canonical serialization.
 */
export function hashGameResult(result: GameResultPayload): Buffer {
  const canonical = JSON.stringify(result, Object.keys(result).sort());
  return createHash('sha256').update(canonical).digest();
}

// ─── Anchor instruction discriminators ──────────────────────────────────────
// Anchor uses sha256("global:<method_name>")[0..8] as the 8-byte discriminator.

function anchorDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

// ─── Instruction builders (manual — avoids needing IDL at runtime) ──────────

function buildCreateGameIx(
  authority: PublicKey,
  gamePDA: PublicKey,
  gameId: bigint,
): TransactionInstruction {
  const disc = anchorDiscriminator('create_game');
  const data = Buffer.alloc(8 + 8);
  disc.copy(data, 0);
  data.writeBigUInt64LE(gameId, 8);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildCommitResultHashIx(
  authority: PublicKey,
  gamePDA: PublicKey,
  resultHash: Buffer,
  winner: PublicKey,
): TransactionInstruction {
  const disc = anchorDiscriminator('commit_result_hash');
  // data: 8 (disc) + 32 (hash) + 32 (winner pubkey)
  const data = Buffer.alloc(8 + 32 + 32);
  disc.copy(data, 0);
  resultHash.copy(data, 8);
  winner.toBuffer().copy(data, 40);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
    ],
    data,
  });
}

function buildSettlePotIx(
  authority: PublicKey,
  gamePDA: PublicKey,
  winner: PublicKey,
): TransactionInstruction {
  const disc = anchorDiscriminator('settle_pot');
  const data = Buffer.from(disc);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
      { pubkey: winner, isSigner: false, isWritable: true },
    ],
    data,
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create an on-chain game (escrow PDA).
 * Call this at the start of a hand when players are seated.
 *
 * @returns The game PDA public key and the game ID
 */
export async function createOnChainGame(): Promise<{ gamePDA: PublicKey; gameId: bigint }> {
  const authority = getAuthority();
  const connection = getConnection();
  const gameId = BigInt(Date.now());
  const [gamePDA] = deriveGamePDA(authority.publicKey, gameId);

  const ix = buildCreateGameIx(authority.publicKey, gamePDA, gameId);
  const tx = new Transaction().add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log(`[OnChainSettlement] Game created: ${gamePDA.toBase58()} (tx: ${sig})`);

  return { gamePDA, gameId };
}

/**
 * Commit the game result hash and settle the pot in a single transaction.
 * This is called by the backend after a hand completes.
 *
 * Batches commit_result_hash + settle_pot into one tx for atomicity.
 *
 * @returns Transaction signature
 */
export async function commitAndSettle(
  gameId: bigint,
  result: GameResultPayload,
): Promise<string> {
  const authority = getAuthority();
  const connection = getConnection();
  const [gamePDA] = deriveGamePDA(authority.publicKey, gameId);

  const resultHash = hashGameResult(result);
  const winner = new PublicKey(result.winner);

  // Batch both instructions into a single atomic transaction
  const tx = new Transaction()
    .add(buildCommitResultHashIx(authority.publicKey, gamePDA, resultHash, winner))
    .add(buildSettlePotIx(authority.publicKey, gamePDA, winner));

  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);

  console.log(
    `[OnChainSettlement] Game ${gameId} settled. ` +
    `Winner: ${winner.toBase58()}. Hash: ${resultHash.toString('hex').slice(0, 16)}... (tx: ${sig})`,
  );

  return sig;
}

/**
 * Get the Game PDA address for a given game ID.
 * Useful for the mobile app to know where to send join_game deposits.
 */
export function getGameAddress(gameId: bigint): PublicKey {
  const authority = getAuthority();
  const [gamePDA] = deriveGamePDA(authority.publicKey, gameId);
  return gamePDA;
}

/**
 * Verify a game result against its on-chain hash.
 * Anyone can call this — no authority needed.
 */
export async function verifyGameResult(
  gameId: bigint,
  result: GameResultPayload,
): Promise<boolean> {
  const authority = getAuthority();
  const connection = getConnection();
  const [gamePDA] = deriveGamePDA(authority.publicKey, gameId);

  const accountInfo = await connection.getAccountInfo(gamePDA);
  if (!accountInfo) return false;

  // The result_hash is at a fixed offset in the account data.
  // Skip: 8 (disc) + 32 (authority) + 8 (game_id) + 1 (status) + 1 (player_count)
  //   + 6 * 41 (players) + 8 (pot) = 304
  const HASH_OFFSET = 8 + 32 + 8 + 1 + 1 + (6 * 41) + 8;
  const onChainHash = accountInfo.data.subarray(HASH_OFFSET, HASH_OFFSET + 32);

  const computedHash = hashGameResult(result);
  return computedHash.equals(Buffer.from(onChainHash));
}
