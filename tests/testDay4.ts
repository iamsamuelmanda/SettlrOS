import { buildServer } from "../src/server/server";

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

// ── Test Suite ────────────────────────────────────────────────────────────────

async function runDay4Suite(): Promise<void> {
  console.log("=== SettlrOS Day 4: REST API Layer ===\n");

  const app = buildServer();
  await app.ready();

  // ── 1. POST /settlements ────────────────────────────────────────────────────
  console.log("1. POST /settlements");

  await test("valid API key creates settlement and returns 201", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "API-001", owner: "user-1" },
    });

    assert(res.statusCode === 201, `expected 201, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(body.reference === "API-001",  "reference must match");
    assert(body.state === "INITIATED",    "state must be INITIATED");
    assert(body.tenantId === "tenant1",   "tenantId must be tenant1");
    console.log(`    response: ${res.payload}`);
  });

  await test("invalid API key returns 401", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer bad_key" },
      payload: { reference: "API-002", owner: "user-1" },
    });

    assert(res.statusCode === 401, `expected 401, got ${res.statusCode}`);
  });

  await test("missing authorization header returns 401", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/settlements",
      payload: { reference: "API-003", owner: "user-1" },
    });

    assert(res.statusCode === 401, `expected 401, got ${res.statusCode}`);
  });

  await test("duplicate reference returns 409", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "API-DUP", owner: "user-1" },
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "API-DUP", owner: "user-1" },
    });

    assert(res.statusCode === 409, `expected 409, got ${res.statusCode}`);
  });

  // ── 2. GET /settlements/:ref ─────────────────────────────────────────────────
  console.log("\n2. GET /settlements/:ref");

  await test("returns settlement state for valid key", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "GET-001", owner: "user-1" },
    });

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements/GET-001",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(body.state === "INITIATED", `expected INITIATED, got ${body.state}`);
    console.log(`    response: ${res.payload}`);
  });

  await test("returns 404 for unknown reference", async () => {
    const res = await app.inject({
      method:  "GET",
      url:     "/settlements/UNKNOWN",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 404, `expected 404, got ${res.statusCode}`);
  });

  // ── 3. POST /settlements/:ref/transition ─────────────────────────────────────
  console.log("\n3. POST /settlements/:ref/transition");

  await test("valid transition returns 200 and new state", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "TRANS-001", owner: "user-1" },
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/settlements/TRANS-001/transition",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: {
        expectedState:  "INITIATED",
        nextState:      "PENDING",
        idempotencyKey: "trans-key-001",
      },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(body.state === "PENDING", `expected PENDING, got ${body.state}`);
    console.log(`    response: ${res.payload}`);
  });

  await test("invalid transition returns 422", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "TRANS-002", owner: "user-1" },
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/settlements/TRANS-002/transition",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: {
        expectedState:  "INITIATED",
        nextState:      "COMPLETED",   // illegal — must go via PENDING
        idempotencyKey: "trans-key-002",
      },
    });

    assert(res.statusCode === 422, `expected 422, got ${res.statusCode}`);
  });

  await test("duplicate idempotency key returns 200 as no-op", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "TRANS-003", owner: "user-1" },
    });

    const payload = {
      expectedState:  "INITIATED",
      nextState:      "PENDING",
      idempotencyKey: "idem-key-003",
    };

    await app.inject({
      method:  "POST",
      url:     "/settlements/TRANS-003/transition",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload,
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/settlements/TRANS-003/transition",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload,
    });

    assert(res.statusCode === 200, `expected 200 for duplicate, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(body.outcome === "duplicate", `expected duplicate outcome, got ${body.outcome}`);
  });

  // ── 4. Multi-tenant isolation ─────────────────────────────────────────────
  console.log("\n4. Multi-Tenant Isolation");

  await test("tenant1 cannot read tenant2 settlements", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant2" },
      payload: { reference: "T2-ONLY", owner: "user-2" },
    });

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements/T2-ONLY",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 404, `expected 404, got ${res.statusCode}`);
  });

  await test("tenant1 cannot transition tenant2 settlements", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant2" },
      payload: { reference: "T2-TRANS", owner: "user-2" },
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/settlements/T2-TRANS/transition",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: {
        expectedState:  "INITIATED",
        nextState:      "PENDING",
        idempotencyKey: "cross-tenant-key",
      },
    });

    assert(res.statusCode === 404, `expected 404, got ${res.statusCode}`);
  });

  await test("two tenants can hold settlements with the same reference independently", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "SHARED-REF", owner: "user-1" },
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant2" },
      payload: { reference: "SHARED-REF", owner: "user-2" },
    });

    assert(res.statusCode === 201, `tenant2 should create same ref independently, got ${res.statusCode}`);
  });

  // ── 5. Replay via API ─────────────────────────────────────────────────────
  console.log("\n5. GET /settlements/:ref/replay");

  await test("replay endpoint reconstructs final state from ledger", async () => {
    await app.inject({
      method:  "POST",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { reference: "REPLAY-API-001", owner: "user-1" },
    });

    await app.inject({
      method:  "POST",
      url:     "/settlements/REPLAY-API-001/transition",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { expectedState: "INITIATED", nextState: "PENDING", idempotencyKey: "rp-1" },
    });

    await app.inject({
      method:  "POST",
      url:     "/settlements/REPLAY-API-001/transition",
      headers: { authorization: "Bearer api_key_tenant1" },
      payload: { expectedState: "PENDING", nextState: "COMPLETED", idempotencyKey: "rp-2" },
    });

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements/REPLAY-API-001/replay",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(body.replayedState === "COMPLETED", `expected COMPLETED, got ${body.replayedState}`);
    console.log(`    response: ${res.payload}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  await app.close();
  console.log(`\n=== Day 4 Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runDay4Suite().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});