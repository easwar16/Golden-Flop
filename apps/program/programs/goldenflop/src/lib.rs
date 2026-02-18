use anchor_lang::prelude::*;

declare_id!("F1opGoldenFLop111111111111111111111111111");

pub mod state;

use state::*;

#[program]
pub mod goldenflop {
    use super::*;

    /// Create a new poker table with blinds and stake limits.
    pub fn create_table(
        ctx: Context<CreateTable>,
        small_blind: u64,
        big_blind: u64,
        min_buy_in: u64,
        max_buy_in: u64,
    ) -> Result<()> {
        let table = &mut ctx.accounts.table;
        table.creator = ctx.accounts.creator.key();
        table.small_blind = small_blind;
        table.big_blind = big_blind;
        table.min_buy_in = min_buy_in;
        table.max_buy_in = max_buy_in;
        table.pot = 0;
        table.state = TableState::WaitingForPlayers;
        table.deck_seed = 0; // Placeholder; replace with VRF result (e.g. Switchboard)
        table.bump = ctx.bumps.table;
        table.player_count = 0;
        Ok(())
    }

    /// Join a table (buy-in). Requires main wallet signature.
    pub fn join_table(ctx: Context<JoinTable>, buy_in_lamports: u64) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::WaitingForPlayers || table.state == TableState::BetweenHands, GoldenflopError::InvalidTableState);
        require!(table.player_count < MAX_PLAYERS, GoldenflopError::TableFull);
        require!(buy_in_lamports >= table.min_buy_in && buy_in_lamports <= table.max_buy_in, GoldenflopError::InvalidBuyIn);

        let seat = table.player_count as usize;
        table.players[seat] = Some(PlayerSlot {
            authority: ctx.accounts.player.key(),
            session_key: Pubkey::default(),
            chips: buy_in_lamports,
            in_hand: true,
        });
        table.player_count += 1;
        Ok(())
    }

    /// Register a session key for in-game actions (signed by main wallet once).
    pub fn create_session(
        ctx: Context<CreateSession>,
        ephemeral_signer: Pubkey,
        expiry_ts: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(expiry_ts > clock.unix_timestamp, GoldenflopError::SessionExpired);

        let session = &mut ctx.accounts.session;
        session.authority = ctx.accounts.authority.key();
        session.ephemeral_signer = ephemeral_signer;
        session.table = ctx.accounts.table.key();
        session.created_at = clock.unix_timestamp;
        session.expiry = expiry_ts;
        session.bump = ctx.bumps.session;

        let table = &mut ctx.accounts.table;
        let player_index = table.find_player(ctx.accounts.authority.key())?;
        table.players[player_index].as_mut().unwrap().session_key = ephemeral_signer;
        Ok(())
    }

    /// In-game action (bet, fold, call, raise, all-in). Must be signed by session key.
    pub fn action(ctx: Context<Action>, game_action: GameAction) -> Result<()> {
        let session = &ctx.accounts.session;
        let clock = Clock::get()?;
        require!(clock.unix_timestamp < session.expiry, GoldenflopError::SessionExpired);
        require!(ctx.accounts.signer.key() == session.ephemeral_signer, GoldenflopError::InvalidSigner);

        let table = &mut ctx.accounts.table;
        let player_index = table.find_player(session.authority)?;
        let slot = table.players[player_index].as_mut().ok_or(GoldenflopError::PlayerNotFound)?;
        require!(slot.in_hand, GoldenflopError::NotInHand);

        match game_action {
            GameAction::Fold => {
                slot.in_hand = false;
            }
            GameAction::Call => {
                // For simplicity: add current_bet - slot.bet_this_round to pot (would need current_bet on table)
                table.pot += table.big_blind; // Placeholder
            }
            GameAction::Bet(amount) => {
                require!(amount <= slot.chips, GoldenflopError::InsufficientChips);
                slot.chips -= amount;
                table.pot += amount;
            }
            GameAction::Raise(amount) => {
                require!(amount <= slot.chips, GoldenflopError::InsufficientChips);
                slot.chips -= amount;
                table.pot += amount;
            }
            GameAction::AllIn => {
                table.pot += slot.chips;
                slot.chips = 0;
            }
        }
        Ok(())
    }

    /// Leave table and settle. Requires main wallet.
    pub fn leave_table(ctx: Context<LeaveTable>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let player_index = table.find_player(ctx.accounts.player.key())?;
        table.players[player_index] = None;
        table.compact_players()?;
        Ok(())
    }

    /// Revoke a session key.
    pub fn revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
        let session = &ctx.accounts.session;
        require!(ctx.accounts.authority.key() == session.authority, GoldenflopError::InvalidSigner);
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum GameAction {
    Fold,
    Call,
    Bet(u64),
    Raise(u64),
    AllIn,
}

#[derive(Accounts)]
pub struct CreateTable<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Table::LEN,
        seeds = [b"table", creator.key().as_ref()],
        bump
    )]
    pub table: Account<'info, Table>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinTable<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"table", table.creator.as_ref()],
        bump = table.bump,
    )]
    pub table: Account<'info, Table>,
}

#[derive(Accounts)]
pub struct CreateSession<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"table", table.creator.as_ref()],
        bump = table.bump,
    )]
    pub table: Account<'info, Table>,

    #[account(
        init,
        payer = authority,
        space = Session::LEN,
        seeds = [b"session", authority.key().as_ref(), table.key().as_ref()],
        bump
    )]
    pub session: Account<'info, Session>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Action<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"table", table.creator.as_ref()],
        bump = table.bump,
    )]
    pub table: Account<'info, Table>,

    #[account(
        seeds = [b"session", session.authority.as_ref(), table.key().as_ref()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct LeaveTable<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"table", table.creator.as_ref()],
        bump = table.bump,
    )]
    pub table: Account<'info, Table>,
}

#[derive(Accounts)]
pub struct RevokeSession<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [b"session", session.authority.as_ref(), session.table.as_ref()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,
}

#[error_code]
pub enum GoldenflopError {
    #[msg("Invalid table state for this action")]
    InvalidTableState,
    #[msg("Table is full")]
    TableFull,
    #[msg("Buy-in out of range")]
    InvalidBuyIn,
    #[msg("Session expired")]
    SessionExpired,
    #[msg("Signer is not the session key")]
    InvalidSigner,
    #[msg("Player not found at table")]
    PlayerNotFound,
    #[msg("Player not in current hand")]
    NotInHand,
    #[msg("Insufficient chips")]
    InsufficientChips,
}
