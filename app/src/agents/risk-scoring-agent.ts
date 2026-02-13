import {
  WorkContract,
  SurvivorEvent,
  EventType,
  RiskAssessment,
  RiskFactor,
} from "../types";

export interface RiskConfig {
  deadlineMissedWeight: number;
  noProofWeight: number;
  partialDeliveryWeight: number;
  suspiciousActivityWeight: number;
  lateProofPenalty: number;
  maxScore: number;
}

const DEFAULT_RISK_CONFIG: RiskConfig = {
  deadlineMissedWeight: 25,
  noProofWeight: 20,
  partialDeliveryWeight: 10,
  suspiciousActivityWeight: 15,
  lateProofPenalty: 2,
  maxScore: 100,
};

export class RiskScoringAgent {
  private config: RiskConfig;

  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
  }

  assess(contract: WorkContract, events: SurvivorEvent[], now: number): RiskAssessment {
    const factors: RiskFactor[] = [];
    let score = 0;

    // Factor 1: Deadline missed (time-based)
    const deadlinePassed = now > contract.deadlineTs;
    if (deadlinePassed) {
      factors.push({
        name: "deadline_missed", weight: this.config.deadlineMissedWeight,
        triggered: true, description: "Work deadline has passed",
      });
      score += this.config.deadlineMissedWeight;

      const hoursPastDeadline = Math.floor((now - contract.deadlineTs) / 3600);
      const timePenalty = Math.min(hoursPastDeadline * this.config.lateProofPenalty, 20);
      if (timePenalty > 0) {
        factors.push({
          name: "time_past_deadline", weight: timePenalty, triggered: true,
          description: `${hoursPastDeadline}h past deadline (+${this.config.lateProofPenalty}/hr, capped at 20)`,
        });
        score += timePenalty;
      }
    }

    // Factor 2: No proof submitted (only after halfway or deadline)
    const hasProof = events.some(e => e.type === EventType.ProofSubmitted);
    const contractDuration = contract.deadlineTs - contract.createdAt;
    const elapsed = now - contract.createdAt;
    const pastHalfway = contractDuration > 0 && elapsed > contractDuration * 0.5;

    if (!hasProof && (deadlinePassed || pastHalfway)) {
      const weight = deadlinePassed ? this.config.noProofWeight : Math.floor(this.config.noProofWeight / 2);
      factors.push({
        name: "no_proof", weight, triggered: true,
        description: deadlinePassed
          ? "No proof submitted and deadline passed"
          : "No proof submitted and past halfway to deadline",
      });
      score += weight;
    }

    // Factor 3: Partial delivery
    const partialEvents = events.filter(e => e.type === EventType.PartialDelivery);
    if (partialEvents.length > 0) {
      factors.push({
        name: "partial_delivery", weight: this.config.partialDeliveryWeight,
        triggered: true, description: `${partialEvents.length} partial delivery event(s) detected`,
      });
      score += this.config.partialDeliveryWeight;
    }

    // Factor 4: Suspicious activity
    const suspiciousEvents = events.filter(e => e.type === EventType.SuspiciousActivity);
    if (suspiciousEvents.length > 0) {
      const weight = Math.min(suspiciousEvents.length * this.config.suspiciousActivityWeight, 30);
      factors.push({
        name: "suspicious_activity", weight, triggered: true,
        description: `${suspiciousEvents.length} suspicious event(s) detected`,
      });
      score += weight;
    }

    // Factor 5: Missed deadline events (from monitor/user)
    const missedDeadlineEvents = events.filter(e => e.type === EventType.MissedDeadline);
    if (missedDeadlineEvents.length > 0 && !deadlinePassed) {
      factors.push({
        name: "missed_deadline_event", weight: this.config.deadlineMissedWeight,
        triggered: true,
        description: `Missed deadline reported via event (${missedDeadlineEvents.length} event(s))`,
      });
      score += this.config.deadlineMissedWeight;
    }

    // Positive: Proof submitted
    if (hasProof) {
      const proofEvents = events.filter(e => e.type === EventType.ProofSubmitted);
      const reduction = Math.min(proofEvents.length * 15, 30);
      factors.push({
        name: "proof_submitted", weight: -reduction, triggered: true,
        description: `${proofEvents.length} proof(s) submitted (-${reduction} risk)`,
      });
      score -= reduction;
    }

    const finalScore = Math.max(0, Math.min(score, this.config.maxScore));
    return {
      workContractId: contract.id, previousScore: contract.riskScore,
      newScore: finalScore, factors, shouldEscalate: finalScore > 60, timestamp: now,
    };
  }
}
