use anchor_lang::prelude::*;

pub const MAX_PLAYERS: u8 = 6;

// ─── Game state ─────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum GameStatus {
    /// Accepting player deposits
    Open,
    /// Result hash committed, awaiting settlement
    Committed,
    /// Pot distributed to winner, game is done
    Settled,
}

impl Default for GameStatus {
    fn default() -> Self {
        GameStatus::Open
    }
}

/// Per-player deposit record stored on the Game account.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PlayerDeposit {
    pub wallet: Pubkey,
    pub amount: u64,
}

/// Core game account — one per hand/round.
///
/// Seeds: [b"game", authority, game_id.to_le_bytes()]
/// The escrow pot is the Game PDA itself (holds lamports).
#[account]
pub struct Game {
    /// Backend authority that controls this game
    pub authority: Pubkey,
    /// Unique game identifier (incrementing counter or timestamp)
    pub game_id: u64,
    /// Current status
    pub status: GameStatus,
    /// Number of players who have deposited
    pub player_count: u8,
    /// Player deposits (wallet + amount)
    pub players: [Option<PlayerDeposit>; MAX_PLAYERS as usize],
    /// Total lamports in the escrow pot
    pub pot: u64,
    /// SHA-256 hash of the off-chain game result (32 bytes)
    pub result_hash: [u8; 32],
    /// Winner's wallet (set during commit, paid during settle)
    pub winner: Pubkey,
    /// Settlement transaction signature (for cross-referencing)
    pub settled_amount: u64,
    /// PDA bump
    pub bump: u8,
}

// 8 (discriminator)
// + 32 (authority) + 8 (game_id) + 1 (status) + 1 (player_count)
// + 6 * (1 + 32 + 8) = 246 (players array with Option tag)
// + 8 (pot) + 32 (result_hash) + 32 (winner) + 8 (settled_amount) + 1 (bump)
const PLAYER_DEPOSIT_SIZE: usize = 1 + 32 + 8; // Option<PlayerDeposit>

impl Game {
    pub const LEN: usize = 8
        + 32        // authority
        + 8         // game_id
        + 1         // status
        + 1         // player_count
        + (MAX_PLAYERS as usize * PLAYER_DEPOSIT_SIZE) // players
        + 8         // pot
        + 32        // result_hash
        + 32        // winner
        + 8         // settled_amount
        + 1;        // bump
}
