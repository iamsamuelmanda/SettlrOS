import { InMemoryLedger } from "../src/domain/ledger";
import { Settlement, SettlementState, TransitionOutcome } from "../src/domain/settlement";
import { StateMachine } from "../src/domain/stateMachine";
import { ReplayEngine } from "../src/domain/replayEngine";

// ── Helpers ───────────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[ASSERT FAILED] ${message}`);
}

function log(label: string, message: string): void {
  console.log(`[${label.padEnd(12)}] ${message}`);
}

// ── Test runner ───────────────────────────────────────────────────────────────

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

// ── Test Suite ────────────────────────────────────────────────────────────────

async function runDay2Suite(): Promise<void> {
  console.log("=== SettlrOS Day 2: Concurrent Idempotency ===\n");

  // ── Test 1: Concurrent race — only one transition wins ─────────────────────
  console.log("1. Concurrency Race");

  await test("two simultaneous transitions — exactly one applies", async () => {
    const ledger     = new InMemoryLedger();
    const settlement = new Settlement("RACE-001", "owner-1", ledger);
    await settlement.start();

    const [r1, r2] = await Promise.all([
      settlement.transitionTo("INITIATED", "PENDING", "owner-1", "key-race-1"),
      settlement.transitionTo("INITIATED", "PENDING", "owner-1", "key-race-2"),
    ]);

    const outcomes = [r1.status, r2.status];
    const applied  = outcomes.filter((s) => s === "applied").length;
    const rejected = outcomes.filter((s) => s === "conflict").length;

    log("RACE", `outcomes: ${outcomes.join(", ")}`);
    assert(applied  === 1, `expected 1 applied, got ${applied}`);
    assert(rejected === 1, `expected 1 conflict, got ${rejected}`);
    assert(settlement.getState() === "PENDING", `final state should be PENDING`);
  });

  await test("state after race is consistent — no fork", async () => {
    const ledger     = new InMemoryLedger();
    const settlement = new Settlement("RACE-002", "owner-1", ledger);
    await settlement.start();

    await Promise.all([
      settlement.transitionTo("INITIATED", "PENDING", "owner-1", "key-a"),
      settlement.transitionTo("INITIATED", "PENDING", "owner-1", "key-b"),
    ]);

    const events = await ledger.fetchEvents("RACE-002");
    const pendingCount = events.filter((e) => e.state === "PENDING").length;

    log("FORK", `ledger has ${pendingCount} PENDING event(s)`);
    assert(pendingCount === 1, `ledger must have exactly 1 PENDING — got ${pendingCount}`);
  });

  // ── Test 2: Idempotency — same key, same outcome ────────────────────────────
  console.log("\n2. Idempotency Key");

  await test("same idempotency key applied twice — second is a no-op", async () => {
    const ledger     = new InMemoryLedger();
    const settlement = new Settlement("IDEM-001", "owner-1", ledger);
    await settlement.start();

    const r1 = await settlement.transitionTo("INITIATED", "PENDING", "owner-1", "idem-key-1");
    const r2 = await settlement.transitionTo("INITIATED", "PENDING", "owner-1", "idem-key-1");

    log("IDEM", `first: ${r1.status} | second: ${r2.status}`);
    assert(r1.status === "applied",   `first call should be applied`);
    assert(r2.status === "duplicate", `second call with same key should be duplicate`);
  });

  await test("duplicate call does not add extra ledger entries", async () => {
    const ledger     = new InMemoryLedger();
    const settlement = new Settlement("IDEM-002", "owner-1", ledger);
    await settlement.start();

    await settlement.transitionTo("INITIATED", "PENDING", "owner-1", "idem-key-2");
    await settlement.transitionTo("INITIATED", "PENDING", "owner-1", "idem-key-2"); // retry

    const events = await ledger.fetchEvents("IDEM-002");
    log("IDEM", `ledger entry count: ${events.length}`);
    assert(events.length === 2, `expected 2 entries (INITIATED + PENDING), got ${events.length}`);
  });

  // ── Test 3: Replay correctness after race and retry ─────────────────────────
  console.log("\n3. Replay Safety");

  await test("replay matches in-memory state after a concurrency race", async () => {
    const ledger      = new InMemoryLedger();
    const settlement  = new Settlement("REPLAY-001", "owner-1", ledger);
    const replay      = new ReplayEngine(ledger);
    await settlement.start();

    await Promise.all([
      settlement.transitionTo("INITIATED", "PENDING", "owner-1", "r-key-1"),
      settlement.transitionTo("INITIATED", "PENDING", "owner-1", "r-key-2"),
    ]);

    const inMemory = settlement.getState();
    const replayed = await replay.replaySettlement("REPLAY-001");

    log("REPLAY", `in-memory: ${inMemory} | replayed: ${replayed}`);
    assert(inMemory === replayed, `replay mismatch: ${inMemory} vs ${replayed}`);
  });

  await test("replay is correct after idempotent retry then further transition", async () => {
    const ledger     = new InMemoryLedger();
    const settlement = new Settlement("REPLAY-002", "owner-1", ledger);
    const replay     = new ReplayEngine(ledger);
    await settlement.start();

    await settlement.transitionTo("INITIATED", "PENDING",   "owner-1", "rp-key-1");
    await settlement.transitionTo("INITIATED", "PENDING",   "owner-1", "rp-key-1"); // retry
    await settlement.transitionTo("PENDING",   "COMPLETED", "owner-1", "rp-key-2");

    const inMemory = settlement.getState();
    const replayed = await replay.replaySettlement("REPLAY-002");

    log("REPLAY", `in-memory: ${inMemory} | replayed: ${replayed}`);
    assert(inMemory === "COMPLETED", `expected COMPLETED, got ${inMemory}`);
    assert(inMemory === replayed,    `replay mismatch after retry: ${inMemory} vs ${replayed}`);
  });

  await test("terminal state replay is stable — no further transitions possible", async () => {
    const ledger     = new InMemoryLedger();
    const settlement = new Settlement("REPLAY-003", "owner-1", ledger);
    const replay     = new ReplayEngine(ledger);
    const sm         = new StateMachine();
    await settlement.start();

    await settlement.transitionTo("INITIATED", "PENDING", "owner-1", "t-key-1");
    await settlement.transitionTo("PENDING", "FAILED",   "owner-1", "t-key-2");

    const replayed = await replay.replaySettlement("REPLAY-003");
    log("REPLAY", `terminal state: ${replayed}`);
    assert(replayed === "FAILED", `expected FAILED, got ${replayed}`);
    assert(sm.isTerminal(replayed), `FAILED must be terminal`);
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n=== Day 2 Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runDay2Suite().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});