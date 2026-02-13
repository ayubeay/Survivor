use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

declare_id!("Ca4DHFBvQ8PJurgZH5H5K7XaV4KiYYRcg4ZNDWcLLzNm"); // Replace with actual program ID after `anchor keys list`

#[program]
pub mod survivor {
    use super::*;

    /// Creates a new WorkContract between payer and payee.
    /// No funds move yet — this just establishes the agreement.
    pub fn create_work_contract(
        ctx: Context<CreateWorkContract>,
        amount: u64,
        deadline_ts: i64,
        grace_period_seconds: i64, // how long after deadline before reclaim is allowed
        contract_id: String,       // unique human-readable ID (e.g., "wc_abc123")
    ) -> Result<()> {
        require!(amount > 0, SurvivorError::InvalidAmount);
        require!(deadline_ts > Clock::get()?.unix_timestamp, SurvivorError::DeadlineInPast);
        require!(grace_period_seconds >= 259_200, SurvivorError::GracePeriodTooShort); // min 72 hours
        require!(contract_id.len() <= 32, SurvivorError::ContractIdTooLong);

        let wc = &mut ctx.accounts.work_contract;
        wc.payer = ctx.accounts.payer.key();
        wc.payee = ctx.accounts.payee.key();
        wc.survivor_authority = ctx.accounts.survivor_authority.key();
        wc.mint = ctx.accounts.mint.key();
        wc.amount = amount;
        wc.deadline_ts = deadline_ts;
        wc.grace_period_seconds = grace_period_seconds;
        wc.status = ContractStatus::Created;
        wc.resolution = Resolution::None;
        wc.contract_id = contract_id;
        wc.created_at = Clock::get()?.unix_timestamp;
        wc.resolved_at = 0;
        wc.challenge_deadline = 0;
        wc.bump = ctx.bumps.work_contract;
        wc.vault_bump = ctx.bumps.vault;
        wc.vault_authority_bump = ctx.bumps.vault_authority;

        emit!(ContractCreated {
            work_contract: wc.key(),
            payer: wc.payer,
            payee: wc.payee,
            amount: wc.amount,
            deadline_ts: wc.deadline_ts,
            contract_id: wc.contract_id.clone(),
        });

        Ok(())
    }

    /// Payer locks USDC into the contract vault.
    pub fn fund_work_contract(ctx: Context<FundWorkContract>) -> Result<()> {
        let wc = &mut ctx.accounts.work_contract;
        require!(wc.status == ContractStatus::Created, SurvivorError::InvalidStatus);

        // Transfer tokens from payer's ATA to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.payer_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, wc.amount)?;

        wc.status = ContractStatus::Funded;

        emit!(ContractFunded {
            work_contract: wc.key(),
            amount: wc.amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Survivor authority pauses the contract during a dispute.
    /// Prevents any resolution until dispute is handled.
    pub fn pause(ctx: Context<SurvivorAction>) -> Result<()> {
        let wc = &mut ctx.accounts.work_contract;
        require!(wc.status == ContractStatus::Funded, SurvivorError::InvalidStatus);

        wc.status = ContractStatus::Paused;

        emit!(ContractPaused {
            work_contract: wc.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Survivor authority proposes a resolution.
    /// Starts a 48-hour challenge window before funds move.
    pub fn resolve(
        ctx: Context<SurvivorAction>,
        outcome: ResolutionOutcome,
        split_bps_payee: u16, // basis points to payee (e.g., 7000 = 70%), only used if outcome == Split
    ) -> Result<()> {
        let wc = &mut ctx.accounts.work_contract;
        require!(
            wc.status == ContractStatus::Funded || wc.status == ContractStatus::Paused,
            SurvivorError::InvalidStatus
        );

        if outcome == ResolutionOutcome::Split {
            require!(split_bps_payee <= 10_000, SurvivorError::InvalidSplitBps);
        }

        let now = Clock::get()?.unix_timestamp;
        let challenge_window: i64 = 172_800; // 48 hours in seconds

        wc.status = ContractStatus::PendingResolution;
        wc.resolution = match outcome {
            ResolutionOutcome::Release => Resolution::Release,
            ResolutionOutcome::Refund => Resolution::Refund,
            ResolutionOutcome::Split => Resolution::Split { bps_payee: split_bps_payee },
        };
        wc.challenge_deadline = now + challenge_window;

        emit!(ResolutionProposed {
            work_contract: wc.key(),
            outcome,
            split_bps_payee,
            challenge_deadline: wc.challenge_deadline,
            timestamp: now,
        });

        Ok(())
    }

    /// Either party can challenge a proposed resolution within the 48h window.
    /// This escalates to human review.
    pub fn challenge(ctx: Context<ChallengeResolution>) -> Result<()> {
        let wc = &mut ctx.accounts.work_contract;
        require!(wc.status == ContractStatus::PendingResolution, SurvivorError::InvalidStatus);

        let now = Clock::get()?.unix_timestamp;
        require!(now < wc.challenge_deadline, SurvivorError::ChallengeWindowClosed);

        // Verify challenger is payer or payee
        let challenger = ctx.accounts.challenger.key();
        require!(
            challenger == wc.payer || challenger == wc.payee,
            SurvivorError::Unauthorized
        );

        wc.status = ContractStatus::Escalated;

        emit!(ResolutionChallenged {
            work_contract: wc.key(),
            challenger,
            timestamp: now,
        });

        Ok(())
    }

    /// Execute a resolution after the challenge window has passed (unchallenged),
    /// OR after human review for escalated disputes.
    /// Moves actual funds.
    pub fn execute_resolution(ctx: Context<ExecuteResolution>) -> Result<()> {
        let wc = &mut ctx.accounts.work_contract;
        let now = Clock::get()?.unix_timestamp;

        match wc.status {
            // Unchallenged — challenge window must have passed
            ContractStatus::PendingResolution => {
                require!(now >= wc.challenge_deadline, SurvivorError::ChallengeWindowOpen);
            }
            // Escalated — only survivor_authority can execute after human review
            ContractStatus::Escalated => {
                // survivor_authority is already verified by account constraint
            }
            _ => return Err(SurvivorError::InvalidStatus.into()),
        }

        // Build vault authority seeds for signing
        let wc_key = wc.key();
        let vault_seeds: &[&[u8]] = &[
            b"vault_authority",
            wc_key.as_ref(),
            &[wc.vault_authority_bump],
        ];
        let signer_seeds = &[vault_seeds];

        match wc.resolution {
            Resolution::Release => {
                // 100% to payee
                let transfer_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.payee_token_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    },
                    signer_seeds,
                );
                token::transfer(transfer_ctx, wc.amount)?;
            }
            Resolution::Refund => {
                // 100% to payer
                let transfer_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.payer_token_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    },
                    signer_seeds,
                );
                token::transfer(transfer_ctx, wc.amount)?;
            }
            Resolution::Split { bps_payee } => {
                let payee_amount = (wc.amount as u128)
                    .checked_mul(bps_payee as u128)
                    .unwrap()
                    .checked_div(10_000)
                    .unwrap() as u64;
                let payer_amount = wc.amount.checked_sub(payee_amount).unwrap();

                if payee_amount > 0 {
                    let transfer_ctx = CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.vault.to_account_info(),
                            to: ctx.accounts.payee_token_account.to_account_info(),
                            authority: ctx.accounts.vault_authority.to_account_info(),
                        },
                        signer_seeds,
                    );
                    token::transfer(transfer_ctx, payee_amount)?;
                }
                if payer_amount > 0 {
                    let transfer_ctx = CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.vault.to_account_info(),
                            to: ctx.accounts.payer_token_account.to_account_info(),
                            authority: ctx.accounts.vault_authority.to_account_info(),
                        },
                        signer_seeds,
                    );
                    token::transfer(transfer_ctx, payer_amount)?;
                }
            }
            Resolution::None => return Err(SurvivorError::NoResolutionSet.into()),
        }

        wc.status = ContractStatus::Resolved;
        wc.resolved_at = now;

        emit!(ContractResolved {
            work_contract: wc.key(),
            resolution: wc.resolution.clone(),
            timestamp: now,
        });

        Ok(())
    }

    /// Dead man's switch: payer reclaims funds if deadline + grace period has passed
    /// and no resolution was executed.
    pub fn reclaim_after_timeout(ctx: Context<ReclaimTimeout>) -> Result<()> {
        let wc = &mut ctx.accounts.work_contract;
        let now = Clock::get()?.unix_timestamp;

        // Must be past deadline + grace period
        let reclaim_time = wc.deadline_ts
            .checked_add(wc.grace_period_seconds)
            .ok_or(SurvivorError::Overflow)?;
        require!(now > reclaim_time, SurvivorError::TooEarlyToReclaim);

        // Cannot reclaim if already resolved
        require!(wc.status != ContractStatus::Resolved, SurvivorError::AlreadyResolved);

        // Must be funded (or paused/pending/escalated — anything with funds locked)
        require!(wc.status != ContractStatus::Created, SurvivorError::NotFunded);

        // Transfer everything back to payer
        let wc_key = wc.key();
        let vault_seeds: &[&[u8]] = &[
            b"vault_authority",
            wc_key.as_ref(),
            &[wc.vault_authority_bump],
        ];
        let signer_seeds = &[vault_seeds];

        let vault_balance = ctx.accounts.vault.amount;

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.payer_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, vault_balance)?;

        wc.status = ContractStatus::Resolved;
        wc.resolution = Resolution::Refund;
        wc.resolved_at = now;

        emit!(ContractReclaimed {
            work_contract: wc.key(),
            payer: wc.payer,
            amount: vault_balance,
            timestamp: now,
        });

        Ok(())
    }
}

// ============================================================
// ACCOUNT STRUCTS
// ============================================================

#[account]
pub struct WorkContract {
    pub payer: Pubkey,                // 32
    pub payee: Pubkey,                // 32
    pub survivor_authority: Pubkey,   // 32
    pub mint: Pubkey,                 // 32
    pub amount: u64,                  // 8
    pub deadline_ts: i64,             // 8
    pub grace_period_seconds: i64,    // 8
    pub status: ContractStatus,       // 1
    pub resolution: Resolution,       // 1 + 2 (enum + optional bps)
    pub contract_id: String,          // 4 + 32 (max)
    pub created_at: i64,              // 8
    pub resolved_at: i64,             // 8
    pub challenge_deadline: i64,      // 8
    pub bump: u8,                     // 1
    pub vault_bump: u8,               // 1
    pub vault_authority_bump: u8,    // 1
}

// Conservative space allocation: 32*4 + 8*5 + 1 + 3 + 36 + 8*2 + 1*2 = 220 bytes + 8 discriminator
const WORK_CONTRACT_SIZE: usize = 8 + 32 * 4 + 8 * 5 + 1 + 3 + 4 + 32 + 1 + 1 + 64; // 264 with padding

// ============================================================
// ENUMS
// ============================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ContractStatus {
    Created,           // Agreement exists, not funded
    Funded,            // USDC locked in vault
    Paused,            // Dispute opened, funds frozen
    PendingResolution, // Resolution proposed, challenge window active
    Escalated,         // Challenged, awaiting human review
    Resolved,          // Terminal state, funds distributed
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Resolution {
    None,
    Release,                      // 100% to payee
    Refund,                       // 100% to payer
    Split { bps_payee: u16 },     // basis points to payee, remainder to payer
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ResolutionOutcome {
    Release,
    Refund,
    Split,
}

// ============================================================
// ACCOUNT CONSTRAINTS (CONTEXTS)
// ============================================================

#[derive(Accounts)]
#[instruction(amount: u64, deadline_ts: i64, grace_period_seconds: i64, contract_id: String)]
pub struct CreateWorkContract<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: payee is just stored, doesn't sign at creation
    pub payee: UncheckedAccount<'info>,

    /// CHECK: survivor backend signer pubkey, stored for later auth checks
    pub survivor_authority: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = WORK_CONTRACT_SIZE,
        seeds = [b"work_contract", contract_id.as_bytes()],
        bump,
    )]
    pub work_contract: Account<'info, WorkContract>,

    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = vault_authority,
        seeds = [b"vault", work_contract.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as vault token authority — no data, just a signing authority
    #[account(
        seeds = [b"vault_authority", work_contract.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct FundWorkContract<'info> {
    #[account(
        mut,
        constraint = work_contract.payer == payer.key() @ SurvivorError::Unauthorized,
    )]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = work_contract.status == ContractStatus::Created @ SurvivorError::InvalidStatus,
    )]
    pub work_contract: Account<'info, WorkContract>,

    #[account(
        mut,
        constraint = payer_token_account.owner == payer.key(),
        constraint = payer_token_account.mint == work_contract.mint,
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", work_contract.key().as_ref()],
        bump = work_contract.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Used for pause + resolve — requires survivor_authority signature
#[derive(Accounts)]
pub struct SurvivorAction<'info> {
    #[account(
        constraint = survivor_authority.key() == work_contract.survivor_authority @ SurvivorError::Unauthorized,
    )]
    pub survivor_authority: Signer<'info>,

    #[account(mut)]
    pub work_contract: Account<'info, WorkContract>,
}

#[derive(Accounts)]
pub struct ChallengeResolution<'info> {
    pub challenger: Signer<'info>,

    #[account(mut)]
    pub work_contract: Account<'info, WorkContract>,
}

#[derive(Accounts)]
pub struct ExecuteResolution<'info> {
    #[account(
        constraint = survivor_authority.key() == work_contract.survivor_authority @ SurvivorError::Unauthorized,
    )]
    pub survivor_authority: Signer<'info>,

    #[account(mut)]
    pub work_contract: Account<'info, WorkContract>,

    #[account(
        mut,
        seeds = [b"vault", work_contract.key().as_ref()],
        bump = work_contract.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA vault authority for signing transfers
    #[account(
        seeds = [b"vault_authority", work_contract.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// CHECK: validated against work_contract.payer
    #[account(
        mut,
        constraint = payer_token_account.owner == work_contract.payer,
        constraint = payer_token_account.mint == work_contract.mint,
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// CHECK: validated against work_contract.payee
    #[account(
        mut,
        constraint = payee_token_account.owner == work_contract.payee,
        constraint = payee_token_account.mint == work_contract.mint,
    )]
    pub payee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReclaimTimeout<'info> {
    #[account(
        constraint = payer.key() == work_contract.payer @ SurvivorError::Unauthorized,
    )]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub work_contract: Account<'info, WorkContract>,

    #[account(
        mut,
        seeds = [b"vault", work_contract.key().as_ref()],
        bump = work_contract.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA vault authority
    #[account(
        seeds = [b"vault_authority", work_contract.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = payer_token_account.owner == payer.key(),
        constraint = payer_token_account.mint == work_contract.mint,
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ============================================================
// EVENTS (for Helius / webhook indexing)
// ============================================================

#[event]
pub struct ContractCreated {
    pub work_contract: Pubkey,
    pub payer: Pubkey,
    pub payee: Pubkey,
    pub amount: u64,
    pub deadline_ts: i64,
    pub contract_id: String,
}

#[event]
pub struct ContractFunded {
    pub work_contract: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct ContractPaused {
    pub work_contract: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ResolutionProposed {
    pub work_contract: Pubkey,
    pub outcome: ResolutionOutcome,
    pub split_bps_payee: u16,
    pub challenge_deadline: i64,
    pub timestamp: i64,
}

#[event]
pub struct ResolutionChallenged {
    pub work_contract: Pubkey,
    pub challenger: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ContractResolved {
    pub work_contract: Pubkey,
    pub resolution: Resolution,
    pub timestamp: i64,
}

#[event]
pub struct ContractReclaimed {
    pub work_contract: Pubkey,
    pub payer: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ============================================================
// ERRORS
// ============================================================

#[error_code]
pub enum SurvivorError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Grace period must be at least 72 hours")]
    GracePeriodTooShort,
    #[msg("Contract ID too long (max 32 chars)")]
    ContractIdTooLong,
    #[msg("Invalid contract status for this operation")]
    InvalidStatus,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Split basis points must be <= 10000")]
    InvalidSplitBps,
    #[msg("Challenge window still open")]
    ChallengeWindowOpen,
    #[msg("Challenge window has closed")]
    ChallengeWindowClosed,
    #[msg("No resolution has been set")]
    NoResolutionSet,
    #[msg("Too early to reclaim — deadline + grace period not reached")]
    TooEarlyToReclaim,
    #[msg("Contract already resolved")]
    AlreadyResolved,
    #[msg("Contract not funded")]
    NotFunded,
    #[msg("Arithmetic overflow")]
    Overflow,
}
