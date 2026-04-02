import { InMemoryLedger } from "../domain/ledger";
import { Settlement, SettlementState } from "../domain/settlement";
import { ReplayEngine } from "../domain/replayEngine";

// ── Settlement record — enriched entry stored per tenant ─────────────────────

export interface SettlementRecord {
  settlement: Settlement;
  createdAt:  Date;
}

// ── Valid states for query validation ─────────────────────────────────────────

const VALID_STATES = new Set<string>(["INITIATED", "PENDING", "COMPLETED", "FAILED"]);

export function isValidState(s: string): s is SettlementState {
  return VALID_STATES.has(s);
}

// ── TenantContext ─────────────────────────────────────────────────────────────

interface TenantContext {
  ledger:      InMemoryLedger;
  replay:      ReplayEngine;
  settlements: Map<string, SettlementRecord>;
}

// ── TenantStore ───────────────────────────────────────────────────────────────

export class TenantStore {
  private readonly tenants = new Map<string, TenantContext>();

  private getOrCreate(tenantId: string): TenantContext {
    if (!this.tenants.has(tenantId)) {
      const ledger = new InMemoryLedger();
      this.tenants.set(tenantId, {
        ledger,
        replay:      new ReplayEngine(ledger),
        settlements: new Map(),
      });
    }
    return this.tenants.get(tenantId)!;
  }

  createSettlement(tenantId: string, reference: string, owner: string): Settlement {
    const ctx = this.getOrCreate(tenantId);

    if (ctx.settlements.has(reference)) {
      throw new Error(`CONFLICT: settlement ${reference} already exists for tenant ${tenantId}`);
    }

    const settlement = new Settlement(reference, owner, ctx.ledger);
    ctx.settlements.set(reference, { settlement, createdAt: new Date() });
    return settlement;
  }

  getSettlement(tenantId: string, reference: string): Settlement | null {
    return this.tenants.get(tenantId)?.settlements.get(reference)?.settlement ?? null;
  }

  getRecord(tenantId: string, reference: string): SettlementRecord | null {
    return this.tenants.get(tenantId)?.settlements.get(reference) ?? null;
  }

  listSettlements(tenantId: string, stateFilter?: SettlementState): SettlementRecord[] {
    const ctx = this.tenants.get(tenantId);
    if (!ctx) return [];

    const records = Array.from(ctx.settlements.values());
    if (!stateFilter) return records;

    return records.filter((r) => r.settlement.getState() === stateFilter);
  }

  getReplay(tenantId: string): ReplayEngine | null {
    return this.tenants.get(tenantId)?.replay ?? null;
  }
}