import { Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaClient } from "../src/services/solana-client";
import * as fs from "fs";
import * as path from "path";

const API = "http://localhost:3001";
const MINT = new PublicKey("DbA1f1ptueMM1AZjrdDPnJoU9ncWCQ5gj1wY8yfqykxA");
const results: any[] = [];
let API_KEY = "";

async function api(method: string, endpoint: string, body?: any): Promise<any> {
  const opts: any = { method, headers: { "Content-Type": "application/json", "x-api-key": API_KEY } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${endpoint}`, opts);
  return res.json();
}

function loadPayer(): Keypair {
  const kp = process.env.SURVIVOR_AUTHORITY_KEY!;
  const resolved = kp.startsWith("~") ? path.join(process.env.HOME!, kp.slice(1)) : kp;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, "utf-8"))));
}

async function scenarioA(client: any, payer: Keypair) {
  console.log("\n" + "=".repeat(50));
  console.log("SCENARIO A: Clean Delivery (Happy Path)");
  console.log("=".repeat(50));
  const payee = Keypair.generate();
  const cid = "pa-" + Date.now().toString(36);
  const c = await api("POST", "/work-contract", { payer: payer.publicKey.toBase58(), payee: payee.publicKey.toBase58(), amount: 1000000, mint: MINT.toBase58(), deadlineTs: Math.floor(Date.now()/1000)+7200, gracePeriodSeconds: 259200 });
  console.log("  [1] Created:", c.id);
  const r1 = await api("GET", `/risk/${c.id}`);
  console.log("  [2] Risk:", r1.newScore);
  await api("POST", "/event", { workContractId: c.id, type: "proof_submitted", source: "user", evidence: ["https://github.com/test/pr/1"], metadata: { proofType: "GITHUB_PROOF" } });
  const r2 = await api("GET", `/risk/${c.id}`);
  console.log("  [3] Risk after proof:", r2.newScore);
  await client.createWorkContract({ payerKeypair: payer, payee: payee.publicKey, mint: MINT, amount: 1000000, deadlineTs: Math.floor(Date.now()/1000)+7200, gracePeriodSeconds: 259200, contractId: cid });
  await client.fundWorkContract({ payerKeypair: payer, contractId: cid, mint: MINT });
  const vault = await client.getVaultBalance(cid);
  console.log("  [4] Vault:", vault);
  const ok = r1.newScore === 0 && vault === 1000000;
  console.log("  " + (ok ? "✅ PASSED" : "❌ FAILED"));
  results.push({ name: "A: Clean Delivery", passed: ok, resolution: "N/A", risk: r2.newScore, vault });
}

async function scenarioB(client: any, payer: Keypair) {
  console.log("\n" + "=".repeat(50));
  console.log("SCENARIO B: Missed Deadline");
  console.log("=".repeat(50));
  const c = await api("POST", "/work-contract", { payer: payer.publicKey.toBase58(), payee: Keypair.generate().publicKey.toBase58(), amount: 3000000, mint: MINT.toBase58(), deadlineTs: Math.floor(Date.now()/1000)+60, gracePeriodSeconds: 259200 });
  console.log("  [1] Created:", c.id);
  await api("POST", "/event", { workContractId: c.id, type: "missed_deadline", source: "agent", evidence: [], metadata: { hoursPastDeadline: 24 } });
  const r = await api("GET", `/risk/${c.id}`);
  console.log("  [2] Risk:", r.newScore);
  const ok = r.newScore >= 25;
  console.log("  " + (ok ? "✅ PASSED" : "❌ FAILED"));
  results.push({ name: "B: Missed Deadline", passed: ok, resolution: "escalated", risk: r.newScore });
}

async function scenarioC(client: any, payer: Keypair) {
  console.log("\n" + "=".repeat(50));
  console.log("SCENARIO C: Strong Proof → Release");
  console.log("=".repeat(50));
  const payee = Keypair.generate();
  const cid = "pc-" + Date.now().toString(36);
  const c = await api("POST", "/work-contract", { payer: payer.publicKey.toBase58(), payee: payee.publicKey.toBase58(), amount: 5000000, mint: MINT.toBase58(), deadlineTs: Math.floor(Date.now()/1000)+7200, gracePeriodSeconds: 259200 });
  console.log("  [1] Created:", c.id);
  const d = await api("POST", "/dispute", { workContractId: c.id, reason: "NON_DELIVERY" });
  console.log("  [2] Dispute:", d.id);
  await api("POST", "/proof", { disputeId: d.id, submittedBy: payee.publicKey.toBase58(), proofType: "GITHUB_PROOF", data: { url: "https://github.com/test/pr/15", commitHash: "a1b2c3d4e5f6789012345678901234567890abcd", description: "All deliverables completed. CI passing. Deployed to staging." } });
  console.log("  [3] Strong proof submitted");
  const res = await api("POST", "/resolve", { disputeId: d.id });
  console.log("  [4] Resolution:", res.decision?.outcome, "confidence:", res.decision?.confidence);
  await client.createWorkContract({ payerKeypair: payer, payee: payee.publicKey, mint: MINT, amount: 5000000, deadlineTs: Math.floor(Date.now()/1000)+7200, gracePeriodSeconds: 259200, contractId: cid });
  await client.fundWorkContract({ payerKeypair: payer, contractId: cid, mint: MINT });
  await client.pauseContract(cid);
  await client.proposeResolution({ contractId: cid, outcome: "release" as any });
  const st = await client.fetchContract(cid);
  console.log("  [5] On-chain:", JSON.stringify(st.status), JSON.stringify(st.resolution));
  const ok = res.decision?.outcome === "release";
  console.log("  " + (ok ? "✅ PASSED" : "❌ FAILED"));
  results.push({ name: "C: Strong Proof → Release", passed: ok, resolution: res.decision?.outcome, confidence: res.decision?.confidence });
}

async function scenarioD(client: any, payer: Keypair) {
  console.log("\n" + "=".repeat(50));
  console.log("SCENARIO D: Weak Proof → Split");
  console.log("=".repeat(50));
  const c = await api("POST", "/work-contract", { payer: payer.publicKey.toBase58(), payee: Keypair.generate().publicKey.toBase58(), amount: 4000000, mint: MINT.toBase58(), deadlineTs: Math.floor(Date.now()/1000)+7200, gracePeriodSeconds: 259200 });
  console.log("  [1] Created:", c.id);
  const d = await api("POST", "/dispute", { workContractId: c.id, reason: "QUALITY_DISPUTE" });
  console.log("  [2] Dispute:", d.id);
  await api("POST", "/proof", { disputeId: d.id, submittedBy: c.payee, proofType: "LINK_PROOF", data: { url: "https://docs.google.com/partial", description: "Partial work" } });
  console.log("  [3] Weak proof submitted");
  const res = await api("POST", "/resolve", { disputeId: d.id });
  console.log("  [4] Resolution:", res.decision?.outcome, "splitBps:", res.decision?.splitBpsPayee);
  const ok = res.decision?.outcome === "split" && res.decision?.splitBpsPayee > 0;
  console.log("  " + (ok ? "✅ PASSED" : "❌ FAILED"));
  results.push({ name: "D: Weak Proof → Split", passed: ok, resolution: res.decision?.outcome, splitBps: res.decision?.splitBpsPayee });
}

async function scenarioE(client: any, payer: Keypair) {
  console.log("\n" + "=".repeat(50));
  console.log("SCENARIO E: No Proof → Refund (On-Chain)");
  console.log("=".repeat(50));
  const payee = Keypair.generate();
  const cid = "pe-" + Date.now().toString(36);
  const c = await api("POST", "/work-contract", { payer: payer.publicKey.toBase58(), payee: payee.publicKey.toBase58(), amount: 2000000, mint: MINT.toBase58(), deadlineTs: Math.floor(Date.now()/1000)+7200, gracePeriodSeconds: 259200 });
  console.log("  [1] Created:", c.id);
  const d = await api("POST", "/dispute", { workContractId: c.id, reason: "NON_DELIVERY" });
  console.log("  [2] Dispute:", d.id);
  const res = await api("POST", "/resolve", { disputeId: d.id });
  console.log("  [3] Resolution:", res.decision?.outcome);
  await client.createWorkContract({ payerKeypair: payer, payee: payee.publicKey, mint: MINT, amount: 2000000, deadlineTs: Math.floor(Date.now()/1000)+7200, gracePeriodSeconds: 259200, contractId: cid });
  await client.fundWorkContract({ payerKeypair: payer, contractId: cid, mint: MINT });
  await client.pauseContract(cid);
  await client.proposeResolution({ contractId: cid, outcome: "refund" as any });
  const [wcPDA] = PublicKey.findProgramAddressSync([Buffer.from("work_contract"), Buffer.from(cid)], client.programId);
  await (client as any).program.methods.challenge().accounts({ challenger: payer.publicKey, workContract: wcPDA }).signers([payer]).rpc();
  console.log("  [4] Challenged → escalated");
  const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");
  const { Connection } = require("@solana/web3.js");
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  await getOrCreateAssociatedTokenAccount(conn, payer, MINT, payee.publicKey);
  await client.executeResolution({ contractId: cid, mint: MINT, payer: payer.publicKey, payee: payee.publicKey });
  const vaultBal = await client.getVaultBalance(cid);
  const finalState = await client.fetchContract(cid);
  console.log("  [5] Vault:", vaultBal, "Status:", JSON.stringify(finalState.status));
  const ok = res.decision?.outcome === "refund" && vaultBal === 0;
  console.log("  " + (ok ? "✅ PASSED" : "❌ FAILED"));
  results.push({ name: "E: No Proof → Refund", passed: ok, resolution: res.decision?.outcome, vault: vaultBal, onchain: JSON.stringify(finalState.status) });
}

async function main() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║   SURVIVOR v0.1 — SELF-TEST PILOT         ║");
  console.log("║   5 Scenarios • API + On-Chain             ║");
  console.log("╚════════════════════════════════════════════╝");
  const client = createSolanaClient();
  const payer = loadPayer();
  const keyRes = await fetch(API + "/admin/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner: "pilot-test", tier: "enterprise" }) });
  const keyData = await keyRes.json();
  API_KEY = keyData.key;
  console.log("[AUTH] Test key: " + API_KEY);
  console.log("Payer:", payer.publicKey.toBase58());

  for (const [fn, label] of [[scenarioA,"A"],[scenarioB,"B"],[scenarioC,"C"],[scenarioD,"D"],[scenarioE,"E"]] as any) {
    try { await fn(client, payer); } catch (e: any) {
      console.error(`  ❌ Scenario ${label} crashed:`, e.message);
      results.push({ name: label, passed: false, notes: e.message });
    }
  }

  console.log("\n" + "=".repeat(50));
  const passed = results.filter(r => r.passed).length;
  console.log(`FINAL: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}`);
  console.log("=".repeat(50));

  // Save report
  let md = `# Survivor v0.1 — Pilot Results\n\n**Date:** ${new Date().toISOString()}\n**Program:** Ca4DHFBvQ8PJurgZH5H5K7XaV4KiYYRcg4ZNDWcLLzNm\n\n`;
  md += `| Scenario | Result | Resolution |\n|---|---|---|\n`;
  for (const r of results) md += `| ${r.name} | ${r.passed?"✅":"❌"} | ${r.resolution||"N/A"} |\n`;
  md += `\n## Details\n\n`;
  for (const r of results) md += `### ${r.name}\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\`\n\n`;
  fs.writeFileSync(path.join(__dirname, "..", "docs", "pilot-results.md"), md);
  console.log("\n📄 Report saved to docs/pilot-results.md\n");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
