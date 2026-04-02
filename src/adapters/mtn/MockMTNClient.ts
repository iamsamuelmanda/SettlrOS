import { randomUUID } from "crypto";

// ── MTN transfer status as MTN defines it ─────────────────────────────────────
export type MTNTransferStatus = "PENDING" | "SUCCESSFUL" | "FAILED";

export interface MTNTransferRecord {
  referenceId: string;
  amount:      number;
  currency:    string;
  payee:       string;
  note:        string;
  status:      MTNTransferStatus;
}

// ── MockMTNClient ─────────────────────────────────────────────────────────────
// Simulates MTN MoMo API behavior without network calls.
// Stores transfers in memory. Test helpers allow controlled resolution.

export class MockMTNClient {
  private readonly transfers = new Map<string, MTNTransferRecord>();

  // Simulates POST /collection/v1_0/requesttopay
  // Real MTN: returns 202 Accepted with X-Reference-Id header
  async requestToPay(params: {
    amount:   number;
    currency: string;
    payee:    string;
    note:     string;
  }): Promise<{ referenceId: string }> {
    const referenceId = randomUUID();
    this.transfers.set(referenceId, { referenceId, ...params, status: "PENDING" });
    return { referenceId };
  }

  // Simulates GET /collection/v1_0/requesttopay/{referenceId}
  // Real MTN: returns transfer object with status field
  async getTransferStatus(referenceId: string): Promise<MTNTransferRecord> {
    const transfer = this.transfers.get(referenceId);
    if (!transfer) {
      throw new Error(`MTN: transfer not found — referenceId: ${referenceId}`);
    }
    return { ...transfer };
  }

  // ── Test helpers — simulate MTN resolving a transfer ─────────────────────────

  simulateSuccess(referenceId: string): void {
    const transfer = this.transfers.get(referenceId);
    if (!transfer) throw new Error(`MockMTNClient: unknown referenceId ${referenceId}`);
    transfer.status = "SUCCESSFUL";
  }

  simulateFailure(referenceId: string): void {
    const transfer = this.transfers.get(referenceId);
    if (!transfer) throw new Error(`MockMTNClient: unknown referenceId ${referenceId}`);
    transfer.status = "FAILED";
  }
}