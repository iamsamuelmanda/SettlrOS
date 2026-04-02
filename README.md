# SettlrOS

**Settlement infrastructure for mobile money corridors in Africa.**

SettlrOS is a programmable settlement engine that closes the async gap in mobile money payouts. When a fintech submits a payout to MTN or Airtel, there is a window — minutes to hours — where the status is unknown. SettlrOS owns that window: it tracks every settlement through a deterministic state machine, prevents duplicate payouts via idempotency keys, resolves outcomes via callback or polling, and produces an audit-ready ledger that never lies.

---

## The Problem

Every African fintech that moves money across mobile money corridors faces the same three failures:

1. **Duplicate payouts** — a network timeout causes a retry, and the customer gets paid twice.
2. **Unresolved pending states** — a callback is missed, and no one knows if the payout landed.
3. **Reconciliation by spreadsheet** — a CFO manually reconstructs what happened over the weekend.

SettlrOS eliminates all three.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   REST API Layer                    │
│  POST /settlements   GET /settlements?state=PENDING │
│  POST /settlements/:ref/transition                  │
│  GET  /settlements/:ref/replay                      │
├─────────────────────────────────────────────────────┤
│                  Domain Core                        │
│  Settlement  │  StateMachine  │  ReplayEngine       │
│  ILedger     │  InMemoryLedger│  PostgresLedger     │
├─────────────────────────────────────────────────────┤
│                 Adapter Layer                       │
│  MTNMoMoAdapter  →  submitTransfer                  │
│                  →  handleCallback                  │
│                  →  pollStatus                      │
│                  →  reconcilePending                │
└─────────────────────────────────────────────────────┘
```

**Design principles:**
- Domain core has zero network dependencies — runs anywhere, tests instantly
- Adapters are the only layer that knows about provider-specific status codes
- MTN's `SUCCESSFUL` never appears in the domain ledger — only `COMPLETED` does
- Every settlement transition is idempotent — retries are safe by design

---

## Settlement State Machine

```
INITIATED → PENDING → COMPLETED
                    → FAILED
```

| State | Meaning |
|-------|---------|
| `INITIATED` | Settlement created, not yet submitted to provider |
| `PENDING` | Submitted to MTN/Airtel — awaiting async confirmation |
| `COMPLETED` | Provider confirmed success |
| `FAILED` | Provider confirmed failure |

`COMPLETED` and `FAILED` are terminal — no further transitions possible.

---

## Project Structure

```
src/
├── index.ts                        # Live HTTP server entry point
├── domain/
│   ├── ledger.ts                   # ILedger, InMemoryLedger, PostgresLedger
│   ├── settlement.ts               # Settlement, TransitionOutcome
│   ├── stateMachine.ts             # SettlementState, transition rules
│   └── replayEngine.ts             # Deterministic state reconstruction
├── adapters/
│   └── mtn/
│       ├── MTNMoMoAdapter.ts       # Submit, callback, poll, reconcile
│       └── MockMTNClient.ts        # In-memory MTN simulation for tests
└── server/
    ├── server.ts                   # Fastify server factory
    ├── auth.ts                     # API key resolution, tenant mapping
    ├── tenantStore.ts              # Per-tenant ledger + settlement registry
    └── routes/
        └── settlements.ts          # All HTTP route handlers

tests/
├── testDay1Final.ts                # State machine, ledger, replay
├── testDay2.ts                     # Concurrency, idempotency
├── testDay3.ts                     # MTN adapter: submit, callback, poll
├── testDay4.ts                     # REST API: auth, CRUD, multi-tenancy
└── testDay5.ts                     # Reconciliation report endpoint
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Run the server

```bash
npm start
```

The server starts on `http://localhost:3000` by default.

```
╔══════════════════════════════════════════╗
║           SettlrOS is running            ║
╠══════════════════════════════════════════╣
║  http://localhost:3000                   ║
║                                          ║
║  POST   /settlements                     ║
║  GET    /settlements                     ║
║  GET    /settlements?state=PENDING       ║
║  GET    /settlements/:ref                ║
║  POST   /settlements/:ref/transition     ║
║  GET    /settlements/:ref/replay         ║
║  GET    /health                          ║
╚══════════════════════════════════════════╝
```

### Environment variables

```bash
PORT=3000           # HTTP port (default: 3000)
HOST=0.0.0.0        # Bind address (default: 0.0.0.0)
DATABASE_URL=       # PostgreSQL connection string (production only)
NODE_ENV=           # Set to "production" to enable request logging
```

---

## API Reference

All endpoints (except `/health`) require an `Authorization: Bearer <api_key>` header.

### Authentication

API keys are mapped to tenant IDs. Each tenant has fully isolated settlement data.

| API Key | Tenant |
|---------|--------|
| `api_key_tenant1` | `tenant1` |
| `api_key_tenant2` | `tenant2` |

---

### POST /settlements

Create a new settlement.

**Request**
```json
{
  "reference": "PAYOUT-2026-001",
  "owner": "user-123"
}
```

**Response `201`**
```json
{
  "reference": "PAYOUT-2026-001",
  "state": "INITIATED",
  "tenantId": "tenant1"
}
```

**Errors:** `401` invalid key — `409` reference already exists

---

### GET /settlements

List settlements for the authenticated tenant. Optionally filter by state.

```
GET /settlements
GET /settlements?state=PENDING
GET /settlements?state=COMPLETED
GET /settlements?state=FAILED
GET /settlements?state=INITIATED
```

**Response `200`**
```json
{
  "tenantId": "tenant1",
  "generatedAt": "2026-04-02T18:34:12.257Z",
  "total": 2,
  "settlements": [
    {
      "reference": "PAYOUT-2026-001",
      "state": "PENDING",
      "version": 2,
      "createdAt": "2026-04-02T18:30:00.000Z"
    }
  ]
}
```

**Errors:** `401` invalid key — `422` invalid state value

---

### GET /settlements/:ref

Read a single settlement's current state.

**Response `200`**
```json
{
  "reference": "PAYOUT-2026-001",
  "state": "PENDING",
  "version": 2,
  "tenantId": "tenant1"
}
```

**Errors:** `401` — `404` not found

---

### POST /settlements/:ref/transition

Advance a settlement to the next state.

**Request**
```json
{
  "expectedState": "INITIATED",
  "nextState": "PENDING",
  "idempotencyKey": "unique-key-per-attempt"
}
```

**Response `200`**
```json
{
  "reference": "PAYOUT-2026-001",
  "state": "PENDING",
  "outcome": "applied",
  "tenantId": "tenant1"
}
```

`outcome` is one of `applied` or `duplicate`. A `duplicate` means the same `idempotencyKey` was seen before — the transition was not re-applied. This is safe to retry.

**Errors:** `401` — `404` — `422` illegal transition or state conflict

---

### GET /settlements/:ref/replay

Reconstruct the settlement's final state by replaying all ledger events. Use this to verify consistency or investigate discrepancies.

**Response `200`**
```json
{
  "reference": "PAYOUT-2026-001",
  "replayedState": "COMPLETED",
  "tenantId": "tenant1"
}
```

---

### GET /health

Unauthenticated. Returns service status.

**Response `200`**
```json
{
  "status": "ok",
  "service": "SettlrOS",
  "version": "0.1.0",
  "timestamp": "2026-04-02T18:34:12.257Z"
}
```

---

## Running Tests

Each day's test suite is independent and runs without a database or network.

```bash
npm run test-day1   # State machine, ledger, replay determinism
npm run test-day2   # Concurrent idempotency, race safety
npm run test-day3   # MTN MoMo adapter: submit, callback, poll, reconcile
npm run test-day4   # REST API: auth, CRUD, multi-tenant isolation
npm run test-day5   # Reconciliation report: list, filter, tenant scope
```

All tests use `InMemoryLedger` — zero network, zero environment setup required.

**Current status:** 47 tests, 0 failures.

---

## What Was Built, Day by Day

### Day 1 — Domain Core
State machine spine: `INITIATED → PENDING → COMPLETED/FAILED`. Immutable ledger. Deterministic replay engine that reconstructs settlement state from events.

### Day 2 — Concurrent Idempotency
Race-safe state transitions — two concurrent requests for the same settlement produce exactly one outcome. Idempotency keys prevent duplicate processing on retry. Replay verified correct after races.

### Day 3 — MTN MoMo Adapter
Full async payout loop: submit returns a provider reference, callback maps outcome to domain state, polling closes the gap when callback is missed, batch reconciliation resolves multiple pending transfers in one pass. MTN's vocabulary (`SUCCESSFUL`) is translated at the adapter boundary — the domain ledger only ever sees `COMPLETED`.

### Day 4 — REST API Layer
Fastify HTTP server with API key authentication, per-tenant isolation, and five endpoints: create, read, transition, list, and replay. Tenants cannot read or modify each other's settlements.

### Day 5 — Reconciliation Report
`GET /settlements?state=PENDING` returns all unresolved settlements for a tenant with `generatedAt` timestamp, total count, and full item shape. A finance team can open this endpoint on Monday morning and see exactly what did not close over the weekend.

---

## Roadmap

- [ ] Airtel Money adapter
- [ ] PAPSS corridor support
- [ ] PostgreSQL persistence (production ledger)
- [ ] Webhook delivery for settlement outcomes
- [ ] SDK — TypeScript client
- [ ] Reconciliation export (CSV, auditor format)
- [ ] SOC 2 audit trail documentation

---

## Built by

**Samuel Manda** — Founder, Eight Digits Enterprises  
Kwame Nkrumah University, Kabwe, Zambia

SettlrOS is part of a broader infrastructure vision for African fintech. If you process mobile money payouts and reconciliation is costing you time, [reach out](https://github.com/iamsamuelmanda).