import { InMemoryLedger } from "../domain/ledger";
import { Settlement } from "../domain/settlement";
import { ReplayEngine } from "../domain/replayEngine";

// ── TenantStore ───────────────────────────────────────────────────────────────
// Each tenant gets its own ledger and settlement registry.
// Tenants are fully isolated — no shared state.

interface TenantContext {
  ledger:      InMemoryLedger;
  replay:      ReplayEngine;
  settlements: Map<string, Settlement>;
}

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
    ctx.settlements.set(reference, settlement);
    return settlement;
  }

  getSettlement(tenantId: string, reference: string): Settlement | null {
    return this.tenants.get(tenantId)?.settlements.get(reference) ?? null;
  }

  getReplay(tenantId: string): ReplayEngine | null {
    return this.tenants.get(tenantId)?.replay ?? null;
  }
}