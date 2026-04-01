import { ILedger } from "./ledger";
import { StateMachine, SettlementState } from "./stateMachine";

// ── ReplayEngine ──────────────────────────────────────────────────────────────
// Reconstructs settlement state deterministically from ledger events.
// No SQL. No PoolClient. Works with any ILedger implementation.

export class ReplayEngine {
  private readonly ledger: ILedger;
  private readonly stateMachine: StateMachine;

  constructor(ledger: ILedger) {
    this.ledger = ledger;
    this.stateMachine = new StateMachine();
  }

  async replaySettlement(settlementReference: string): Promise<SettlementState> {
    const events = await this.ledger.fetchEvents(settlementReference);

    if (events.length === 0) {
      throw new Error(
        `No ledger events found for settlement: ${settlementReference}`
      );
    }

    // First event must always be the initial state
    let state = this.stateMachine.getInitialState();

    // Walk each subsequent event, validating every transition in sequence
    for (let i = 1; i < events.length; i++) {
      const nextState = events[i].state as SettlementState;
      this.stateMachine.validateTransition(state, nextState);
      state = nextState;
    }

    return state;
  }
}