# Survivor API Reference

**Base URL:** `http://localhost:3001` (devnet)

## Authentication

All endpoints (except `/health`) require an API key via the `x-api-key` header.
```bash
curl -H "x-api-key: sv_your_key_here" http://localhost:3001/risk/wc_abc123
```

### Get an API key

Contact [@youngs_modulus](https://twitter.com/youngs_modulus) for a pilot key, or create one locally via the admin endpoint.

### Tiers

| Tier | Contracts/mo | Rate limit | Mainnet |
|---|---|---|---|
| pilot | 5 | 30/min | No |
| basic | 25 | 60/min | Yes |
| pro | 100 | 120/min | Yes |
| enterprise | Unlimited | 300/min | Yes |

### Error responses
```json
// Missing key
{ "error": "Missing API key", "message": "Include x-api-key header." }

// Invalid key
{ "error": "Invalid API key" }

// Rate limited
{ "error": "Rate limit exceeded", "tier": "pilot" }

// Monthly limit
{ "error": "Monthly contract limit reached", "limit": 5, "used": 5, "tier": "pilot" }
```

---

## Endpoints

### POST /work-contract

Create a new work agreement.

**Request:**
```json
{
  "payer": "WALLET_PUBKEY",
  "payee": "WALLET_PUBKEY",
  "amount": 500000000,
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "deadlineTs": 1740000000,
  "gracePeriodSeconds": 259200
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| payer | string | Yes | Payer's Solana wallet address |
| payee | string | Yes | Payee's Solana wallet address |
| amount | number | Yes | Amount in token base units (e.g. 500000000 = 500 USDC) |
| mint | string | Yes | SPL token mint address |
| deadlineTs | number | Yes | Unix timestamp for work deadline |
| gracePeriodSeconds | number | No | Dead man's switch grace period (default: 259200 = 72h) |

**Response (201):**
```json
{
  "id": "wc_dc59c42c",
  "payer": "...",
  "payee": "...",
  "amount": 500000000,
  "mint": "...",
  "deadlineTs": 1740000000,
  "gracePeriodSeconds": 259200,
  "status": "created",
  "riskScore": 0,
  "createdAt": 1739451600
}
```

---

### POST /event

Submit an event for a contract. Events feed into the risk scoring pipeline.

**Request:**
```json
{
  "workContractId": "wc_dc59c42c",
  "type": "proof_submitted",
  "source": "user",
  "evidence": ["https://github.com/user/repo/pull/42"],
  "metadata": { "proofType": "GITHUB_PROOF" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| workContractId | string | Yes | Contract ID |
| type | string | Yes | Event type (see below) |
| source | string | No | Event source (default: "user") |
| evidence | string[] | No | Evidence URLs or references |
| metadata | object | No | Additional event data |

**Event types:**

| Type | Description |
|---|---|
| `proof_submitted` | Work proof submitted |
| `missed_deadline` | Deadline has passed (usually auto-generated) |
| `partial_delivery` | Partial work delivered |
| `suspicious_activity` | Suspicious behavior detected |
| `dispute_opened` | Dispute filed (usually via /dispute endpoint) |

**Response (201):**
```json
{ "message": "Event ingested", "workContractId": "wc_dc59c42c" }
```

---

### GET /risk/:id

Get current risk score and breakdown for a contract.

**Request:**
```bash
GET /risk/wc_dc59c42c
```

**Response (200):**
```json
{
  "workContractId": "wc_dc59c42c",
  "previousScore": 0,
  "newScore": 25,
  "factors": [
    {
      "name": "deadline_missed",
      "weight": 25,
      "triggered": true,
      "description": "Work deadline has passed"
    }
  ],
  "shouldEscalate": false,
  "timestamp": 1739455200
}
```

**Risk score:** 0-100. Higher = more risk. Score > 60 triggers automatic escalation.

**Score freezing:** Once a dispute is opened or contract is paused/resolved, the risk score freezes at its current value. Resolution agent takes over from there.

---

### POST /dispute

Open a dispute for a contract.

**Request:**
```json
{
  "workContractId": "wc_dc59c42c",
  "reason": "NON_DELIVERY"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| workContractId | string | Yes | Contract ID |
| reason | string | Yes | Dispute reason (see below) |

**Dispute reasons:**

| Reason | Description |
|---|---|
| `NON_DELIVERY` | Work was not delivered |
| `LATE_DELIVERY` | Work delivered after deadline |
| `QUALITY_DISPUTE` | Work quality does not meet agreement |
| `SCOPE_CHANGE` | Scope changed without agreement |

**Response (201):**
```json
{
  "id": "dsp_c1312e3f",
  "workContractId": "wc_dc59c42c",
  "reason": "NON_DELIVERY",
  "status": "open",
  "evidence": [],
  "createdAt": 1739455200
}
```

**Error (409):** Dispute already exists for this contract.

---

### POST /proof

Submit proof of work for a dispute.

**Request:**
```json
{
  "disputeId": "dsp_c1312e3f",
  "submittedBy": "PAYEE_WALLET_PUBKEY",
  "proofType": "GITHUB_PROOF",
  "data": {
    "url": "https://github.com/user/repo/pull/42",
    "commitHash": "abc1234def5678",
    "description": "Delivered feature as specified in contract scope"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| disputeId | string | Yes | Dispute ID |
| submittedBy | string | Yes | Wallet address of proof submitter |
| proofType | string | Yes | Proof type (see below) |
| data | object | Yes | Proof data (varies by type) |

**Proof types:**

| Type | Expected data fields |
|---|---|
| `GITHUB_PROOF` | `url`, `commitHash`, `description` |
| `LINK_PROOF` | `url`, `description` |
| `ONCHAIN_PROOF` | `txHash`, `description` |

**Response (201):**
```json
{
  "id": "prf_a1b2c3d4",
  "disputeId": "dsp_c1312e3f",
  "submittedBy": "...",
  "proofType": "GITHUB_PROOF",
  "data": { "..." : "..." },
  "submittedAt": 1739455300
}
```

---

### POST /resolve

Trigger resolution for a dispute. The resolution agent evaluates all submitted proofs and proposes an outcome.

**Request:**
```json
{
  "disputeId": "dsp_c1312e3f"
}
```

**Response (200):**
```json
{
  "decision": {
    "outcome": "release",
    "confidence": 0.9,
    "reasoning": "Strong GitHub proof with merged PR and detailed description",
    "requiresHumanReview": false
  },
  "onchainTx": "5BcwwWUXk...",
  "message": "Resolution proposed. Challenge window begins (48h)."
}
```

**Possible outcomes:**

| Outcome | When | Effect |
|---|---|---|
| `release` | Confidence >= 0.8 | Full payment to payee |
| `refund` | Confidence < 0.3 | Full refund to payer |
| `split` | 0.3 <= confidence < 0.8 | Proportional split (splitBps field) |

**splitBps:** Basis points (0-10000) representing payee's share. Example: `splitBps: 4000` = 40% to payee, 60% to payer.

---

### GET /health

Health check. No authentication required.

**Response (200):**
```json
{
  "status": "ok",
  "activeContracts": 3,
  "activeDisputes": 1,
  "timestamp": "2026-02-13T15:54:35.289Z"
}
```

---

## Admin Endpoints

Admin endpoints require the `x-admin-key` header matching the `SURVIVOR_ADMIN_KEY` environment variable.

### POST /admin/keys

Create a new API key.
```bash
curl -X POST http://localhost:3001/admin/keys \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{"owner": "alice", "tier": "pilot"}'
```

**Response (201):**
```json
{
  "key": "sv_b9oi749i_plor8b4z_81bibibw_anaqobgi",
  "owner": "alice",
  "tier": "pilot",
  "limits": { "maxContractsPerMonth": 5, "ratePerMinute": 30, "mainnetAllowed": false }
}
```

### GET /admin/keys

List all API keys (masked).

### DELETE /admin/keys/:key

Revoke an API key.

---

## Typical Flow
```
1. POST /work-contract        -> Create agreement (get wc_id)
2. Fund on-chain               -> Lock USDC in vault via Solana
3. POST /event                 -> Submit proof_submitted events as work progresses
4. GET  /risk/:id              -> Monitor risk score
5. POST /dispute               -> Open dispute if needed (get dsp_id)
6. POST /proof                 -> Submit evidence for the dispute
7. POST /resolve               -> System evaluates and proposes outcome
8. 48h challenge window         -> Either party can challenge
9. On-chain execution           -> Funds move automatically
```

## Error Codes

| Code | Meaning |
|---|---|
| 400 | Missing or invalid request fields |
| 401 | Missing or invalid API key |
| 403 | API key revoked |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate dispute) |
| 429 | Rate limit or monthly limit exceeded |
