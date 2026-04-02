import { randomUUID } from "crypto";
import { Settlement } from "../../domain/settlement";
import { MockMTNClient, MTNTransferStatus } from "./MockMTNClient";

// ── Input / output types ──────────────────────────────────────────────────────

export interface TransferParams {
  amount:   number;
  currency: string;
  payee:    string;
  note:     string;
}

export interface SubmitResult {
  providerReference: string;
  status:            "submitted";
}

export interface CallbackPayload {
  providerReference: string;
  status:            "SUCCESSFUL" | "FAILED";
}

export interface PollResult {
  providerReference: string;
  resolvedStatus:    "COMPLETED" | "FAILED" | "PENDING";
}

export interface ReconcileEntry {
  providerReference: string;
  settlement:        Settlement;
}

export interface ReconcileResult {
  providerReference: string;
  resolvedStatus:    "COMPLETED" | "FAILED" | "PENDING";
}

// ── MTN status → domain state mapping ────────────────────────────────────────
// The adapter is the ONLY place that knows about MTN statuses.
// Domain states never leak into the adapter, and MTN statuses never
// leak into the domain.

function toDomainState(
  mtnStatus: MTNTransferStatus
): "COMPLETED" | "FAILED" | "PENDING" {
  switch (mtnStatus) {
    case "SUCCESSFUL": return "COMPLETED";
    case "FAILED":     return "FAILED";
    case "PENDING":    return "PENDING";
  }
}

// ── MTNMoMoAdapter ────────────────────────────────────────────────────────────

export class MTNMoMoAdapter {
  private readonly client: MockMTNClient;

  // Known provider references — maps referenceId → true for validation
  private readonly knownRefs = new Set<string>();

  constructor(client: MockMTNClient) {
    this.client = client;
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  // Sends payout request to MTN. Stores provider reference in ledger metadata.
  // Transitions settlement INITIATED → PENDING.

  async submitTransfer(
    settlement: Settlement,
    params:     TransferParams
  ): Promise<SubmitResult> {
    const { referenceId } = await this.client.requestToPay(params);

    this.knownRefs.add(referenceId);

    const idempotencyKey = `submit-${settlement.getReference()}-${randomUUID()}`;

    await settlement.transitionTo(
      "INITIATED",
      "PENDING",
      settlement.getOwner(),
      idempotencyKey,
      { providerReference: referenceId }   // stored in ledger event metadata
    );

    return { providerReference: referenceId, status: "submitted" };
  }

  // ── Callback ────────────────────────────────────────────────────────────────
  // Called when MTN POSTs a webhook. Maps result to domain transition.

  async handleCallback(
    payload:    CallbackPayload,
    settlement: Settlement
  ): Promise<void> {
    if (!this.knownRefs.has(payload.providerReference)) {
      throw new Error(
        `MTNMoMoAdapter: unknown provider reference — ${payload.providerReference}`
      );
    }

    const domainState = toDomainState(payload.status);

    if (domainState === "PENDING") {
      // Callback arrived but status still pending — nothing to transition yet
      return;
    }

    const idempotencyKey = `callback-${payload.providerReference}`;

    await settlement.transitionTo(
      "PENDING",
      domainState,
      settlement.getOwner(),
      idempotencyKey,
      { providerReference: payload.providerReference }
    );
  }

  // ── Poll ────────────────────────────────────────────────────────────────────
  // Called when a callback was missed. Queries MTN directly for current status.

  async pollStatus(
    providerReference: string,
    settlement:        Settlement
  ): Promise<PollResult> {
    const transfer     = await this.client.getTransferStatus(providerReference);
    const domainState  = toDomainState(transfer.status);

    if (domainState !== "PENDING") {
      const idempotencyKey = `poll-${providerReference}`;
      await settlement.transitionTo(
        "PENDING",
        domainState,
        settlement.getOwner(),
        idempotencyKey,
        { providerReference }
      );
    }

    return { providerReference, resolvedStatus: domainState };
  }

  // ── Reconcile ───────────────────────────────────────────────────────────────
  // Batch poll all pending transfers in one pass. Closes the async gap.

  async reconcilePending(
    entries: ReconcileEntry[]
  ): Promise<ReconcileResult[]> {
    return Promise.all(
      entries.map(async ({ providerReference, settlement }) => {
        const result = await this.pollStatus(providerReference, settlement);
        return { providerReference, resolvedStatus: result.resolvedStatus };
      })
    );
  }
}