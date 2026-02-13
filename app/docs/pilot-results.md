# Survivor v0.1 — Pilot Results

**Date:** 2026-02-13T16:02:57.113Z
**Program:** Ca4DHFBvQ8PJurgZH5H5K7XaV4KiYYRcg4ZNDWcLLzNm

| Scenario | Result | Resolution |
|---|---|---|
| A: Clean Delivery | ✅ | N/A |
| B: Missed Deadline | ✅ | escalated |
| C: Strong Proof → Release | ✅ | release |
| D: Weak Proof → Split | ✅ | split |
| E: No Proof → Refund | ✅ | refund |

## Details

### A: Clean Delivery
```json
{
  "name": "A: Clean Delivery",
  "passed": true,
  "resolution": "N/A",
  "risk": 0,
  "vault": 1000000
}
```

### B: Missed Deadline
```json
{
  "name": "B: Missed Deadline",
  "passed": true,
  "resolution": "escalated",
  "risk": 25
}
```

### C: Strong Proof → Release
```json
{
  "name": "C: Strong Proof → Release",
  "passed": true,
  "resolution": "release",
  "confidence": 0.8999999999999999
}
```

### D: Weak Proof → Split
```json
{
  "name": "D: Weak Proof → Split",
  "passed": true,
  "resolution": "split",
  "splitBps": 4000
}
```

### E: No Proof → Refund
```json
{
  "name": "E: No Proof → Refund",
  "passed": true,
  "resolution": "refund",
  "vault": 0,
  "onchain": "{\"resolved\":{}}"
}
```

