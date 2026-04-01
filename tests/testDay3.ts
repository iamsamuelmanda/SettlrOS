import { InMemoryLedger } from "../src/domain/ledger";
import { Settlement } from "../src/domain/settlement";
import { ReplayEngine } from "../src/domain/replayEngine";
import { MTNMoMoAdapter } from "../src/adapters/mtn/MTNMoMoAdapter";
import { MockMTNClient } from "../src/adapters/mtn/MockMTNClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[ASSERT FAILED] ${message}`);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

function makeSettlement(ref: string): { settlement: Settlement; ledger: InMemoryLedger } {
  const ledger     = new InMemoryLedger();
  const settlement = new Settlement(ref, "owner-1", ledger);
  return { settlement, ledger };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

async function runDay3Suite(): Promise<void> {
  console.log("=== SettlrOS Day 3: MTN MoMo Adapter ===\n");

  // ── 1. Submit ───────────────────────────────────────────────────────────────
  console.log("1. Submit Transfer");

  await test("submit returns a provider reference and moves settlement to PENDING", async () => {
    const { settlement } = makeSettlement("SUB-001");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    const result = await adapter.submitTransfer(settlement, {
      amount:   100,
      currency: "ZMW",
      payee:    "260971234567",
      note:     "Test payout",
    });

    console.log(`    providerRef: ${result.providerReference}`);
    assert(!!result.providerReference,           "provider reference must be returned");
    assert(result.status === "submitted",         "result status must be submitted");
    assert(settlement.getState() === "PENDING",  "settlement must be PENDING after submit");
  });

  await test("provider reference is stored in the ledger metadata", async () => {
    const { settlement, ledger } = makeSettlement("SUB-002");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    const result = await adapter.submitTransfer(settlement, {
      amount: 200, currency: "ZMW", payee: "260971234568", note: "Ref test",
    });

    const events = await ledger.fetchEvents("SUB-002");
    const pendingEvent = events.find((e) => e.state === "PENDING");
    assert(!!pendingEvent,                                    "PENDING event must exist");
    assert(pendingEvent?.metadata?.providerReference === result.providerReference,
      "providerReference must be stored in ledger event metadata");
  });

  // ── 2. Callback — success ───────────────────────────────────────────────────
  console.log("\n2. Callback Handling");

  await test("successful callback transitions settlement to COMPLETED", async () => {
    const { settlement } = makeSettlement("CB-001");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    const { providerReference } = await adapter.submitTransfer(settlement, {
      amount: 150, currency: "ZMW", payee: "260971234569", note: "Callback success",
    });

    client.simulateSuccess(providerReference);
    await adapter.handleCallback({ providerReference, status: "SUCCESSFUL" }, settlement);

    assert(settlement.getState() === "COMPLETED", "settlement must be COMPLETED after success callback");
  });

  await test("failure callback transitions settlement to FAILED", async () => {
    const { settlement } = makeSettlement("CB-002");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    const { providerReference } = await adapter.submitTransfer(settlement, {
      amount: 75, currency: "ZMW", payee: "260971234570", note: "Callback failure",
    });

    client.simulateFailure(providerReference);
    await adapter.handleCallback({ providerReference, status: "FAILED" }, settlement);

    assert(settlement.getState() === "FAILED", "settlement must be FAILED after failure callback");
  });

  await test("callback with unknown provider reference throws", async () => {
    const { settlement } = makeSettlement("CB-003");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    let threw = false;
    try {
      await adapter.handleCallback({ providerReference: "unknown-ref", status: "SUCCESSFUL" }, settlement);
    } catch {
      threw = true;
    }
    assert(threw, "unknown provider reference must throw");
  });

  // ── 3. Polling — missed callback ────────────────────────────────────────────
  console.log("\n3. Polling — Missed Callback");

  await test("polling resolves PENDING to COMPLETED when MTN returns SUCCESSFUL", async () => {
    const { settlement } = makeSettlement("POLL-001");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    const { providerReference } = await adapter.submitTransfer(settlement, {
      amount: 300, currency: "ZMW", payee: "260971234571", note: "Poll success",
    });

    // No callback — MTN resolves externally
    client.simulateSuccess(providerReference);
    const result = await adapter.pollStatus(providerReference, settlement);

    console.log(`    poll result: ${result.resolvedStatus}`);
    assert(result.resolvedStatus === "COMPLETED", "poll must resolve to COMPLETED");
    assert(settlement.getState() === "COMPLETED", "settlement must be COMPLETED after poll");
  });

  await test("polling resolves PENDING to FAILED when MTN returns FAILED", async () => {
    const { settlement } = makeSettlement("POLL-002");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    const { providerReference } = await adapter.submitTransfer(settlement, {
      amount: 50, currency: "ZMW", payee: "260971234572", note: "Poll failure",
    });

    client.simulateFailure(providerReference);
    const result = await adapter.pollStatus(providerReference, settlement);

    assert(result.resolvedStatus === "FAILED", "poll must resolve to FAILED");
    assert(settlement.getState() === "FAILED",  "settlement must be FAILED after poll");
  });

  await test("polling returns pending when MTN still processing", async () => {
    const { settlement } = makeSettlement("POLL-003");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    await settlement.start();
    const { providerReference } = await adapter.submitTransfer(settlement, {
      amount: 250, currency: "ZMW", payee: "260971234573", note: "Still pending",
    });

    // No simulation — MTN still processing
    const result = await adapter.pollStatus(providerReference, settlement);

    assert(result.resolvedStatus === "PENDING",  "poll must return PENDING if MTN still processing");
    assert(settlement.getState() === "PENDING",  "settlement must remain PENDING");
  });

  // ── 4. Reconciliation — batch ───────────────────────────────────────────────
  console.log("\n4. Reconciliation Window");

  await test("reconcilePending resolves all outstanding transfers in one pass", async () => {
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);

    // Three settlements — all PENDING
    const s1 = new Settlement("REC-001", "owner-1", new InMemoryLedger());
    const s2 = new Settlement("REC-002", "owner-1", new InMemoryLedger());
    const s3 = new Settlement("REC-003", "owner-1", new InMemoryLedger());

    await s1.start(); await s2.start(); await s3.start();

    const r1 = await adapter.submitTransfer(s1, { amount: 100, currency: "ZMW", payee: "260971234574", note: "rec1" });
    const r2 = await adapter.submitTransfer(s2, { amount: 200, currency: "ZMW", payee: "260971234575", note: "rec2" });
    const r3 = await adapter.submitTransfer(s3, { amount: 300, currency: "ZMW", payee: "260971234576", note: "rec3" });

    // Simulate MTN resolving two of three
    client.simulateSuccess(r1.providerReference);
    client.simulateFailure(r2.providerReference);
    // r3 still pending

    const pending = [
      { providerReference: r1.providerReference, settlement: s1 },
      { providerReference: r2.providerReference, settlement: s2 },
      { providerReference: r3.providerReference, settlement: s3 },
    ];

    const results = await adapter.reconcilePending(pending);

    console.log(`    reconciled: ${results.map((r) => r.resolvedStatus).join(", ")}`);
    assert(results[0].resolvedStatus === "COMPLETED", "REC-001 must be COMPLETED");
    assert(results[1].resolvedStatus === "FAILED",    "REC-002 must be FAILED");
    assert(results[2].resolvedStatus === "PENDING",   "REC-003 must still be PENDING");
    assert(s1.getState() === "COMPLETED",             "s1 state must be COMPLETED");
    assert(s2.getState() === "FAILED",                "s2 state must be FAILED");
    assert(s3.getState() === "PENDING",               "s3 state must remain PENDING");
  });

  // ── 5. Domain isolation — adapter leaves no MTN fingerprints on domain ──────
  console.log("\n5. Domain Isolation");

  await test("domain state machine is unaware of MTN — only adapter knows the provider", async () => {
    const { settlement, ledger } = makeSettlement("ISO-001");
    const client  = new MockMTNClient();
    const adapter = new MTNMoMoAdapter(client);
    const replay  = new ReplayEngine(ledger);

    await settlement.start();
    const { providerReference } = await adapter.submitTransfer(settlement, {
      amount: 500, currency: "ZMW", payee: "260971234577", note: "Isolation test",
    });

    client.simulateSuccess(providerReference);
    await adapter.handleCallback({ providerReference, status: "SUCCESSFUL" }, settlement);

    // Replay reconstructs COMPLETED without knowing anything about MTN
    const replayed = await replay.replaySettlement("ISO-001");
    assert(replayed === "COMPLETED", `replay must reconstruct COMPLETED, got ${replayed}`);

    // Ledger events use domain states only — no MTN-specific states
    const events = await ledger.fetchEvents("ISO-001");
    const states = events.map((e) => e.state);
    console.log(`    ledger states: ${states.join(" → ")}`);
    assert(!states.includes("SUCCESSFUL"), "MTN status SUCCESSFUL must not appear in domain ledger");
    assert(states.includes("COMPLETED"),   "domain state COMPLETED must be in ledger");
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n=== Day 3 Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runDay3Suite().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});