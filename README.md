# Survivor v0.1

**Autonomous risk, compliance, and payment resolution for real-world work.**

Lock USDC for work. If things go wrong, the system pauses funds, collects proof, and resolves automatically — including fair splits.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   SURVIVOR v0.1                      │
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │ Monitor  │───▶│   Risk   │───▶│  Escalation  │   │
│  │  Agent   │    │  Agent   │    │    Agent     │   │
│  └──────────┘    └──────────┘    └──────┬───────┘   │
│       ▲                                  │           │
│       │                                  ▼           │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │  Events  │    │  Proof   │───▶│  Resolution  │   │
│  │   API    │    │  Agent   │    │    Agent     │   │
│  └──────────┘    └──────────┘    └──────┬───────┘   │
│                                          │           │
│                                          ▼           │
│                              ┌───────────────────┐   │
│                              │  Solana Escrow    │   │
│                              │  Smart Contract   │   │
│                              └───────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Contract Flow

```
1. CREATE  →  Agreement established (payer + payee + amount + deadline)
2. FUND    →  USDC locked in per-contract vault PDA
3. MONITOR →  Agents watch for events, score risk
4. PAUSE   →  If risk > 60, funds frozen + dispute opened
5. PROOF   →  Payee submits evidence (URL, GitHub, tx hash)
6. RESOLVE →  Agent proposes outcome (release / refund / split)
7. CHALLENGE WINDOW →  48h for either party to challenge
8. EXECUTE →  Funds move automatically
```

**Dead man's switch:** If no resolution after deadline + grace period, payer can reclaim funds.

## Project Structure

```
survivor-v01/
├── programs/
│   └── survivor/
│       └── src/
│           └── lib.rs          ← Anchor smart contract (6 instructions)
│
├── app/
│   └── src/
│       ├── agents/
│       │   ├── resolution-agent.ts   ← #1: Determines outcomes
│       │   ├── escalation-agent.ts   ← #2: Enforces consequences
│       │   ├── risk-scoring-agent.ts ← #4: Calculates risk
│       │   ├── monitor-agent.ts      ← #5: Data pump
│       │   └── index.ts
│       ├── services/
│       │   └── api.ts          ← 6 API endpoints
│       ├── types/
│       │   └── index.ts        ← Shared types (maps to on-chain structs)
│       └── index.ts            ← Entry point
│
├── Anchor.toml
└── README.md
```

## Agent Build Order (leverage order, not conceptual order)

| Order | Agent | Why |
|-------|-------|-----|
| 1 | Resolution | Defines truth + determines money movement |
| 2 | Escalation | Enforces consequences (pause, dispute, notify) |
| 3 | Proof | Evaluates evidence (v0.1: heuristic, v0.2: verification) |
| 4 | Risk Scoring | Triggers escalation via score thresholds |
| 5 | Monitor | Feeds events into the pipeline |

## Smart Contract Instructions

| Instruction | Who Can Call | What It Does |
|------------|-------------|-------------|
| `create_work_contract` | Payer | Creates PDA + vault |
| `fund_work_contract` | Payer | Locks USDC in vault |
| `pause` | Survivor Authority | Freezes funds during dispute |
| `resolve` | Survivor Authority | Proposes resolution + starts 48h challenge window |
| `challenge` | Payer or Payee | Escalates to human review |
| `execute_resolution` | Survivor Authority | Moves funds after challenge window or human review |
| `reclaim_after_timeout` | Payer | Dead man's switch — reclaims after deadline + grace period |

## API Endpoints

```
POST /work-contract    Create agreement
POST /event            Submit event (proof, dispute, etc.)
GET  /risk/:id         Get current risk score + factors
POST /dispute          Open a dispute
POST /proof            Submit proof of work
POST /resolve          Trigger resolution (internal)
GET  /health           Health check
```

## Quickstart

### 1. Smart Contract (requires Rust + Anchor CLI)

```bash
# Install Anchor if needed: https://www.anchor-lang.com/docs/installation
anchor build
anchor deploy --provider.cluster devnet
# Update program ID in Anchor.toml and lib.rs
```

### 2. Agent API Server

```bash
cd app
npm install
npm run dev
```

Server starts at `http://localhost:3001`

### 3. Test End-to-End Flow

```bash
# Create a contract
curl -X POST http://localhost:3001/work-contract \
  -H "Content-Type: application/json" \
  -d '{
    "payer": "PAYER_WALLET_PUBKEY",
    "payee": "PAYEE_WALLET_PUBKEY",
    "amount": 500000000,
    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "deadlineTs": 1740000000
  }'

# Submit a proof event
curl -X POST http://localhost:3001/event \
  -H "Content-Type: application/json" \
  -d '{
    "workContractId": "wc_XXXXXXXX",
    "type": "proof_submitted",
    "source": "user",
    "evidence": ["https://github.com/user/repo/pull/42"]
  }'

# Check risk
curl http://localhost:3001/risk/wc_XXXXXXXX

# Open dispute
curl -X POST http://localhost:3001/dispute \
  -H "Content-Type: application/json" \
  -d '{
    "workContractId": "wc_XXXXXXXX",
    "reason": "NON_DELIVERY"
  }'

# Submit proof for dispute
curl -X POST http://localhost:3001/proof \
  -H "Content-Type: application/json" \
  -d '{
    "disputeId": "dsp_XXXXXXXX",
    "submittedBy": "PAYEE_WALLET_PUBKEY",
    "proofType": "GITHUB_PROOF",
    "data": {
      "url": "https://github.com/user/repo/pull/42",
      "commitHash": "abc1234",
      "description": "Delivered feature as specified in contract scope"
    }
  }'

# Trigger resolution
curl -X POST http://localhost:3001/resolve \
  -H "Content-Type: application/json" \
  -d '{"disputeId": "dsp_XXXXXXXX"}'
```

## Key Design Decisions

- **Backend signer (v0.1):** Fast to ship. Upgrade path: → attestations → multisig → programmatic authority
- **Per-contract vault PDA:** Each contract has isolated funds. No global vault vulnerability.
- **48h challenge window:** Resolution is proposed, not instant. Either party can challenge.
- **Dead man's switch:** If Survivor backend goes down, payer reclaims after grace period. Funds never stuck.
- **Deterministic rules (no ML):** v0.1 uses weighted scoring and if/else trees. Predictable. Auditable.

## First Target Market

Crypto-native micro-agencies and operators:
- Growth ops, community ops, design, dev, content, paid ads
- DAO ops teams
- Small founders hiring globally
- Telegram/Twitter operators settling in USDC

## v0.2 Roadmap

- [ ] Real Anchor client integration (replace stubs)
- [ ] GitHub API proof verification
- [ ] URL liveness checks
- [ ] On-chain tx verification via RPC
- [ ] Telegram bot for notifications
- [ ] CivicSync proof ingestion (physical-world layer)
- [ ] Webhook-driven monitoring (replace polling)
- [ ] Persistent storage (Postgres)
