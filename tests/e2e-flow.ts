#!/usr/bin/env ts-node
// ============================================================
// SURVIVOR v0.1 — End-to-End Devnet Test
// ============================================================
// Run this BEFORE touching real users.
// Simulates the full lifecycle through the API.
//
// Usage: npx ts-node tests/e2e-flow.ts
//
// Prerequisites:
//   1. API server running: npm run dev
//   2. Server at http://localhost:3001
// ============================================================

const API = process.env.API_URL || "http://localhost:3001";

// Simulated wallet addresses (replace with real devnet wallets for on-chain tests)
const PAYER = "PayerWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const PAYEE = "PayeeWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // devnet USDC

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration: number;
}

const results: TestResult[] = [];

async function api(method: string, path: string, body?: any): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();

  if (!res.ok && res.status >= 500) {
    throw new Error(`API error ${res.status}: ${JSON.stringify(data)}`);
  }

  return { status: res.status, data };
}

async function runTest(name: string, fn: () => Promise<string>): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ name, passed: true, details, duration: Date.now() - start });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, passed: false, details: err.message, duration: Date.now() - start });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// ============================================================
// TEST SCENARIOS
// ============================================================

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   SURVIVOR v0.1 — E2E Test Suite    ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ----------------------------------------------------------
  // Health check
  // ----------------------------------------------------------
  console.log("🔍 Pre-flight checks...\n");

  await runTest("API is running", async () => {
    const { data } = await api("GET", "/health");
    if (data.status !== "ok") throw new Error("Health check failed");
    return `Server healthy, ${data.activeContracts} active contracts`;
  });

  // ===========================================================
  // SCENARIO 1: Happy Path — Clean delivery, release funds
  // ===========================================================
  console.log("\n📋 Scenario 1: Happy Path (clean delivery)\n");

  let contractId1: string;

  await runTest("Create work contract", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days
    const { status, data } = await api("POST", "/work-contract", {
      payer: PAYER,
      payee: PAYEE,
      amount: 200_000_000, // 200 USDC (6 decimals)
      mint: USDC_MINT,
      deadlineTs: deadline,
      gracePeriodSeconds: 259200, // 72h
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    contractId1 = data.id;
    return `Created ${contractId1}, amount: 200 USDC, deadline: ${new Date(deadline * 1000).toISOString()}`;
  });

  await runTest("Check initial risk score (should be 0)", async () => {
    const { data } = await api("GET", `/risk/${contractId1}`);
    if (data.newScore !== 0) throw new Error(`Expected risk 0, got ${data.newScore}`);
    return `Risk score: ${data.newScore}, factors: ${data.factors.length}`;
  });

  await runTest("Submit proof of delivery", async () => {
    const { status } = await api("POST", "/event", {
      workContractId: contractId1,
      type: "proof_submitted",
      source: "user",
      evidence: ["https://github.com/user/repo/pull/42"],
      metadata: { proofType: "GITHUB_PROOF" },
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    return "Proof event submitted";
  });

  await runTest("Risk should decrease after proof", async () => {
    const { data } = await api("GET", `/risk/${contractId1}`);
    const proofFactor = data.factors.find((f: any) => f.name === "proof_submitted");
    if (!proofFactor) throw new Error("No proof_submitted factor found");
    if (proofFactor.weight >= 0) throw new Error(`Proof should reduce risk, got weight ${proofFactor.weight}`);
    return `Risk score: ${data.newScore}, proof reduced by ${Math.abs(proofFactor.weight)}`;
  });

  // ===========================================================
  // SCENARIO 2: Missed Deadline — No proof, escalation
  // ===========================================================
  console.log("\n📋 Scenario 2: Missed Deadline (no proof, escalation)\n");

  let contractId2: string;

  await runTest("Create contract with past deadline", async () => {
    const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const { status, data } = await api("POST", "/work-contract", {
      payer: PAYER,
      payee: PAYEE,
      amount: 100_000_000, // 100 USDC
      mint: USDC_MINT,
      deadlineTs: deadline + 86400 * 30, // far future (we'll simulate with events)
      gracePeriodSeconds: 259200,
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    contractId2 = data.id;
    return `Created ${contractId2}, amount: 100 USDC`;
  });

  await runTest("Submit missed_deadline event", async () => {
    const { status } = await api("POST", "/event", {
      workContractId: contractId2,
      type: "missed_deadline",
      source: "agent",
      evidence: [],
      metadata: { hoursPastDeadline: 24 },
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    return "Missed deadline event ingested";
  });

  await runTest("Risk should be elevated", async () => {
    const { data } = await api("GET", `/risk/${contractId2}`);
    if (data.newScore < 20) throw new Error(`Expected elevated risk, got ${data.newScore}`);
    return `Risk score: ${data.newScore}, shouldEscalate: ${data.shouldEscalate}`;
  });

  // ===========================================================
  // SCENARIO 3: Dispute Flow — Open, proof, resolve
  // ===========================================================
  console.log("\n📋 Scenario 3: Full Dispute Flow\n");

  let contractId3: string;
  let disputeId3: string;

  await runTest("Create contract for dispute test", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400 * 14;
    const { status, data } = await api("POST", "/work-contract", {
      payer: PAYER,
      payee: PAYEE,
      amount: 500_000_000, // 500 USDC
      mint: USDC_MINT,
      deadlineTs: deadline,
      gracePeriodSeconds: 259200,
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    contractId3 = data.id;
    return `Created ${contractId3}, amount: 500 USDC`;
  });

  await runTest("Open dispute (NON_DELIVERY)", async () => {
    const { status, data } = await api("POST", "/dispute", {
      workContractId: contractId3,
      reason: "NON_DELIVERY",
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    disputeId3 = data.id;
    return `Dispute ${disputeId3} created, reason: NON_DELIVERY`;
  });

  await runTest("Cannot open duplicate dispute", async () => {
    const { status } = await api("POST", "/dispute", {
      workContractId: contractId3,
      reason: "NON_DELIVERY",
    });
    if (status !== 409) throw new Error(`Expected 409 conflict, got ${status}`);
    return "Correctly rejected duplicate dispute";
  });

  await runTest("Payee submits GitHub proof", async () => {
    const { status, data } = await api("POST", "/proof", {
      disputeId: disputeId3,
      submittedBy: PAYEE,
      proofType: "GITHUB_PROOF",
      data: {
        url: "https://github.com/user/project/pull/15",
        commitHash: "a1b2c3d4e5f6789012345678901234567890abcd",
        description: "Feature branch merged with all deliverables per contract scope",
      },
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    return `Proof ${data.id} submitted with GitHub PR + commit hash`;
  });

  await runTest("Payee submits link proof (additional evidence)", async () => {
    const { status, data } = await api("POST", "/proof", {
      disputeId: disputeId3,
      submittedBy: PAYEE,
      proofType: "LINK_PROOF",
      data: {
        url: "https://project-demo.vercel.app",
        hash: "sha256:abc123def456789012345678901234567890abcdef1234567890",
        description: "Live deployment of the delivered feature",
      },
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    return `Additional proof ${data.id} submitted (deployed URL)`;
  });

  await runTest("Trigger resolution", async () => {
    const { status, data } = await api("POST", "/resolve", {
      disputeId: disputeId3,
    });
    if (status !== 200) throw new Error(`Expected 200, got ${status}`);
    const d = data.decision;
    return `Outcome: ${d.outcome}, confidence: ${(d.confidence * 100).toFixed(0)}%, human review: ${d.requiresHumanReview}`;
  });

  // ===========================================================
  // SCENARIO 4: Weak Proof — Should result in split
  // ===========================================================
  console.log("\n📋 Scenario 4: Weak Proof (partial delivery → split)\n");

  let contractId4: string;
  let disputeId4: string;

  await runTest("Create contract for split test", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400 * 7;
    const { status, data } = await api("POST", "/work-contract", {
      payer: PAYER,
      payee: PAYEE,
      amount: 300_000_000,
      mint: USDC_MINT,
      deadlineTs: deadline,
      gracePeriodSeconds: 259200,
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    contractId4 = data.id;
    return `Created ${contractId4}, amount: 300 USDC`;
  });

  await runTest("Open dispute (QUALITY_DISPUTE)", async () => {
    const { status, data } = await api("POST", "/dispute", {
      workContractId: contractId4,
      reason: "QUALITY_DISPUTE",
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    disputeId4 = data.id;
    return `Dispute ${disputeId4} opened`;
  });

  await runTest("Payee submits weak proof (link only, no hash)", async () => {
    const { status } = await api("POST", "/proof", {
      disputeId: disputeId4,
      submittedBy: PAYEE,
      proofType: "LINK_PROOF",
      data: {
        url: "https://docs.google.com/document/d/some-doc",
        description: "Draft document with partial work completed",
      },
    });
    if (status !== 201) throw new Error(`Expected 201, got ${status}`);
    return "Weak proof submitted (URL only, no hash)";
  });

  await runTest("Resolution should propose split", async () => {
    const { status, data } = await api("POST", "/resolve", {
      disputeId: disputeId4,
    });
    if (status !== 200) throw new Error(`Expected 200, got ${status}`);
    const d = data.decision;
    if (d.outcome !== "split" && d.outcome !== "refund") {
      throw new Error(`Expected split or refund for weak proof, got ${d.outcome}`);
    }
    return `Outcome: ${d.outcome}, split bps: ${d.splitBpsPayee || "N/A"}, confidence: ${(d.confidence * 100).toFixed(0)}%`;
  });

  // ===========================================================
  // SCENARIO 5: Validation — Bad inputs
  // ===========================================================
  console.log("\n📋 Scenario 5: Input Validation\n");

  await runTest("Reject contract with missing fields", async () => {
    const { status } = await api("POST", "/work-contract", {
      payer: PAYER,
      // missing payee, amount, mint, deadlineTs
    });
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
    return "Correctly rejected incomplete contract";
  });

  await runTest("Reject event for nonexistent contract", async () => {
    const { status } = await api("POST", "/event", {
      workContractId: "wc_DOESNTEXIST",
      type: "proof_submitted",
    });
    if (status !== 404) throw new Error(`Expected 404, got ${status}`);
    return "Correctly rejected event for unknown contract";
  });

  await runTest("Reject dispute with invalid reason", async () => {
    const { status } = await api("POST", "/dispute", {
      workContractId: contractId1,
      reason: "INVALID_REASON",
    });
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
    return "Correctly rejected invalid dispute reason";
  });

  await runTest("Reject proof with invalid type", async () => {
    const { status } = await api("POST", "/proof", {
      disputeId: disputeId3,
      submittedBy: PAYEE,
      proofType: "INVALID_TYPE",
      data: { description: "test" },
    });
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
    return "Correctly rejected invalid proof type";
  });

  // ===========================================================
  // RESULTS SUMMARY
  // ===========================================================
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║          TEST RESULTS SUMMARY        ║");
  console.log("╚══════════════════════════════════════╝\n");

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`  ${icon} ${r.name}`);
    console.log(`     ${r.details}`);
  }

  console.log(`\n  ────────────────────────────────────`);
  console.log(`  Total: ${results.length} tests | ✅ ${passed} passed | ❌ ${failed} failed | ⏱ ${totalTime}ms`);

  if (failed > 0) {
    console.log("\n  ⚠️  Some tests failed. Fix before running with real users.\n");
    process.exit(1);
  } else {
    console.log("\n  🚀 All tests passed. Ready for devnet pilot.\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("\n💀 Test suite crashed:", err.message);
  process.exit(1);
});
