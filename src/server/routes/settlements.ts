import { FastifyInstance } from "fastify";
import { TenantStore } from "../tenantStore";
import { extractApiKey, resolveTenant } from "../auth";
import { randomUUID } from "crypto";

// ── Auth helper ───────────────────────────────────────────────────────────────

function authenticate(
  app:     FastifyInstance,
  store:   TenantStore,
  headers: { authorization?: string }
): string {
  const key      = extractApiKey(headers.authorization);
  const tenantId = key ? resolveTenant(key) : null;

  if (!tenantId) {
    throw app.httpErrors.unauthorized("Invalid or missing API key");
  }

  return tenantId;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function settlementRoutes(
  app:   FastifyInstance,
  store: TenantStore
): Promise<void> {

  // POST /settlements — create a new settlement
  app.post<{
    Body: { reference: string; owner: string };
  }>("/settlements", async (req, reply) => {
    const tenantId  = authenticate(app, store, req.headers);
    const { reference, owner } = req.body;

    let settlement;
    try {
      settlement = store.createSettlement(tenantId, reference, owner);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("CONFLICT")) {
        return reply.status(409).send({ error: "Settlement reference already exists" });
      }
      throw err;
    }

    await settlement.start();

    return reply.status(201).send({
      reference: settlement.getReference(),
      state:     settlement.getState(),
      tenantId,
    });
  });

  // GET /settlements/:ref — read settlement state
  app.get<{
    Params: { ref: string };
  }>("/settlements/:ref", async (req, reply) => {
    const tenantId  = authenticate(app, store, req.headers);
    const settlement = store.getSettlement(tenantId, req.params.ref);

    if (!settlement) {
      return reply.status(404).send({ error: "Settlement not found" });
    }

    return reply.status(200).send({
      reference: settlement.getReference(),
      state:     settlement.getState(),
      version:   settlement.getVersion(),
      tenantId,
    });
  });

  // POST /settlements/:ref/transition — advance settlement state
  app.post<{
    Params: { ref: string };
    Body:   { expectedState: string; nextState: string; idempotencyKey?: string };
  }>("/settlements/:ref/transition", async (req, reply) => {
    const tenantId   = authenticate(app, store, req.headers);
    const settlement = store.getSettlement(tenantId, req.params.ref);

    if (!settlement) {
      return reply.status(404).send({ error: "Settlement not found" });
    }

    const { expectedState, nextState, idempotencyKey } = req.body;
    const key = idempotencyKey ?? randomUUID();

    let outcome;
    try {
      outcome = await settlement.transitionTo(
        expectedState as any,
        nextState     as any,
        settlement.getOwner(),
        key
      );
    } catch (err) {
      return reply.status(422).send({ error: (err as Error).message });
    }

    if (outcome.status === "conflict") {
      return reply.status(422).send({
        error:        "State conflict",
        currentState: outcome.currentState,
      });
    }

    return reply.status(200).send({
      reference: settlement.getReference(),
      state:     settlement.getState(),
      outcome:   outcome.status,
      tenantId,
    });
  });

  // GET /settlements/:ref/replay — reconstruct state from ledger events
  app.get<{
    Params: { ref: string };
  }>("/settlements/:ref/replay", async (req, reply) => {
    const tenantId   = authenticate(app, store, req.headers);
    const settlement = store.getSettlement(tenantId, req.params.ref);

    if (!settlement) {
      return reply.status(404).send({ error: "Settlement not found" });
    }

    const replay = store.getReplay(tenantId);
    if (!replay) {
      return reply.status(500).send({ error: "Replay engine unavailable" });
    }

    const replayedState = await replay.replaySettlement(req.params.ref);

    return reply.status(200).send({
      reference:     settlement.getReference(),
      replayedState,
      tenantId,
    });
  });
}