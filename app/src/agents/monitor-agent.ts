// ============================================================
// MONITOR AGENT — Build LAST
// ============================================================
// Continuously watches for events and feeds the agent pipeline.
// This is the entry point — events come in here and trigger
// Risk → Escalation → Resolution flow.
//
// v0.1: Poll-based. v0.2: Webhook/websocket driven.
// ============================================================

import { WorkContract, SurvivorEvent, EventType, ContractStatus } from "../types";
import { RiskScoringAgent } from "./risk-scoring-agent";
import { EscalationAgent, OnChainService, NotificationService, DisputeStore } from "./escalation-agent";
import { ResolutionAgent } from "./resolution-agent";

// Storage interface — implement with your DB of choice (Postgres, SQLite, etc.)
export interface ContractStore {
  getActiveContracts(): Promise<WorkContract[]>;
  getEventsByContract(contractId: string): Promise<SurvivorEvent[]>;
  updateRiskScore(contractId: string, score: number): Promise<void>;
  updateStatus(contractId: string, status: ContractStatus): Promise<void>;
  addEvent(event: Omit<SurvivorEvent, "id">): Promise<SurvivorEvent>;
}

export interface MonitorConfig {
  pollIntervalMs: number;    // how often to check (default: 30s)
  enableDeadlineChecks: boolean;
  enableOnchainMonitoring: boolean; // future: watch chain for events
}

const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  pollIntervalMs: 30_000,
  enableDeadlineChecks: true,
  enableOnchainMonitoring: false, // v0.2
};

export class MonitorAgent {
  private config: MonitorConfig;
  private riskAgent: RiskScoringAgent;
  private escalationAgent: EscalationAgent;
  private resolutionAgent: ResolutionAgent;
  private running = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private contractStore: ContractStore,
    private onChain: OnChainService,
    private notifications: NotificationService,
    private disputeStore: DisputeStore,
    config: Partial<MonitorConfig> = {},
  ) {
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    this.riskAgent = new RiskScoringAgent();
    this.escalationAgent = new EscalationAgent();
    this.resolutionAgent = new ResolutionAgent();
  }

  /**
   * Start the monitoring loop
   */
  start(): void {
    if (this.running) {
      console.log("[MONITOR] Already running");
      return;
    }

    this.running = true;
    console.log(`[MONITOR] Started. Polling every ${this.config.pollIntervalMs}ms`);

    // Run immediately, then on interval
    this.tick();
    this.intervalHandle = setInterval(() => this.tick(), this.config.pollIntervalMs);
  }

  /**
   * Stop the monitoring loop
   */
  stop(): void {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log("[MONITOR] Stopped");
  }

  /**
   * Single monitoring cycle
   */
  private async tick(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const contracts = await this.contractStore.getActiveContracts();

      console.log(`[MONITOR] Checking ${contracts.length} active contracts`);

      for (const contract of contracts) {
        await this.processContract(contract, now);
      }
    } catch (error) {
      console.error("[MONITOR] Error in tick:", error);
    }
  }

  /**
   * Process a single contract through the agent pipeline
   */
  private async processContract(contract: WorkContract, now: number): Promise<void> {
    // Skip resolved contracts
    if (contract.status === ContractStatus.Resolved) return;

    const events = await this.contractStore.getEventsByContract(contract.id);

    // ========================================
    // Step 1: Generate time-based events
    // ========================================
    if (this.config.enableDeadlineChecks) {
      await this.checkDeadline(contract, events, now);
    }

    // Refresh events after potential additions
    const updatedEvents = await this.contractStore.getEventsByContract(contract.id);

    // ========================================
    // Step 2: Calculate risk score
    // ========================================
    const riskAssessment = this.riskAgent.assess(contract, updatedEvents, now);

    if (riskAssessment.newScore !== contract.riskScore) {
      await this.contractStore.updateRiskScore(contract.id, riskAssessment.newScore);
      contract.riskScore = riskAssessment.newScore; // update local reference

      console.log(
        `[MONITOR] Contract ${contract.id}: risk ${riskAssessment.previousScore} → ${riskAssessment.newScore}` +
        (riskAssessment.shouldEscalate ? " ⚠️ ESCALATION TRIGGERED" : "")
      );
    }

    // ========================================
    // Step 3: Check for escalation
    // ========================================
    const escalationAction = this.escalationAgent.evaluate(contract, updatedEvents, now);

    if (escalationAction) {
      console.log(`[MONITOR] Escalating contract ${contract.id}: ${escalationAction.reason}`);

      await this.escalationAgent.execute(
        escalationAction,
        contract,
        this.onChain,
        this.notifications,
        this.disputeStore,
      );

      await this.contractStore.updateStatus(contract.id, ContractStatus.Paused);
    }
  }

  /**
   * Check if deadline has passed and generate appropriate events
   */
  private async checkDeadline(
    contract: WorkContract,
    events: SurvivorEvent[],
    now: number,
  ): Promise<void> {
    // Only check funded contracts
    if (contract.status !== ContractStatus.Funded) return;

    // Has deadline passed?
    if (now <= contract.deadlineTs) return;

    // Already generated a missed_deadline event?
    const alreadyFlagged = events.some(e => e.type === EventType.MissedDeadline);
    if (alreadyFlagged) return;

    // Generate the event
    await this.contractStore.addEvent({
      workContractId: contract.id,
      type: EventType.MissedDeadline,
      source: "agent",
      evidence: [],
      metadata: {
        deadlineTs: contract.deadlineTs,
        detectedAt: now,
        hoursPastDeadline: Math.floor((now - contract.deadlineTs) / 3600),
      },
      timestamp: now,
    });

    console.log(`[MONITOR] Deadline missed for contract ${contract.id}`);
  }

  /**
   * Ingest an external event (from webhook, user submission, etc.)
   * This is the main entry point for events that don't come from polling.
   */
  async ingestEvent(event: Omit<SurvivorEvent, "id">): Promise<void> {
    const saved = await this.contractStore.addEvent(event);
    console.log(`[MONITOR] Ingested event ${saved.id} (${event.type}) for contract ${event.workContractId}`);

    // Immediately process the affected contract
    const contracts = await this.contractStore.getActiveContracts();
    const contract = contracts.find(c => c.id === event.workContractId);
    if (contract) {
      await this.processContract(contract, Math.floor(Date.now() / 1000));
    }
  }
}
