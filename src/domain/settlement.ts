import { ILedger, LedgerEntry } from "./ledger";
import { StateMachine, SettlementState } from "./stateMachine";

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
    expectedState: SettlementState,
    nextState: SettlementState,
    nextOwner: string
  ): Promise<void> {
    if (this.currentState !== expectedState) {
      throw new Error(
        `State mismatch: expected ${expectedState}, current is ${this.currentState}`
      );
    }

    // Validates against transition map — throws if illegal
    this.stateMachine.validateTransition(this.currentState, nextState);

    this.version += 1;

    const entry: LedgerEntry = {
      settlementReference: this.reference,
      state: nextState,
      sequenceNumber: this.version,
    };

    await this.ledger.append(entry);

    // In-memory state updated only after ledger write succeeds
    this.currentState = nextState;
    this.owner = nextOwner;
  }
}