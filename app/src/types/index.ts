// ============================================================
// Survivor v0.1 — Shared Types
// Maps 1:1 to on-chain Anchor structs
// ============================================================

export enum ContractStatus {
  Created = "created",
  Funded = "funded",
  Paused = "paused",
  PendingResolution = "pending_resolution",
  Escalated = "escalated",
  Resolved = "resolved",
}

export enum ResolutionType {
  None = "none",
  Release = "release",
  Refund = "refund",
  Split = "split",
}

export enum DisputeReason {
  NonDelivery = "NON_DELIVERY",
  LateDelivery = "LATE_DELIVERY",
  QualityDispute = "QUALITY_DISPUTE",
  ScopeChange = "SCOPE_CHANGE",
}

export enum ProofType {
  LinkProof = "LINK_PROOF",       // deployed URL, doc, drive link + hash
  GithubProof = "GITHUB_PROOF",   // PR merged, commit hash, release tag
  OnchainProof = "ONCHAIN_PROOF", // tx hash, invoice, wallet signature
}

export enum EventType {
  MissedDeadline = "missed_deadline",
  PartialDelivery = "partial_delivery",
  SuspiciousActivity = "suspicious_activity",
  ProofSubmitted = "proof_submitted",
  DisputeOpened = "dispute_opened",
  PaymentFunded = "payment_funded",
}

// ============================================================
// Core Domain Objects
// ============================================================

export interface WorkContract {
  id: string;
  onchainAddress: string;
  payer: string;           // wallet pubkey
  payee: string;           // wallet pubkey
  amount: number;          // in token base units (USDC = 6 decimals)
  mint: string;            // token mint address
  deadlineTs: number;      // unix timestamp
  gracePeriodSeconds: number;
  status: ContractStatus;
  resolution: ResolutionType;
  splitBpsPayee?: number;  // only if resolution == Split
  riskScore: number;       // 0-100, maintained by Risk Agent
  challengeDeadline: number;
  createdAt: number;
  resolvedAt?: number;
}

export interface SurvivorEvent {
  id: string;
  workContractId: string;
  type: EventType;
  source: "agent" | "user" | "onchain" | "webhook";
  evidence: string[];      // tx hashes, file hashes, URLs
  metadata: Record<string, any>;
  timestamp: number;
}

export interface Dispute {
  id: string;
  workContractId: string;
  reason: DisputeReason;
  status: "open" | "pending_resolution" | "challenged" | "resolved";
  evidence: ProofSubmission[];
  proposedResolution?: {
    type: ResolutionType;
    splitBpsPayee?: number;
  };
  finalResolution?: {
    type: ResolutionType;
    splitBpsPayee?: number;
    executedAt: number;
  };
  createdAt: number;
}

export interface ProofSubmission {
  id: string;
  disputeId: string;
  submittedBy: string;     // wallet pubkey
  proofType: ProofType;
  data: {
    url?: string;
    hash?: string;
    txHash?: string;
    commitHash?: string;
    description: string;
  };
  evaluation?: {
    valid: boolean;
    confidence: number;    // 0.0 - 1.0
    reason: string;
  };
  submittedAt: number;
}

// ============================================================
// Agent Decision Types
// ============================================================

export interface RiskAssessment {
  workContractId: string;
  previousScore: number;
  newScore: number;
  factors: RiskFactor[];
  shouldEscalate: boolean;
  timestamp: number;
}

export interface RiskFactor {
  name: string;
  weight: number;          // points added to risk score
  triggered: boolean;
  description: string;
}

export interface ResolutionDecision {
  workContractId: string;
  disputeId: string;
  outcome: ResolutionType;
  splitBpsPayee?: number;
  confidence: number;
  reasoning: string;
  requiresHumanReview: boolean;
}

export interface EscalationAction {
  workContractId: string;
  reason: string;
  actions: ("pause_payment" | "open_dispute" | "request_proof" | "notify_parties")[];
  timestamp: number;
}
