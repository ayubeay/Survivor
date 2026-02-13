// ============================================================
// SURVIVOR v0.1 — API Server
// ============================================================
// 6 endpoints. That's it. If you add more, you're overbuilding.
//
// POST /work-contract   — create agreement
// POST /event           — submit event (proof, dispute, etc.)
// GET  /risk/:id        — get current risk score
// POST /dispute         — open a dispute
// POST /proof           — submit proof of work
// POST /resolve         — trigger resolution (internal/admin)
// ============================================================

import express from "express";
import { v4 as uuidv4 } from "uuid";
import {
  WorkContract,
  SurvivorEvent,
  Dispute,
  ProofSubmission,
  ContractStatus,
  EventType,
  DisputeReason,
  ProofType,
} from "../types";
import { MonitorAgent, ContractStore } from "../agents/monitor-agent";
import { ResolutionAgent } from "../agents/resolution-agent";
import { DisputeStore } from "../agents/escalation-agent";
import { authMiddleware, createAdminRouter, incrementContractCount } from "./auth";

// ============================================================
// In-memory store (v0.1 — replace with Postgres/SQLite later)
// ============================================================

const contracts: Map<string, WorkContract> = new Map();
const events: Map<string, SurvivorEvent[]> = new Map(); // contractId → events
const disputes: Map<string, Dispute> = new Map();
const proofs: Map<string, ProofSubmission[]> = new Map(); // disputeId → proofs

// ============================================================
// Store implementations
// ============================================================

export const contractStore: ContractStore = {
  async getActiveContracts() {
    return Array.from(contracts.values()).filter(
      c => c.status !== ContractStatus.Resolved
    );
  },
  async getEventsByContract(contractId: string) {
    return events.get(contractId) || [];
  },
  async updateRiskScore(contractId: string, score: number) {
    const c = contracts.get(contractId);
    if (c) c.riskScore = score;
  },
  async updateStatus(contractId: string, status: ContractStatus) {
    const c = contracts.get(contractId);
    if (c) c.status = status;
  },
  async addEvent(event: Omit<SurvivorEvent, "id">) {
    const full: SurvivorEvent = { ...event, id: uuidv4() };
    const existing = events.get(event.workContractId) || [];
    existing.push(full);
    events.set(event.workContractId, existing);
    return full;
  },
};

export const disputeStore: DisputeStore = {
  async createDispute(d: Omit<Dispute, "id">) {
    const full: Dispute = { ...d, id: `dsp_${uuidv4().slice(0, 8)}` };
    disputes.set(full.id, full);
    return full;
  },
  async getDisputeByContract(contractId: string) {
    return Array.from(disputes.values()).find(d => d.workContractId === contractId) || null;
  },
};

// ============================================================
// Express App
// ============================================================

export function createApp(monitor: MonitorAgent): express.Application {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use("/admin", createAdminRouter());

  const resolutionAgent = new ResolutionAgent();

  // ----------------------------------------------------------
  // POST /work-contract — Create a new work agreement
  // ----------------------------------------------------------
  app.post("/work-contract", (req, res) => {
    const { payer, payee, amount, mint, deadlineTs, gracePeriodSeconds } = req.body;

    if (!payer || !payee || !amount || !mint || !deadlineTs) {
      return res.status(400).json({ error: "Missing required fields: payer, payee, amount, mint, deadlineTs" });
    }

    const id = `wc_${uuidv4().slice(0, 8)}`;
    const contract: WorkContract = {
      id,
      onchainAddress: "", // set after on-chain creation
      payer,
      payee,
      amount,
      mint,
      deadlineTs,
      gracePeriodSeconds: gracePeriodSeconds || 259_200, // default 72h
      status: ContractStatus.Created,
      resolution: "none" as any,
      riskScore: 0,
      challengeDeadline: 0,
      createdAt: Math.floor(Date.now() / 1000),
    };

    contracts.set(id, contract);
    events.set(id, []);
    const apiKeyRecord = (req as any).apiKey;
    if (apiKeyRecord) incrementContractCount(apiKeyRecord.key);

    console.log(`[API] Created contract ${id}: ${payer} → ${payee}, ${amount} ${mint}`);
    res.status(201).json(contract);
  });

  // ----------------------------------------------------------
  // POST /event — Submit an event for a contract
  // ----------------------------------------------------------
  app.post("/event", async (req, res) => {
    const { workContractId, type, source, evidence, metadata } = req.body;

    if (!workContractId || !type) {
      return res.status(400).json({ error: "Missing required fields: workContractId, type" });
    }

    if (!contracts.has(workContractId)) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const event: Omit<SurvivorEvent, "id"> = {
      workContractId,
      type,
      source: source || "user",
      evidence: evidence || [],
      metadata: metadata || {},
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Ingest through monitor agent (triggers risk → escalation pipeline)
    await monitor.ingestEvent(event);

    res.status(201).json({ message: "Event ingested", workContractId });
  });

  // ----------------------------------------------------------
  // GET /risk/:id — Get current risk score + factors
  // ----------------------------------------------------------
  app.get("/risk/:id", async (req, res) => {
    const contract = contracts.get(req.params.id);
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const contractEvents = events.get(contract.id) || [];
    const { RiskScoringAgent } = require("../agents/risk-scoring-agent");
    const riskAgent = new RiskScoringAgent();
    const assessment = riskAgent.assess(contract, contractEvents, Math.floor(Date.now() / 1000));

    res.json(assessment);
  });

  // ----------------------------------------------------------
  // POST /dispute — Open a dispute for a contract
  // ----------------------------------------------------------
  app.post("/dispute", async (req, res) => {
    const { workContractId, reason } = req.body;

    if (!workContractId || !reason) {
      return res.status(400).json({ error: "Missing required fields: workContractId, reason" });
    }

    if (!contracts.has(workContractId)) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const validReasons = Object.values(DisputeReason);
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: `Invalid reason. Must be one of: ${validReasons.join(", ")}` });
    }

    const existing = await disputeStore.getDisputeByContract(workContractId);
    if (existing) {
      return res.status(409).json({ error: "Dispute already exists for this contract", dispute: existing });
    }

    const dispute = await disputeStore.createDispute({
      workContractId,
      reason,
      status: "open",
      evidence: [],
      createdAt: Math.floor(Date.now() / 1000),
    });

    // Also inject as an event to trigger the pipeline
    await monitor.ingestEvent({
      workContractId,
      type: EventType.DisputeOpened,
      source: "user",
      evidence: [],
      metadata: { disputeId: dispute.id, reason },
      timestamp: Math.floor(Date.now() / 1000),
    });

    res.status(201).json(dispute);
  });

  // ----------------------------------------------------------
  // POST /proof — Submit proof of work for a dispute
  // ----------------------------------------------------------
  app.post("/proof", async (req, res) => {
    const { disputeId, submittedBy, proofType, data } = req.body;

    if (!disputeId || !submittedBy || !proofType || !data) {
      return res.status(400).json({ error: "Missing required fields: disputeId, submittedBy, proofType, data" });
    }

    const dispute = disputes.get(disputeId);
    if (!dispute) {
      return res.status(404).json({ error: "Dispute not found" });
    }

    const validTypes = Object.values(ProofType);
    if (!validTypes.includes(proofType)) {
      return res.status(400).json({ error: `Invalid proofType. Must be one of: ${validTypes.join(", ")}` });
    }

    const proof: ProofSubmission = {
      id: `prf_${uuidv4().slice(0, 8)}`,
      disputeId,
      submittedBy,
      proofType,
      data,
      submittedAt: Math.floor(Date.now() / 1000),
    };

    const existing = proofs.get(disputeId) || [];
    existing.push(proof);
    proofs.set(disputeId, existing);

    // Also inject as event
    await monitor.ingestEvent({
      workContractId: dispute.workContractId,
      type: EventType.ProofSubmitted,
      source: "user",
      evidence: [proof.data.url || proof.data.txHash || proof.data.commitHash || ""].filter(Boolean),
      metadata: { proofId: proof.id, proofType },
      timestamp: Math.floor(Date.now() / 1000),
    });

    res.status(201).json(proof);
  });

  // ----------------------------------------------------------
  // POST /resolve — Trigger resolution for a dispute (admin/internal)
  // ----------------------------------------------------------
  app.post("/resolve", async (req, res) => {
    const { disputeId } = req.body;

    if (!disputeId) {
      return res.status(400).json({ error: "Missing required field: disputeId" });
    }

    const dispute = disputes.get(disputeId);
    if (!dispute) {
      return res.status(404).json({ error: "Dispute not found" });
    }

    const contract = contracts.get(dispute.workContractId);
    if (!contract) {
      return res.status(404).json({ error: "Contract not found" });
    }

    const disputeProofs = proofs.get(disputeId) || [];

    const decision = resolutionAgent.resolve({
      contract,
      dispute,
      proofs: disputeProofs,
      now: Math.floor(Date.now() / 1000),
    });

    // Update dispute with proposed resolution
    dispute.proposedResolution = {
      type: decision.outcome,
      splitBpsPayee: decision.splitBpsPayee,
    };
    dispute.status = "pending_resolution";

    res.json({
      decision,
      message: decision.requiresHumanReview
        ? "Resolution requires human review before execution"
        : "Resolution proposed. Challenge window begins (48h).",
    });
  });

  // ----------------------------------------------------------
  // Health check
  // ----------------------------------------------------------

  // Debug routes for on-chain smoke testing
  app.get("/debug/contract/:id", async (req, res) => {
    try {
      const client = (app as any).solanaClient;
      if (!client) return res.status(503).json({ ok: false, error: "No Solana client" });
      const data = await client.fetchContract(req.params.id);
      res.json({ ok: true, contract: data });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get("/debug/vault/:id", async (req, res) => {
    try {
      const client = (app as any).solanaClient;
      if (!client) return res.status(503).json({ ok: false, error: "No Solana client" });
      const bal = await client.getVaultBalance(req.params.id);
      res.json({ ok: true, balance: bal });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      activeContracts: contracts.size,
      activeDisputes: disputes.size,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
