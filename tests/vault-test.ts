import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultTest } from "../target/types/vault_test";
import { Keypair, PublicKey, SystemProgram, Connection } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("vault-test", () => {
  // Configure the client to use devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.VaultTest as Program<VaultTest>;
  
  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let vaultTokenAccount: PublicKey;
  let vaultPDA: PublicKey;
  let vaultBump: number;

  const DECIMALS = 9;
  const INITIAL_MINT_AMOUNT = 1000_000_000_000; // 1000 tokens
  const DEPOSIT_AMOUNT = 500_000_000_000; // 500 tokens
  const WITHDRAW_AMOUNT = 200_000_000_000; // 200 tokens

  async function getTokenBalance(tokenAccount: PublicKey): Promise<number> {
    const account = await getAccount(connection, tokenAccount);
    return Number(account.amount);
  }

  async function logTransaction(signature: string, operation: string) {
    console.log(`\n🔗 ${operation} Transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  }

  before(async () => {
    try {
      console.log("\n=== Setup Starting ===");
      console.log("👤 Using wallet:", provider.wallet.publicKey.toString());
      
      // Create mint
      mint = await createMint(
        connection,
        provider.wallet.payer,
        provider.wallet.publicKey,
        null,
        DECIMALS
      );
      console.log("🪙 Created mint:", mint.toBase58());

      // Find PDA for vault
      [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), provider.wallet.publicKey.toBuffer()],
        program.programId
      );
      console.log("🔐 Vault PDA:", vaultPDA.toBase58());

      // Create user token account
      const userATA = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        mint,
        provider.wallet.publicKey
      );
      userTokenAccount = userATA.address;
      console.log("👛 User token account:", userTokenAccount.toBase58());

      // Create vault token account
      const vaultTokenKeypair = Keypair.generate();
      vaultTokenAccount = await createAccount(
        connection,
        provider.wallet.payer,
        mint,
        vaultPDA,
        vaultTokenKeypair
      );
      console.log("🏦 Vault token account:", vaultTokenAccount.toBase58());
      console.log("=== Setup Complete ===\n");
    } catch (err) {
      console.error("❌ Error in setup:", err);
      throw err;
    }
  });

  it("Initialize Vault", async () => {
    try {
      console.log("\n=== Initializing Vault ===");
      const tx = await program.methods
        .initializeVault()
        .accounts({
          vault: vaultPDA,
          vaultTokenAccount,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      await connection.confirmTransaction(tx);
      await logTransaction(tx, "Initialize Vault");

      // Verify vault is initialized
      const vaultAccount = await program.account.vault.fetch(vaultPDA);
      assert.ok(vaultAccount.authority.equals(provider.wallet.publicKey));
      assert.ok(vaultAccount.tokenAccount.equals(vaultTokenAccount));
      console.log("✅ Vault initialized successfully");
    } catch (err) {
      console.error("❌ Error initializing vault:", err);
      throw err;
    }
  });

  it("Should fail to initialize vault twice", async () => {
    try {
      await program.methods
        .initializeVault()
        .accounts({
          vault: vaultPDA,
          vaultTokenAccount,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed to initialize vault twice");
    } catch (err) {
      console.log("Successfully prevented double initialization");
    }
  });

  it("Deposit tokens", async () => {
    try {
      console.log("\n=== Starting Deposit Test ===");
      // Mint tokens to user
      const mintTx = await mintTo(
        connection,
        provider.wallet.payer,
        mint,
        userTokenAccount,
        provider.wallet.publicKey,
        INITIAL_MINT_AMOUNT
      );
      await logTransaction(mintTx, "Mint Tokens");
      
      const initialUserBalance = await getTokenBalance(userTokenAccount);
      const initialVaultBalance = await getTokenBalance(vaultTokenAccount);
      
      console.log(`\n💰 Initial Balances:
        User: ${initialUserBalance / 10**DECIMALS} tokens
        Vault: ${initialVaultBalance / 10**DECIMALS} tokens`);

      const tx = await program.methods
        .deposit(new anchor.BN(DEPOSIT_AMOUNT))
        .accounts({
          vault: vaultPDA,
          userTokenAccount,
          vaultTokenAccount,
          userAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      await connection.confirmTransaction(tx);
      await logTransaction(tx, "Deposit");
      
      const finalUserBalance = await getTokenBalance(userTokenAccount);
      const finalVaultBalance = await getTokenBalance(vaultTokenAccount);
      
      console.log(`\n💰 Final Balances:
        User: ${finalUserBalance / 10**DECIMALS} tokens
        Vault: ${finalVaultBalance / 10**DECIMALS} tokens
        Amount Deposited: ${DEPOSIT_AMOUNT / 10**DECIMALS} tokens`);

      assert.equal(
        finalUserBalance,
        initialUserBalance - DEPOSIT_AMOUNT,
        "User balance not correctly decreased"
      );
      assert.equal(
        finalVaultBalance,
        initialVaultBalance + DEPOSIT_AMOUNT,
        "Vault balance not correctly increased"
      );
      console.log("✅ Deposit successful");
    } catch (err) {
      console.error("❌ Error depositing tokens:", err);
      throw err;
    }
  });

  it("Should fail to deposit more than balance", async () => {
    try {
      const userBalance = await getTokenBalance(userTokenAccount);
      await program.methods
        .deposit(new anchor.BN(userBalance + 1))
        .accounts({
          vault: vaultPDA,
          userTokenAccount,
          vaultTokenAccount,
          userAuthority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed to deposit more than balance");
    } catch (err) {
      console.log("Successfully prevented overdraft deposit");
    }
  });

  it("Withdraw tokens", async () => {
    try {
      console.log("\n=== Starting Withdrawal Test ===");
      const initialUserBalance = await getTokenBalance(userTokenAccount);
      const initialVaultBalance = await getTokenBalance(vaultTokenAccount);
      
      console.log(`\n💰 Initial Balances:
        User: ${initialUserBalance / 10**DECIMALS} tokens
        Vault: ${initialVaultBalance / 10**DECIMALS} tokens`);

      const tx = await program.methods
        .withdraw(new anchor.BN(WITHDRAW_AMOUNT))
        .accounts({
          vault: vaultPDA,
          userTokenAccount,
          vaultTokenAccount,
          authority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      await connection.confirmTransaction(tx);
      await logTransaction(tx, "Withdraw");
      
      const finalUserBalance = await getTokenBalance(userTokenAccount);
      const finalVaultBalance = await getTokenBalance(vaultTokenAccount);
      
      console.log(`\n💰 Final Balances:
        User: ${finalUserBalance / 10**DECIMALS} tokens
        Vault: ${finalVaultBalance / 10**DECIMALS} tokens
        Amount Withdrawn: ${WITHDRAW_AMOUNT / 10**DECIMALS} tokens`);

      assert.equal(
        finalUserBalance,
        initialUserBalance + WITHDRAW_AMOUNT,
        "User balance not correctly increased"
      );
      assert.equal(
        finalVaultBalance,
        initialVaultBalance - WITHDRAW_AMOUNT,
        "Vault balance not correctly decreased"
      );
      console.log("✅ Withdrawal successful");
    } catch (err) {
      console.error("❌ Error withdrawing tokens:", err);
      throw err;
    }
  });

  it("Should fail to withdraw more than vault balance", async () => {
    try {
      const vaultBalance = await getTokenBalance(vaultTokenAccount);
      await program.methods
        .withdraw(new anchor.BN(vaultBalance + 1))
        .accounts({
          vault: vaultPDA,
          userTokenAccount,
          vaultTokenAccount,
          authority: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed to withdraw more than vault balance");
    } catch (err) {
      console.log("Successfully prevented overdraft withdrawal");
    }
  });

  it("Should fail when non-authority tries to withdraw", async () => {
    try {
      // Create a new wallet
      const unauthorizedWallet = Keypair.generate();
      
      await program.methods
        .withdraw(new anchor.BN(1_000_000))
        .accounts({
          vault: vaultPDA,
          userTokenAccount,
          vaultTokenAccount,
          authority: unauthorizedWallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed with unauthorized withdrawal");
    } catch (err) {
      console.log("Successfully prevented unauthorized withdrawal");
    }
  });
});
