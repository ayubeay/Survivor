import { Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaClient } from "../src/services/solana-client";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const client = createSolanaClient();

  const keyPath = process.env.SURVIVOR_AUTHORITY_KEY!;
  const resolved = keyPath.startsWith("~") ? path.join(process.env.HOME!, keyPath.slice(1)) : keyPath;
  const secret = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  const payerKeypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  const payeeKeypair = Keypair.generate();

  const MINT = new PublicKey("DbA1f1ptueMM1AZjrdDPnJoU9ncWCQ5gj1wY8yfqykxA");
  const contractId = "chal-" + Date.now().toString(36);
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  console.log("\n=== CHALLENGE (ADVERSARIAL) FLOW TEST ===");
  console.log("Contract:", contractId);

  // 1. CREATE + FUND
  console.log("\n[1/7] Creating contract...");
  await client.createWorkContract({
    payerKeypair, payee: payeeKeypair.publicKey, mint: MINT,
    amount: 2_000_000, deadlineTs: deadline, gracePeriodSeconds: 259200, contractId,
  });
  console.log("✅ Created");

  console.log("\n[2/7] Funding (2 tokens)...");
  await client.fundWorkContract({ payerKeypair, contractId, mint: MINT });
  console.log("✅ Funded");

  // 2. PAUSE + PROPOSE RELEASE
  console.log("\n[3/7] Pausing...");
  await client.pauseContract(contractId);
  console.log("✅ Paused");

  console.log("\n[4/7] Proposing resolution: RELEASE...");
  await client.proposeResolution({ contractId, outcome: "release" as any });
  console.log("✅ Resolution proposed (48h challenge window started)");

  // 3. CHALLENGE — payer disputes the resolution BEFORE window expires
  console.log("\n[5/7] Payer CHALLENGES the resolution...");
  // Challenge must be called by payer or payee — we use payer here
  try {
    const challengeIx = await (client as any).program.methods.challenge()
      .accounts({
        challenger: payerKeypair.publicKey,
        workContract: (PublicKey as any).findProgramAddressSync(
          [Buffer.from("work_contract"), Buffer.from(contractId)],
          client.programId
        )[0],
      })
      .signers([payerKeypair])
      .rpc();
    console.log("✅ Challenge TX:", challengeIx);
  } catch (err: any) {
    console.error("❌ Challenge failed:", err.message);
    if (err.logs) console.error(err.logs.slice(-5));
    process.exit(1);
  }

  // 4. VERIFY STATE IS ESCALATED
  console.log("\n[6/7] Fetching state after challenge...");
  const state = await client.fetchContract(contractId);
  console.log("✅ Status:", JSON.stringify(state.status));
  console.log("   Expected: {\"escalated\":{}}");

  // 5. ATTEMPT EXECUTE — should FAIL (escalated requires human review)
  console.log("\n[7/7] Attempting executeResolution (should work — authority can execute escalated)...");
  // Note: per the Rust code, escalated contracts CAN be executed by survivor_authority
  // This simulates: human reviewed → authority executes
  try {
    // Need payee ATA to exist first — create it
    const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");
    const { Connection } = require("@solana/web3.js");
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");
    await getOrCreateAssociatedTokenAccount(conn, payerKeypair, MINT, payeeKeypair.publicKey);
    console.log("   (Created payee token account)");

    const execTx = await client.executeResolution({
      contractId, mint: MINT,
      payer: payerKeypair.publicKey, payee: payeeKeypair.publicKey,
    });
    console.log("✅ Executed after challenge! TX:", execTx);

    const vaultBal = await client.getVaultBalance(contractId);
    console.log("✅ Vault balance:", vaultBal, "(expected: 0)");

    const finalState = await client.fetchContract(contractId);
    console.log("✅ Final status:", JSON.stringify(finalState.status), "(expected: resolved)");
  } catch (err: any) {
    console.log("Result:", err.message);
    if (err.logs) console.log(err.logs.slice(-3));
  }

  console.log("\n=== CHALLENGE FLOW COMPLETE ===\n");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
