import { ILedger, LedgerEntry } from "./ledger";
import { StateMachine, SettlementState } from "./stateMachine";

export type TransitionOutcome =
  | { status: "applied";   state: SettlementState }
  | { status: "duplicate"; state: SettlementState }
  | { status: "conflict";  currentState: SettlementState };

export { SettlementState };

// ── Settlement — pure domain class ───────────────────────────────────────────
// No SQL. No PoolClient. No network.
// All persistence happens through ILedger — injected at construction.

export class Settlement {
  private readonly reference: string;
  private owner: string;
  private readonly ledger: ILedger;
  private readonly stateMachine: StateMachine;
  private currentState: SettlementState;
  private version: number;

  constructor(reference: string, owner: string, ledger: ILedger) {
    this.reference = reference;
    this.owner = owner;
    this.ledger = ledger;
    this.stateMachine = new StateMachine();
    this.currentState = this.stateMachine.getInitialState();
    this.version = 0;
  }

  // ── Public accessors ────────────────────────────────────────────────────────

  getReference(): string {
    return this.reference;
  }

  getState(): SettlementState {
    return this.currentState;
  }

  getOwner(): string {
    return this.owner;
  }

  getVersion(): number {
    return this.version;
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.version = 1;

    const entry: LedgerEntry = {
      settlementReference: this.reference,
      state: this.currentState,
      sequenceNumber: this.version,
    };

    await this.ledger.append(entry);
  }

  async transitionTo(
    expectedState:  SettlementState,
    nextState:      SettlementState,
    nextOwner:      string,
    idempotencyKey: string,
    metadata?:      Record<string, string>
  ): Promise<TransitionOutcome> {

    // Idempotency check — same key seen before, return without re-processing
    const seen = await this.ledger.hasIdempotencyKey(idempotencyKey);
    if (seen) {
      return { status: "duplicate", state: this.currentState };
    }

    // Concurrency guard — checked synchronously before any await
    // A losing concurrent caller sees the already-advanced state here
    if (this.currentState !== expectedState) {
      return { status: "conflict", currentState: this.currentState };
    }

    this.stateMachine.validateTransition(this.currentState, nextState);

    // Snapshot for rollback
    const prevState   = this.currentState;
    const prevOwner   = this.owner;
    const prevVersion = this.version;

    // Advance in-memory state BEFORE await so concurrent callers are blocked
    this.currentState = nextState;
    this.owner        = nextOwner;
    this.version     += 1;

    const entry: LedgerEntry = {
      settlementReference: this.reference,
      state:               nextState,
      sequenceNumber:      this.version,
      idempotencyKey,
      metadata,
    };

    try {
      await this.ledger.append(entry);
      return { status: "applied", state: this.currentState };
    } catch (err) {
      // Ledger write failed — roll back in-memory state fully
      this.currentState = prevState;
      this.owner        = prevOwner;
      this.version      = prevVersion;
      throw err;
    }
  }
}