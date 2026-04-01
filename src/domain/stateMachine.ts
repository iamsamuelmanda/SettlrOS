// ── State type — single source of truth across the entire domain ─────────────

export type SettlementState = "INITIATED" | "PENDING" | "COMPLETED" | "FAILED";

// ── Allowed transitions ───────────────────────────────────────────────────────

const TRANSITIONS: Record<SettlementState, SettlementState[]> = {
  INITIATED: ["PENDING"],
  PENDING:   ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED:    [],
};

// ── StateMachine ──────────────────────────────────────────────────────────────

export class StateMachine {
  getInitialState(): SettlementState {
    return "INITIATED";
  }

  validateTransition(from: SettlementState, to: SettlementState): void {
    const allowed = TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid transition: ${from} → ${to}`);
    }
  }

  getNextStates(from: SettlementState): SettlementState[] {
    return TRANSITIONS[from];
  }

  isTerminal(state: SettlementState): boolean {
    return TRANSITIONS[state].length === 0;
  }
}