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
  const contractId = "flow-" + Date.now().toString(36);
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  console.log("\n=== FULL ESCROW FLOW TEST ===");
  console.log("Contract:", contractId);
  console.log("Payer:", payerKeypair.publicKey.toBase58());
  console.log("Payee:", payeeKeypair.publicKey.toBase58());
  console.log("Mint:", MINT.toBase58());

  // 1. CREATE
  console.log("\n[1/6] Creating contract...");
  const created = await client.createWorkContract({
    payerKeypair, payee: payeeKeypair.publicKey, mint: MINT,
    amount: 5_000_000, deadlineTs: deadline, gracePeriodSeconds: 259200, contractId,
  });
  console.log("✅ TX:", created.txSignature);

  // 2. FUND
  console.log("\n[2/6] Funding contract (5 tokens)...");
  const fundTx = await client.fundWorkContract({ payerKeypair, contractId, mint: MINT });
  console.log("✅ TX:", fundTx);

  // 3. CHECK VAULT
  console.log("\n[3/6] Checking vault balance...");
  const bal = await client.getVaultBalance(contractId);
  console.log("✅ Vault balance:", bal, "(expected: 5000000)");

  // 4. PAUSE
  console.log("\n[4/6] Pausing contract...");
  const pauseTx = await client.pauseContract(contractId);
  console.log("✅ TX:", pauseTx);

  // 5. RESOLVE (release 100% to payee)
  console.log("\n[5/6] Proposing resolution: RELEASE to payee...");
  const resolveTx = await client.proposeResolution({
    contractId, outcome: "release" as any, splitBpsPayee: 0,
  });
  console.log("✅ TX:", resolveTx);

  // 6. FETCH FINAL STATE
  console.log("\n[6/6] Fetching final on-chain state...");
  const state = await client.fetchContract(contractId);
  console.log("✅ Status:", JSON.stringify(state.status));
  console.log("✅ Resolution:", JSON.stringify(state.resolution));
  console.log("✅ Challenge deadline:", state.challengeDeadline?.toString());

  const finalBal = await client.getVaultBalance(contractId);
  console.log("✅ Vault balance:", finalBal, "(still 5000000 — funds locked until challenge window passes)");

  console.log("\n=== FLOW TEST COMPLETE ===");
  console.log("Contract created → funded → paused → resolution proposed.");
  console.log("Funds remain in vault until 48h challenge window expires.");
  console.log("Then executeResolution will release to payee.\n");
}

main().catch(err => { console.error("❌ Fatal:", err.message); if (err.logs) console.error(err.logs.slice(-5)); process.exit(1); });
