use anchor_lang::prelude::*;

pub const MAX_PLAYERS: u8 = 9;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub struct PlayerSlot {
    pub authority: Pubkey,
    pub session_key: Pubkey,
    pub chips: u64,
    pub in_hand: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum TableState {
    WaitingForPlayers,
    BetweenHands,
    InHand,
}

impl Default for TableState {
    fn default() -> Self {
        TableState::WaitingForPlayers
    }
}

#[account]
pub struct Table {
    pub creator: Pubkey,
    pub small_blind: u64,
    pub big_blind: u64,
    pub min_buy_in: u64,
    pub max_buy_in: u64,
    pub pot: u64,
    pub state: TableState,
    /// Placeholder for VRF result (Switchboard); used as deck seed for shuffle.
    pub deck_seed: u64,
    pub bump: u8,
    pub player_count: u8,
    pub players: [Option<PlayerSlot>; MAX_PLAYERS as usize],
}

const PLAYER_SLOT_SIZE: usize = 1 + 32 + 32 + 8 + 1; // Option<PlayerSlot>

impl Table {
    pub const LEN: usize = 8
        + 32
        + (8 * 4)
        + 8
        + 1
        + 8
        + 1
        + 1
        + (MAX_PLAYERS as usize * PLAYER_SLOT_SIZE);
}

impl Table {
    pub fn find_player(&self, authority: Pubkey) -> Result<usize> {
        for (i, slot) in self.players.iter().enumerate() {
            if let Some(s) = slot {
                if s.authority == authority {
                    return Ok(i);
                }
            }
        }
        err!(crate::GoldenflopError::PlayerNotFound)
    }

    pub fn compact_players(&mut self) -> Result<()> {
        let mut write = 0;
        for read in 0..MAX_PLAYERS as usize {
            if self.players[read].is_some() {
                if write != read {
                    self.players[write] = self.players[read].take();
                }
                write += 1;
            }
        }
        for i in write..MAX_PLAYERS as usize {
            self.players[i] = None;
        }
        self.player_count = write as u8;
        Ok(())
    }
}

#[account]
pub struct Session {
    pub authority: Pubkey,
    pub ephemeral_signer: Pubkey,
    pub table: Pubkey,
    pub created_at: i64,
    pub expiry: i64,
    pub bump: u8,
}

impl Session {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}
