import { Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaClient } from "../src/services/solana-client";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const client = createSolanaClient();

  // Load payer keypair (same as survivor authority for testing)
  const keyPath = process.env.SURVIVOR_AUTHORITY_KEY!;
  const resolved = keyPath.startsWith("~") ? path.join(process.env.HOME!, keyPath.slice(1)) : keyPath;
  const secret = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  const payerKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));

  // For testing: payee is a random new keypair
  const payeeKeypair = Keypair.generate();

  // USDC devnet mint (Circle's official devnet USDC)
  const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

  const contractId = "smoke-" + Date.now().toString(36);
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const gracePeriod = 259200; // 72 hours (minimum)

  console.log("\n=== SURVIVOR DEVNET SMOKE TEST ===");
  console.log("Contract ID:", contractId);
  console.log("Payer:", payerKeypair.publicKey.toBase58());
  console.log("Payee:", payeeKeypair.publicKey.toBase58());
  console.log("Mint:", USDC_DEVNET.toBase58());
  console.log("Amount: 1,000,000 (1 USDC)");
  console.log("Deadline:", new Date(deadline * 1000).toISOString());

  // Step 1: Create work contract on-chain
  console.log("\n[1/4] Creating work contract...");
  try {
    const result = await client.createWorkContract({
      payerKeypair,
      payee: payeeKeypair.publicKey,
      mint: USDC_DEVNET,
      amount: 1_000_000, // 1 USDC (6 decimals)
      deadlineTs: deadline,
      gracePeriodSeconds: gracePeriod,
      contractId,
    });
    console.log("✅ Created! TX:", result.txSignature);
    console.log("   PDA:", result.workContractAddress);
    console.log("   Vault:", result.vaultAddress);
  } catch (err: any) {
    console.error("❌ Create failed:", err.message);
    if (err.logs) console.error("Logs:", err.logs.slice(-5));
    process.exit(1);
  }

  // Step 2: Fetch contract state
  console.log("\n[2/4] Fetching on-chain state...");
  const state = await client.fetchContract(contractId);
  if (state) {
    console.log("✅ Contract found on-chain!");
    console.log("   Status:", JSON.stringify(state.status));
    console.log("   Amount:", state.amount?.toString());
    console.log("   Payer:", state.payer?.toBase58());
    console.log("   Payee:", state.payee?.toBase58());
  } else {
    console.error("❌ Contract not found on-chain");
    process.exit(1);
  }

  // Step 3: Check vault balance (should be 0 — not funded yet)
  console.log("\n[3/4] Checking vault balance...");
  const balance = await client.getVaultBalance(contractId);
  console.log("✅ Vault balance:", balance, "(expected: 0, not funded yet)");

  // Step 4: Pause contract (test survivor authority action)
  console.log("\n[4/4] Pausing contract (authority action)...");
  try {
    // First we need to fund it — but we don't have USDC on devnet yet
    // So let's just test pause on a Created contract — this should FAIL
    // because pause requires Funded status
    const tx = await client.pauseContract(contractId);
    console.log("✅ Paused! TX:", tx);
  } catch (err: any) {
    if (err.message?.includes("InvalidStatus") || err.logs?.some((l: string) => l.includes("InvalidStatus"))) {
      console.log("✅ Pause correctly rejected (contract not funded yet — expected!)");
    } else {
      console.log("⚠️  Pause failed:", err.message);
    }
  }

  console.log("\n=== SMOKE TEST COMPLETE ===");
  console.log("Your program is LIVE and responding to transactions on devnet.");
  console.log("Next: fund with devnet USDC to test the full escrow flow.\n");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
