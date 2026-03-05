use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("BNerVniNUJixgets2bKFtSbcpSFpCSjhapcNnJf4V35i");

pub mod state;
use state::*;

#[program]
pub mod goldenflop {
    use super::*;

    /// Create a new game. The Game PDA doubles as the escrow pot.
    /// Only the backend authority can create games.
    pub fn create_game(ctx: Context<CreateGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.authority = ctx.accounts.authority.key();
        game.game_id = game_id;
        game.status = GameStatus::Open;
        game.player_count = 0;
        game.players = Default::default();
        game.pot = 0;
        game.result_hash = [0u8; 32];
        game.winner = Pubkey::default();
        game.settled_amount = 0;
        game.bump = ctx.bumps.game;

        msg!("Game {} created by {}", game_id, game.authority);
        Ok(())
    }

    /// Player deposits SOL into the escrow pot (Game PDA).
    /// Transfer goes directly from player wallet to the Game account.
    pub fn join_game(ctx: Context<JoinGame>, amount: u64) -> Result<()> {
        require!(amount > 0, GoldenflopError::InvalidDeposit);

        {
            let game = &ctx.accounts.game;
            require!(game.status == GameStatus::Open, GoldenflopError::GameNotOpen);
            require!(game.player_count < MAX_PLAYERS, GoldenflopError::GameFull);

            // Check player hasn't already deposited
            let player_key = ctx.accounts.player.key();
            for slot in game.players.iter().flatten() {
                require!(slot.wallet != player_key, GoldenflopError::AlreadyJoined);
            }
        }

        // Transfer SOL from player to Game PDA (escrow)
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.game.to_account_info(),
                },
            ),
            amount,
        )?;

        // Record deposit
        let game = &mut ctx.accounts.game;
        let player_key = ctx.accounts.player.key();
        let seat = game.player_count as usize;
        game.players[seat] = Some(PlayerDeposit {
            wallet: player_key,
            amount,
        });
        game.player_count += 1;
        game.pot = game.pot.checked_add(amount).ok_or(GoldenflopError::Overflow)?;

        msg!(
            "Player {} deposited {} lamports (seat {}). Pot: {}",
            player_key, amount, seat, game.pot
        );
        Ok(())
    }

    /// Backend commits the SHA-256 hash of the game result and declares the winner.
    /// Only the authority can call this. Must be called before settle_pot.
    pub fn commit_result_hash(
        ctx: Context<CommitResultHash>,
        result_hash: [u8; 32],
        winner: Pubkey,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Open, GoldenflopError::GameNotOpen);
        require!(result_hash != [0u8; 32], GoldenflopError::InvalidHash);

        // Verify winner is actually a player in this game
        let is_player = game.players.iter().flatten().any(|p| p.wallet == winner);
        require!(is_player, GoldenflopError::WinnerNotInGame);

        game.result_hash = result_hash;
        game.winner = winner;
        game.status = GameStatus::Committed;

        msg!(
            "Game {} result committed. Winner: {}. Hash: {:?}",
            game.game_id, winner, &result_hash[..8]
        );
        Ok(())
    }

    /// Settle the pot: transfer all escrowed SOL from Game PDA to winner.
    /// Only the authority can call this. Can only settle once.
    pub fn settle_pot(ctx: Context<SettlePot>) -> Result<()> {
        let pot_amount;
        {
            let game = &ctx.accounts.game;
            require!(game.status == GameStatus::Committed, GoldenflopError::NotCommitted);
            require!(game.winner == ctx.accounts.winner.key(), GoldenflopError::WinnerMismatch);
            pot_amount = game.pot;
            require!(pot_amount > 0, GoldenflopError::EmptyPot);
        }

        // Transfer lamports from Game PDA to winner.
        // PDA-owned accounts can transfer lamports by directly mutating lamport balances.
        let game_info = ctx.accounts.game.to_account_info();
        let winner_info = ctx.accounts.winner.to_account_info();

        **game_info.try_borrow_mut_lamports()? = game_info
            .lamports()
            .checked_sub(pot_amount)
            .ok_or(GoldenflopError::Overflow)?;
        **winner_info.try_borrow_mut_lamports()? = winner_info
            .lamports()
            .checked_add(pot_amount)
            .ok_or(GoldenflopError::Overflow)?;

        let game = &mut ctx.accounts.game;
        game.settled_amount = pot_amount;
        game.pot = 0;
        game.status = GameStatus::Settled;

        msg!(
            "Game {} settled. {} lamports -> {}",
            game.game_id, pot_amount, ctx.accounts.winner.key()
        );
        Ok(())
    }
}

// ─── Account contexts ───────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Game::LEN,
        seeds = [b"game", authority.key().as_ref(), &game_id.to_le_bytes()],
        bump,
    )]
    pub game: Account<'info, Game>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.authority.as_ref(), &game.game_id.to_le_bytes()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitResultHash<'info> {
    /// The backend authority — must match game.authority
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ GoldenflopError::Unauthorized,
        seeds = [b"game", game.authority.as_ref(), &game.game_id.to_le_bytes()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct SettlePot<'info> {
    /// The backend authority — must match game.authority
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ GoldenflopError::Unauthorized,
        seeds = [b"game", game.authority.as_ref(), &game.game_id.to_le_bytes()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,

    /// CHECK: Validated against game.winner in the instruction logic.
    #[account(mut)]
    pub winner: AccountInfo<'info>,
}

// ─── Errors ─────────────────────────────────────────────────────────────────

#[error_code]
pub enum GoldenflopError {
    #[msg("Game is not open for deposits")]
    GameNotOpen,
    #[msg("Game is full")]
    GameFull,
    #[msg("Invalid deposit amount")]
    InvalidDeposit,
    #[msg("Player already joined this game")]
    AlreadyJoined,
    #[msg("Result not yet committed")]
    NotCommitted,
    #[msg("Invalid result hash")]
    InvalidHash,
    #[msg("Winner is not a player in this game")]
    WinnerNotInGame,
    #[msg("Winner pubkey does not match committed winner")]
    WinnerMismatch,
    #[msg("Pot is empty")]
    EmptyPot,
    #[msg("Unauthorized — signer is not the game authority")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
}
