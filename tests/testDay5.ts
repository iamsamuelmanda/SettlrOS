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

// ── Seed helper — creates and optionally advances a settlement ────────────────

async function seed(
  app:       ReturnType<typeof buildServer>,
  apiKey:    string,
  reference: string,
  states:    string[] = []
): Promise<void> {
  await app.inject({
    method:  "POST",
    url:     "/settlements",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { reference, owner: "user-1" },
  });

  const transitions: Array<[string, string]> = [
    ["INITIATED", "PENDING"],
    ["PENDING",   "COMPLETED"],
    ["PENDING",   "FAILED"],
  ];

  for (let i = 0; i < states.length; i++) {
    const [expected, next] = transitions.find(([, n]) => n === states[i]) ?? [];
    if (!expected || !next) continue;
    await app.inject({
      method:  "POST",
      url:     `/settlements/${reference}/transition`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { expectedState: expected, nextState: next, idempotencyKey: `${reference}-key-${i}` },
    });
  }
}

// ── Test Suite ────────────────────────────────────────────────────────────────

async function runDay5Suite(): Promise<void> {
  console.log("=== SettlrOS Day 5: Reconciliation Report ===\n");

  const app = buildServer();
  await app.ready();

  // ── 1. GET /settlements — full list ──────────────────────────────────────────
  console.log("1. GET /settlements — full list");

  await test("returns all settlements for the tenant", async () => {
    await seed(app, "api_key_tenant1", "LIST-001");
    await seed(app, "api_key_tenant1", "LIST-002", ["PENDING"]);
    await seed(app, "api_key_tenant1", "LIST-003", ["PENDING", "COMPLETED"]);

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(Array.isArray(body.settlements), "response must have settlements array");
    assert(body.settlements.length >= 3,    `expected at least 3, got ${body.settlements.length}`);
    assert(typeof body.total === "number",  "response must include total count");
    console.log(`    total: ${body.total}, states: ${body.settlements.map((s: any) => s.state).join(", ")}`);
  });

  await test("returns 401 for missing API key", async () => {
    const res = await app.inject({ method: "GET", url: "/settlements" });
    assert(res.statusCode === 401, `expected 401, got ${res.statusCode}`);
  });

  // ── 2. GET /settlements?state=PENDING ─────────────────────────────────────
  console.log("\n2. Filtering by state");

  await test("state=PENDING returns only pending settlements", async () => {
    await seed(app, "api_key_tenant1", "FILT-001");                          // INITIATED
    await seed(app, "api_key_tenant1", "FILT-002", ["PENDING"]);             // PENDING
    await seed(app, "api_key_tenant1", "FILT-003", ["PENDING"]);             // PENDING
    await seed(app, "api_key_tenant1", "FILT-004", ["PENDING", "COMPLETED"]); // COMPLETED

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements?state=PENDING",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    const states = body.settlements.map((s: any) => s.state) as string[];
    assert(states.every((s) => s === "PENDING"), `all returned states must be PENDING, got: ${states.join(", ")}`);
    assert(body.settlements.length >= 2, `expected at least 2 PENDING, got ${body.settlements.length}`);
    console.log(`    PENDING count: ${body.settlements.length}`);
  });

  await test("state=COMPLETED returns only completed settlements", async () => {
    await seed(app, "api_key_tenant1", "FILT-005", ["PENDING", "COMPLETED"]);
    await seed(app, "api_key_tenant1", "FILT-006", ["PENDING", "COMPLETED"]);

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements?state=COMPLETED",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    const states = body.settlements.map((s: any) => s.state) as string[];
    assert(states.every((s) => s === "COMPLETED"), `all must be COMPLETED, got: ${states.join(", ")}`);
    console.log(`    COMPLETED count: ${body.settlements.length}`);
  });

  await test("state=FAILED returns only failed settlements", async () => {
    await seed(app, "api_key_tenant1", "FILT-007", ["PENDING", "FAILED"]);

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements?state=FAILED",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    const states = body.settlements.map((s: any) => s.state) as string[];
    assert(states.every((s) => s === "FAILED"), `all must be FAILED, got: ${states.join(", ")}`);
    console.log(`    FAILED count: ${body.settlements.length}`);
  });

  await test("invalid state value returns 422", async () => {
    const res = await app.inject({
      method:  "GET",
      url:     "/settlements?state=UNKNOWN",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    assert(res.statusCode === 422, `expected 422, got ${res.statusCode}`);
  });

  // ── 3. Empty results ──────────────────────────────────────────────────────
  console.log("\n3. Empty results");

  await test("new tenant with no settlements returns empty list", async () => {
    const res = await app.inject({
      method:  "GET",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant2" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(Array.isArray(body.settlements), "must return settlements array");
    assert(body.total === 0,                `expected total 0, got ${body.total}`);
    console.log(`    response: ${res.payload}`);
  });

  await test("filter with no matches returns empty list — not 404", async () => {
    // tenant2 has no FAILED settlements
    const res = await app.inject({
      method:  "GET",
      url:     "/settlements?state=FAILED",
      headers: { authorization: "Bearer api_key_tenant2" },
    });

    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    const body = JSON.parse(res.payload);
    assert(body.settlements.length === 0, `expected 0 results, got ${body.settlements.length}`);
  });

  // ── 4. Response shape ─────────────────────────────────────────────────────
  console.log("\n4. Response shape");

  await test("each settlement item has reference, state, version, and createdAt", async () => {
    await seed(app, "api_key_tenant1", "SHAPE-001", ["PENDING"]);

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements?state=PENDING",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    const body = JSON.parse(res.payload);
    const item = body.settlements.find((s: any) => s.reference === "SHAPE-001");
    assert(!!item,                      "SHAPE-001 must be in results");
    assert(!!item.reference,            "item must have reference");
    assert(!!item.state,                "item must have state");
    assert(typeof item.version === "number", "item must have version");
    assert(!!item.createdAt,            "item must have createdAt");
    console.log(`    item: ${JSON.stringify(item)}`);
  });

  await test("response includes tenantId and a generatedAt timestamp", async () => {
    const res = await app.inject({
      method:  "GET",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    const body = JSON.parse(res.payload);
    assert(!!body.tenantId,     "response must include tenantId");
    assert(!!body.generatedAt,  "response must include generatedAt timestamp");
  });

  // ── 5. Tenant isolation ───────────────────────────────────────────────────
  console.log("\n5. Tenant isolation");

  await test("tenant1 list never contains tenant2 settlements", async () => {
    await seed(app, "api_key_tenant2", "T2-LIST-001", ["PENDING"]);
    await seed(app, "api_key_tenant2", "T2-LIST-002", ["PENDING"]);

    const res = await app.inject({
      method:  "GET",
      url:     "/settlements",
      headers: { authorization: "Bearer api_key_tenant1" },
    });

    const body = JSON.parse(res.payload);
    const refs  = body.settlements.map((s: any) => s.reference) as string[];
    assert(!refs.includes("T2-LIST-001"), "T2-LIST-001 must not appear in tenant1 results");
    assert(!refs.includes("T2-LIST-002"), "T2-LIST-002 must not appear in tenant1 results");
    console.log(`    tenant1 refs: ${refs.join(", ")}`);
  });

  await test("tenant2 pending list is scoped — does not bleed into tenant1", async () => {
    const res = await app.inject({
      method:  "GET",
      url:     "/settlements?state=PENDING",
      headers: { authorization: "Bearer api_key_tenant2" },
    });

    const body = JSON.parse(res.payload);
    assert(body.tenantId === "tenant2", `tenantId must be tenant2, got ${body.tenantId}`);
    const refs = body.settlements.map((s: any) => s.reference) as string[];
    console.log(`    tenant2 PENDING: ${refs.join(", ")}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  await app.close();
  console.log(`\n=== Day 5 Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runDay5Suite().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});