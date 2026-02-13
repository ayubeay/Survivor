// ============================================================
// ESCALATION AGENT — Build SECOND
// ============================================================
// Bridges risk detection and money enforcement.
// When risk score crosses threshold → pause funds, open dispute, request proof.
//
// This is where Survivor stops being "analytics" and becomes enforcement.
// ============================================================

import {
  WorkContract,
  ContractStatus,
  EscalationAction,
  DisputeReason,
  Dispute,
  SurvivorEvent,
  EventType,
} from "../types";

// Interface for the on-chain actions (implemented by SurvivorSolanaClient)
export interface OnChainService {
  pauseContract(contractId: string): Promise<string>; // returns tx signature
  proposeResolution(params: { contractId: string; outcome: import("../types").ResolutionType; splitBpsPayee?: number }): Promise<string>;
  executeResolution(params: { contractId: string; mint: import("@solana/web3.js").PublicKey; payer: import("@solana/web3.js").PublicKey; payee: import("@solana/web3.js").PublicKey }): Promise<string>;
}

// Interface for notification delivery
export interface NotificationService {
  notifyPayer(contract: WorkContract, message: string): Promise<void>;
  notifyPayee(contract: WorkContract, message: string): Promise<void>;
}

// Interface for dispute storage
export interface DisputeStore {
  createDispute(dispute: Omit<Dispute, "id">): Promise<Dispute>;
  getDisputeByContract(contractId: string): Promise<Dispute | null>;
}

export interface EscalationConfig {
  riskThreshold: number;            // score above which escalation triggers (default: 60)
  autoDisputeOnMissedDeadline: boolean; // auto-open dispute if deadline passes with no proof
  proofRequestGracePeriodHours: number; // hours given to submit proof after request
}

const DEFAULT_CONFIG: EscalationConfig = {
  riskThreshold: 60,
  autoDisputeOnMissedDeadline: true,
  proofRequestGracePeriodHours: 48,
};

export class EscalationAgent {
  private config: EscalationConfig;

  constructor(config: Partial<EscalationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main evaluation: should this contract be escalated?
   * Called after every risk score update.
   */
  evaluate(
    contract: WorkContract,
    events: SurvivorEvent[],
    now: number,
  ): EscalationAction | null {

    // Don't escalate contracts that are already resolved or escalated
    if (
      contract.status === ContractStatus.Resolved ||
      contract.status === ContractStatus.Paused ||
      contract.status === ContractStatus.Escalated ||
      contract.status === ContractStatus.PendingResolution
    ) {
      return null;
    }

    // Only act on funded contracts
    if (contract.status !== ContractStatus.Funded) {
      return null;
    }

    const actions: EscalationAction["actions"] = [];
    let reason = "";

    // ========================================
    // Trigger 1: Risk score exceeds threshold
    // ========================================
    if (contract.riskScore > this.config.riskThreshold) {
      actions.push("pause_payment", "open_dispute", "request_proof", "notify_parties");
      reason = `Risk score ${contract.riskScore} exceeds threshold ${this.config.riskThreshold}`;
    }

    // ========================================
    // Trigger 2: Deadline passed with no proof
    // ========================================
    else if (this.config.autoDisputeOnMissedDeadline && now > contract.deadlineTs) {
      const hasProofEvent = events.some(e => e.type === EventType.ProofSubmitted);
      if (!hasProofEvent) {
        actions.push("pause_payment", "open_dispute", "request_proof", "notify_parties");
        reason = "Deadline passed with no proof of delivery submitted";
      }
    }

    // ========================================
    // Trigger 3: Explicit dispute event from user
    // ========================================
    else if (events.some(e => e.type === EventType.DisputeOpened)) {
      actions.push("pause_payment", "request_proof", "notify_parties");
      reason = "Dispute opened by participant";
    }

    if (actions.length === 0) return null;

    return {
      workContractId: contract.id,
      reason,
      actions,
      timestamp: now,
    };
  }

  /**
   * Execute an escalation action.
   * This is the enforcement step — it actually pauses funds on-chain.
   */
  async execute(
    action: EscalationAction,
    contract: WorkContract,
    onChain: OnChainService,
    notifications: NotificationService,
    disputeStore: DisputeStore,
  ): Promise<{ txSignature?: string; disputeId?: string }> {
    const result: { txSignature?: string; disputeId?: string } = {};

    for (const step of action.actions) {
      switch (step) {
        case "pause_payment":
          result.txSignature = await onChain.pauseContract(contract.id);
          console.log(`[ESCALATION] Paused contract ${contract.id}: tx ${result.txSignature}`);
          break;

        case "open_dispute":
          const existingDispute = await disputeStore.getDisputeByContract(contract.id);
          if (!existingDispute) {
            const dispute = await disputeStore.createDispute({
              workContractId: contract.id,
              reason: this.inferDisputeReason(action.reason),
              status: "open",
              evidence: [],
              createdAt: action.timestamp,
            });
            result.disputeId = dispute.id;
            console.log(`[ESCALATION] Opened dispute ${dispute.id} for contract ${contract.id}`);
          }
          break;

        case "request_proof":
          // In v0.1, this is just a notification asking payee to submit proof
          await notifications.notifyPayee(
            contract,
            `Proof of work requested for contract ${contract.id}. ` +
            `Please submit within ${this.config.proofRequestGracePeriodHours} hours. ` +
            `Accepted proof types: deployed URL, GitHub PR/commit, or on-chain transaction.`
          );
          console.log(`[ESCALATION] Proof requested from payee for contract ${contract.id}`);
          break;

        case "notify_parties":
          await Promise.all([
            notifications.notifyPayer(
              contract,
              `Dispute escalation triggered for contract ${contract.id}. Reason: ${action.reason}. Funds are paused.`
            ),
            notifications.notifyPayee(
              contract,
              `Dispute escalation triggered for contract ${contract.id}. Please submit proof of work completion.`
            ),
          ]);
          console.log(`[ESCALATION] Both parties notified for contract ${contract.id}`);
          break;
      }
    }

    return result;
  }

  /**
   * Map escalation reason to dispute taxonomy
   */
  private inferDisputeReason(reason: string): DisputeReason {
    if (reason.includes("deadline") || reason.includes("no proof")) {
      return DisputeReason.NonDelivery;
    }
    if (reason.includes("partial")) {
      return DisputeReason.LateDelivery;
    }
    if (reason.includes("risk") || reason.includes("suspicious")) {
      return DisputeReason.QualityDispute;
    }
    return DisputeReason.NonDelivery; // safe default
  }
}
