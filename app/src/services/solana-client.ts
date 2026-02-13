import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import { OnChainService } from "../agents/escalation-agent";
import { ResolutionType } from "../types";

const PROGRAM_ID = new PublicKey("Ca4DHFBvQ8PJurgZH5H5K7XaV4KiYYRcg4ZNDWcLLzNm");

// Load the real generated IDL
const idl = require("../../../target/idl/survivor.json");

function deriveWorkContractPDA(contractId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("work_contract"), Buffer.from(contractId)], PROGRAM_ID);
}
function deriveVaultPDA(wcKey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), wcKey.toBuffer()], PROGRAM_ID);
}
function deriveVaultAuthorityPDA(wcKey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), wcKey.toBuffer()], PROGRAM_ID);
}

export class SurvivorSolanaClient implements OnChainService {
  private connection: Connection;
  private provider: AnchorProvider;
  private program: Program;
  private authority: Keypair;

  constructor(config: { rpcUrl: string; survivorAuthorityKeypair: Keypair }) {
    this.authority = config.survivorAuthorityKeypair;
    this.connection = new Connection(config.rpcUrl, "confirmed");
    const wallet = new Wallet(this.authority);
    this.provider = new AnchorProvider(this.connection, wallet, { commitment: "confirmed" });
    this.program = new (Program as any)(idl, this.provider);
  }

  get programId() { return PROGRAM_ID; }
  get authorityPubkey() { return this.authority.publicKey; }

  async createWorkContract(params: {
    payerKeypair: Keypair; payee: PublicKey; mint: PublicKey;
    amount: number; deadlineTs: number; gracePeriodSeconds: number; contractId: string;
  }) {
    const [wcPDA] = deriveWorkContractPDA(params.contractId);
    const [vaultPDA] = deriveVaultPDA(wcPDA);
    const [vaultAuthPDA] = deriveVaultAuthorityPDA(wcPDA);
    const tx = await (this.program.methods as any)
      .createWorkContract(new BN(params.amount), new BN(params.deadlineTs), new BN(params.gracePeriodSeconds), params.contractId)
      .accounts({
        payer: params.payerKeypair.publicKey, payee: params.payee,
        survivorAuthority: this.authority.publicKey, mint: params.mint,
        workContract: wcPDA, vault: vaultPDA, vaultAuthority: vaultAuthPDA,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY,
      }).signers([params.payerKeypair]).rpc();
    console.log(`[SOLANA] Created ${params.contractId}: ${tx}`);
    return { txSignature: tx, workContractAddress: wcPDA.toBase58(), vaultAddress: vaultPDA.toBase58() };
  }

  async fundWorkContract(params: { payerKeypair: Keypair; contractId: string; mint: PublicKey }) {
    const [wcPDA] = deriveWorkContractPDA(params.contractId);
    const [vaultPDA] = deriveVaultPDA(wcPDA);
    const payerATA = await getAssociatedTokenAddress(params.mint, params.payerKeypair.publicKey);
    const tx = await (this.program.methods as any).fundWorkContract()
      .accounts({ payer: params.payerKeypair.publicKey, workContract: wcPDA, payerTokenAccount: payerATA, vault: vaultPDA, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([params.payerKeypair]).rpc();
    console.log(`[SOLANA] Funded ${params.contractId}: ${tx}`);
    return tx;
  }

  async pauseContract(contractId: string): Promise<string> {
    const [wcPDA] = deriveWorkContractPDA(contractId);
    const tx = await (this.program.methods as any).pause()
      .accounts({ survivorAuthority: this.authority.publicKey, workContract: wcPDA }).rpc();
    console.log(`[SOLANA] Paused ${contractId}: ${tx}`);
    return tx;
  }

  async proposeResolution(params: { contractId: string; outcome: ResolutionType; splitBpsPayee?: number }): Promise<string> {
    const [wcPDA] = deriveWorkContractPDA(params.contractId);
    let anchorOutcome: any;
    switch (params.outcome) {
      case ResolutionType.Release: anchorOutcome = { release: {} }; break;
      case ResolutionType.Refund: anchorOutcome = { refund: {} }; break;
      case ResolutionType.Split: anchorOutcome = { split: {} }; break;
      default: throw new Error(`Invalid outcome: ${params.outcome}`);
    }
    const tx = await (this.program.methods as any).resolve(anchorOutcome, params.splitBpsPayee || 0)
      .accounts({ survivorAuthority: this.authority.publicKey, workContract: wcPDA }).rpc();
    console.log(`[SOLANA] Proposed ${params.outcome} for ${params.contractId}: ${tx}`);
    return tx;
  }

  async executeResolution(params: { contractId: string; mint: PublicKey; payer: PublicKey; payee: PublicKey }): Promise<string> {
    const [wcPDA] = deriveWorkContractPDA(params.contractId);
    const [vaultPDA] = deriveVaultPDA(wcPDA);
    const [vaultAuthPDA] = deriveVaultAuthorityPDA(wcPDA);
    const payerATA = await getAssociatedTokenAddress(params.mint, params.payer);
    const payeeATA = await getAssociatedTokenAddress(params.mint, params.payee);
    const tx = await (this.program.methods as any).executeResolution()
      .accounts({ survivorAuthority: this.authority.publicKey, workContract: wcPDA, vault: vaultPDA, vaultAuthority: vaultAuthPDA, payerTokenAccount: payerATA, payeeTokenAccount: payeeATA, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
    console.log(`[SOLANA] Executed resolution for ${params.contractId}: ${tx}`);
    return tx;
  }

  async fetchContract(contractId: string) {
    const [wcPDA] = deriveWorkContractPDA(contractId);
    try { return await (this.program.account as any).workContract.fetch(wcPDA); }
    catch { return null; }
  }

  async getVaultBalance(contractId: string): Promise<number> {
    const [wcPDA] = deriveWorkContractPDA(contractId);
    const [vaultPDA] = deriveVaultPDA(wcPDA);
    try { const b = await this.connection.getTokenAccountBalance(vaultPDA); return Number(b.value.amount); }
    catch { return 0; }
  }

  static deriveWorkContract(id: string) { return deriveWorkContractPDA(id)[0]; }
  static deriveVault(wc: PublicKey) { return deriveVaultPDA(wc)[0]; }
}

export function createSolanaClient(): SurvivorSolanaClient {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const keyPath = process.env.SURVIVOR_AUTHORITY_KEY;
  if (!keyPath) throw new Error("SURVIVOR_AUTHORITY_KEY not set");
  const fs = require("fs");
  const path = require("path");
  const resolved = keyPath.startsWith("~") ? path.join(process.env.HOME || "", keyPath.slice(1)) : keyPath;
  const secretKey = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  console.log(`[SOLANA] Client: RPC=${rpcUrl} Authority=${keypair.publicKey.toBase58()} Program=${PROGRAM_ID.toBase58()}`);
  return new SurvivorSolanaClient({ rpcUrl, survivorAuthorityKeypair: keypair });
}
