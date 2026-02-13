import { createApp, contractStore, disputeStore } from "./services/api";
import { MonitorAgent } from "./agents/monitor-agent";
import { OnChainService, NotificationService } from "./agents/escalation-agent";
import { createSolanaClient, SurvivorSolanaClient } from "./services/solana-client";

let onChainService: OnChainService;
let solanaClient: SurvivorSolanaClient | null = null;

try {
  if (process.env.SURVIVOR_AUTHORITY_KEY) {
    solanaClient = createSolanaClient();
    onChainService = solanaClient;
    console.log("[BOOT] ✅ On-chain service: LIVE (Solana devnet)");
  } else {
    throw new Error("No key configured");
  }
} catch (err: any) {
  console.log(`[BOOT] ⚠️  On-chain service: STUB MODE (${err.message})`);
  onChainService = {
    async pauseContract(contractId: string) { console.log(`[STUB] pause ${contractId}`); return "stub_tx_" + Date.now(); },
    async proposeResolution(params) { console.log(`[STUB] propose ${params.outcome} for ${params.contractId}`); return "stub_tx_" + Date.now(); },
    async executeResolution(params) { console.log(`[STUB] execute ${params.contractId}`); return "stub_tx_" + Date.now(); },
  };
}

const notificationService: NotificationService = {
  async notifyPayer(contract, message) { console.log(`[NOTIFY] → Payer ${contract.payer}: ${message}`); },
  async notifyPayee(contract, message) { console.log(`[NOTIFY] → Payee ${contract.payee}: ${message}`); },
};

const PORT = process.env.PORT || 3001;
const monitor = new MonitorAgent(contractStore, onChainService, notificationService, disputeStore, {
  pollIntervalMs: 30_000, enableDeadlineChecks: true, enableOnchainMonitoring: false,
});
const app = createApp(monitor);
(app as any).solanaClient = solanaClient;

app.listen(PORT, () => {
  console.log(`\n  SURVIVOR v0.1 — http://localhost:${PORT}\n  Monitor: Running (30s)\n`);
  monitor.start();
});
