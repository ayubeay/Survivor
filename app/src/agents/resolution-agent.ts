// ============================================================
// RESOLUTION AGENT — Build FIRST
// ============================================================
// Determines the financial outcome of a dispute.
// v0.1: Rule-based, deterministic. No ML.
//
// Input: Dispute + proof submissions + contract context
// Output: ResolutionDecision (release / refund / split + confidence)
// ============================================================

import {
  ResolutionDecision,
  ResolutionType,
  Dispute,
  ProofSubmission,
  WorkContract,
  ProofType,
} from "../types";

interface ResolutionContext {
  contract: WorkContract;
  dispute: Dispute;
  proofs: ProofSubmission[];
  now: number; // current unix timestamp
}

export class ResolutionAgent {

  /**
   * Evaluate a dispute and return a resolution decision.
   * This is the core logic — everything else in Survivor exists to feed this.
   */
  resolve(ctx: ResolutionContext): ResolutionDecision {
    const { contract, dispute, proofs, now } = ctx;

    // Separate proofs by submitter
    const payeeProofs = proofs.filter(p => p.submittedBy === contract.payee);
    const payerProofs = proofs.filter(p => p.submittedBy === contract.payer);

    // Evaluate all proofs
    const evaluatedPayee = payeeProofs.map(p => this.evaluateProof(p));
    const evaluatedPayer = payerProofs.map(p => this.evaluateProof(p));

    const payeeHasValidProof = evaluatedPayee.some(e => e.valid && e.confidence >= 0.8);
    const payeeAvgConfidence = this.avgConfidence(evaluatedPayee);
    const payerHasValidCounterProof = evaluatedPayer.some(e => e.valid && e.confidence >= 0.7);

    // ========================================
    // Decision tree (v0.1 — deterministic)
    // ========================================

    // Case 1: Strong proof of delivery → release to payee
    if (payeeHasValidProof && !payerHasValidCounterProof && payeeAvgConfidence >= 0.8) {
      return {
        workContractId: contract.id,
        disputeId: dispute.id,
        outcome: ResolutionType.Release,
        confidence: payeeAvgConfidence,
        reasoning: `Payee submitted valid proof (avg confidence ${(payeeAvgConfidence * 100).toFixed(0)}%). No valid counter-evidence from payer.`,
        requiresHumanReview: false,
      };
    }

    // Case 2: No proof at all from payee + deadline passed → refund payer
    if (payeeProofs.length === 0 && now > contract.deadlineTs) {
      return {
        workContractId: contract.id,
        disputeId: dispute.id,
        outcome: ResolutionType.Refund,
        confidence: 0.95,
        reasoning: "No proof submitted by payee and deadline has passed.",
        requiresHumanReview: false,
      };
    }

    // Case 3: Weak proof from payee (some work done, but incomplete) → split
    if (payeeProofs.length > 0 && payeeAvgConfidence >= 0.4 && payeeAvgConfidence < 0.8) {
      const splitBps = Math.round(payeeAvgConfidence * 10_000); // confidence maps to split
      return {
        workContractId: contract.id,
        disputeId: dispute.id,
        outcome: ResolutionType.Split,
        splitBpsPayee: Math.min(splitBps, 7_000), // cap at 70% for weak proof
        confidence: payeeAvgConfidence,
        reasoning: `Partial proof submitted (confidence ${(payeeAvgConfidence * 100).toFixed(0)}%). Recommending proportional split.`,
        requiresHumanReview: false,
      };
    }

    // Case 4: Both sides have valid evidence → escalate to human
    if (payeeHasValidProof && payerHasValidCounterProof) {
      return {
        workContractId: contract.id,
        disputeId: dispute.id,
        outcome: ResolutionType.Split,
        splitBpsPayee: 5_000, // default 50/50 pending human review
        confidence: 0.3,
        reasoning: "Both parties submitted valid evidence. Requires human review.",
        requiresHumanReview: true,
      };
    }

    // Case 5: Proof submitted but very low confidence → refund with review flag
    if (payeeProofs.length > 0 && payeeAvgConfidence < 0.4) {
      return {
        workContractId: contract.id,
        disputeId: dispute.id,
        outcome: ResolutionType.Refund,
        confidence: 0.6,
        reasoning: `Payee proof confidence too low (${(payeeAvgConfidence * 100).toFixed(0)}%). Defaulting to refund.`,
        requiresHumanReview: payeeAvgConfidence > 0.2, // flag for review if there's *some* evidence
      };
    }

    // Fallback: no clear signal → human review
    return {
      workContractId: contract.id,
      disputeId: dispute.id,
      outcome: ResolutionType.Refund,
      confidence: 0.2,
      reasoning: "Insufficient evidence to make automated decision. Escalating to human review.",
      requiresHumanReview: true,
    };
  }

  /**
   * Evaluate a single proof submission.
   * v0.1: Simple heuristic checks. No AI vision/analysis yet.
   */
  private evaluateProof(proof: ProofSubmission): { valid: boolean; confidence: number } {
    switch (proof.proofType) {
      case ProofType.LinkProof:
        return this.evaluateLinkProof(proof);
      case ProofType.GithubProof:
        return this.evaluateGithubProof(proof);
      case ProofType.OnchainProof:
        return this.evaluateOnchainProof(proof);
      default:
        return { valid: false, confidence: 0 };
    }
  }

  private evaluateLinkProof(proof: ProofSubmission): { valid: boolean; confidence: number } {
    const { url, hash, description } = proof.data;
    let confidence = 0;

    // Has a URL?
    if (url && this.isValidUrl(url)) confidence += 0.4;
    // Has a hash (file/content hash)?
    if (hash && hash.length >= 32) confidence += 0.3;
    // Has description?
    if (description && description.length > 20) confidence += 0.1;

    // TODO v0.2: Actually fetch URL and verify it's live
    // TODO v0.2: Compare hash against expected deliverable

    return { valid: confidence >= 0.4, confidence: Math.min(confidence, 1.0) };
  }

  private evaluateGithubProof(proof: ProofSubmission): { valid: boolean; confidence: number } {
    const { url, commitHash, description } = proof.data;
    let confidence = 0;

    // Valid GitHub URL?
    if (url && url.includes("github.com")) confidence += 0.3;
    // Has commit hash?
    if (commitHash && /^[a-f0-9]{7,40}$/.test(commitHash)) confidence += 0.4;
    // Has description?
    if (description && description.length > 50) confidence += 0.2;
    else if (description && description.length > 50) confidence += 0.2; else if (description && description.length > 10) confidence += 0.1;

    // TODO v0.2: Use GitHub API to verify PR is merged, commit exists
    // TODO v0.2: Verify commit author matches payee's known GitHub

    return { valid: confidence >= 0.4, confidence: Math.min(confidence, 1.0) };
  }

  private evaluateOnchainProof(proof: ProofSubmission): { valid: boolean; confidence: number } {
    const { txHash, description } = proof.data;
    let confidence = 0;

    // Has transaction hash? (Solana tx signatures are base58, ~88 chars)
    if (txHash && txHash.length >= 40) confidence += 0.5;
    // Has description?
    if (description && description.length > 50) confidence += 0.2;
    else if (description && description.length > 50) confidence += 0.2; else if (description && description.length > 10) confidence += 0.1;

    // TODO v0.2: Actually verify tx on-chain via RPC
    // TODO v0.2: Check tx involves expected accounts/amounts

    return { valid: confidence >= 0.4, confidence: Math.min(confidence, 1.0) };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private avgConfidence(evaluations: { valid: boolean; confidence: number }[]): number {
    if (evaluations.length === 0) return 0;
    const sum = evaluations.reduce((acc, e) => acc + e.confidence, 0);
    return sum / evaluations.length;
  }

  private isValidUrl(str: string): boolean {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }
}
