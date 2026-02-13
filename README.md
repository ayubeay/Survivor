# Survivor

**Escrow + automatic dispute resolution for USDC work payments on Solana.**

You lock funds. Work gets done (or doesn't). Survivor evaluates proof and moves money. No chasing. No screenshots-as-evidence. No trust required.

---

## The Problem

Every week, thousands of USDC payments go wrong:

- **Payers** send money and get ghosted
- **Workers** deliver and spend weeks chasing payment
- **Both sides** lose time, money, and trust arguing in Telegram DMs

There's no neutral system. Just screenshots, promises, and hoping the other person is honest.

## How Survivor Works
```
1. Lock    →  Payer deposits USDC into a per-contract vault
2. Work    →  Payee delivers against agreed scope + deadline
3. Prove   →  Payee submits proof (GitHub PR, deployment URL, tx hash)
4. Resolve →  System evaluates proof and proposes outcome:
               • Release (work delivered) → funds go to payee
               • Refund (nothing delivered) → funds return to payer
               • Split (partial delivery) → fair split based on evidence
5. Challenge → 48h window — either party can dispute the outcome
6. Execute →  Funds move automatically
```

**Dead man's switch:** If the system goes down, payer reclaims after 72h. Funds are never stuck.

## What Makes This Different

- **Per-contract vaults.** Each payment is isolated. No shared pool, no commingling risk.
- **Deterministic resolution.** Weighted rules, not black-box AI. Every decision is auditable.
- **On-chain enforcement.** Outcomes execute as Solana transactions. Not promises — programs.
- **Challenge window.** Nobody gets rugged by the system. Both parties can escalate.
- **Works today.** Live on Solana devnet. 5/5 scenarios passing end-to-end.

## Current Status: Pilot Ready (v0.1)

| Component | Status |
|---|---|
| Solana escrow program (Anchor) | ✅ Deployed to devnet |
| Risk scoring agent | ✅ Deterministic, weighted rules |
| Escalation agent | ✅ Auto-pause at threshold |
| Resolution agent | ✅ Proof evaluation → release/refund/split |
| Monitor agent | ✅ Continuous polling + event pipeline |
| API server | ✅ 22/22 tests passing |
| End-to-end pilot | ✅ 5/5 scenarios passing |

**Program ID:** `Ca4DHFBvQ8PJurgZH5H5K7XaV4KiYYRcg4ZNDWcLLzNm`

### Pilot Test Results (Feb 13, 2026)

| Scenario | Flow | Result |
|---|---|---|
| Clean delivery | Create → fund → proof → release | ✅ |
| Missed deadline | Create → deadline passes → risk scored | ✅ |
| Strong proof → release | Dispute → GitHub proof → release proposed → on-chain | ✅ |
| Weak proof → split | Dispute → weak evidence → 40/60 split | ✅ |
| No proof → refund | Dispute → no evidence → refund → challenge → execute | ✅ |

## Who This Is For

- **Freelancers and contractors** paid in USDC who want payment protection
- **Crypto-native agencies** hiring operators, devs, designers, growth leads
- **DAO ops teams** managing contributor payments
- **Anyone settling work in USDC** over Telegram, Twitter, or Discord who's been burned before

## API
```
POST /work-contract         Create agreement
POST /event                 Submit event (proof, deadline, etc.)
GET  /risk/:id              Get risk score + factors
POST /dispute               Open dispute
POST /proof                 Submit proof of work
POST /resolve               Trigger resolution
GET  /health                System health
```

Full API documentation: [`docs/api.md`](docs/api.md)

## Pricing

| Tier | Price | Contracts/mo | Features |
|---|---|---|---|
| Pilot | Free | 5 | Full API access, devnet only |
| Basic | $49/mo | 25 | Mainnet, email support |
| Pro | $199/mo | 100 | Priority resolution, webhook notifications |
| Enterprise | $499/mo | Unlimited | Custom rules, SLA, dedicated support |

**Currently accepting pilot users.** [Request access →](https://twitter.com/youngs_modulus)

## Architecture
```
┌───────────────────────────────────────────────────┐
│                  SURVIVOR v0.1                     │
│                                                    │
│  Monitor ──▶ Risk ──▶ Escalation ──▶ Resolution   │
│     │                                    │         │
│     ▼                                    ▼         │
│  Events API              Solana Escrow Program     │
│                          (per-contract vaults)     │
└───────────────────────────────────────────────────┘
```

Four agents run in a pipeline:

1. **Monitor** — watches contracts, generates time-based events
2. **Risk** — scores each contract 0-100 based on weighted factors
3. **Escalation** — pauses funds and opens disputes when risk exceeds threshold
4. **Resolution** — evaluates proof, proposes outcome, executes on-chain

## Smart Contract

Seven instructions, all permissioned:

| Instruction | Caller | Effect |
|---|---|---|
| `create_work_contract` | Payer | Creates PDA + vault |
| `fund_work_contract` | Payer | Locks USDC in vault |
| `pause` | Authority | Freezes funds during dispute |
| `resolve` | Authority | Proposes outcome + starts challenge window |
| `challenge` | Payer/Payee | Escalates to review |
| `execute_resolution` | Authority | Moves funds after challenge window |
| `reclaim_after_timeout` | Payer | Dead man's switch (72h grace) |

## Run It Yourself
```bash
# Clone
git clone https://github.com/ayubeay/Survivor.git
cd Survivor

# API server
cd app && npm install && npm run dev
# → http://localhost:3001

# Run pilot test (requires Solana devnet + funded wallet)
export SURVIVOR_AUTHORITY_KEY=~/.config/solana/payer.json
export SOLANA_RPC_URL=https://api.devnet.solana.com
npx ts-node scripts/self-test-pilot.ts
```

## Roadmap

**v0.2** (next)
- API key authentication + rate limiting
- GitHub API proof verification (verify PRs exist and are merged)
- URL liveness checks
- Persistent storage (Postgres)

**v0.3**
- Mainnet deployment
- Telegram bot notifications
- Webhook-driven monitoring (replace polling)
- On-chain event indexing

**Future**
- CivicSync integration (physical-world permit/inspection workflows)
- Multi-engine proof aggregation
- Multisig authority upgrade

## Design Philosophy

Survivor follows a **reality-first systems** approach:

- **Deterministic over probabilistic.** Weighted rules, not ML. Every decision traceable.
- **Chain as truth.** On-chain state is the source of truth for escrow. Backend stores evidence and audit trail.
- **Time + Silence = State Change.** If nobody acts within a window, the system acts. No stuck states.
- **Fail-safe, not fail-closed.** Dead man's switch ensures funds are always recoverable.

---

Built by [@youngs_modulus](https://twitter.com/youngs_modulus)
