use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token};

declare_id!("DuBh61ETcQe7dXDAaEPt7fYuLJczfuN3SuSonBdqWp3t");

#[program]
pub mod vault_test {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.token_account = ctx.accounts.vault_token_account.key();
        vault.bump = ctx.bumps.vault;

        msg!("Vault initialized!");
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user_authority.to_account_info(),
            },
        );

        token::transfer(cpi_ctx, amount)?;
        msg!("Deposited {} tokens", amount);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let auth_key = ctx.accounts.authority.key();
        
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            auth_key.as_ref(),
            &[ctx.accounts.vault.bump],
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );

        token::transfer(cpi_ctx, amount)?;
        msg!("Withdrawn {} tokens", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 1,
        seeds = [b"vault", authority.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: We're just storing this key in the vault
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub vault: Account<'info, Vault>,
    
    /// CHECK: Token Program checks this account
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,
    
    /// CHECK: Token Program checks this account
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,
    
    pub user_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"vault", authority.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
    
    /// CHECK: Token Program checks this account
    #[account(mut)]
    pub user_token_account: UncheckedAccount<'info>,
    
    /// CHECK: Token Program checks this account
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,
    
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub token_account: Pubkey,
    pub bump: u8,
}
