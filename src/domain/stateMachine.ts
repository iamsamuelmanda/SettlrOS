export type SettlementState =
    | "INITIATED"
    | "PENDING"
    | "COMPLETED"
    | "FAILED";

// Allowed transitions map
const transitions: Record<SettlementState, SettlementState[]> = {
    INITIATED: ["PENDING"],
    PENDING: ["COMPLETED", "FAILED"],
    COMPLETED: [],
    FAILED: [],
};

export class StateMachine {
    getInitialState(): SettlementState {
        return "INITIATED";
    }

    // Validate transitions, including replay
    validateTransition(from: SettlementState, to: SettlementState): void {
        const allowed = transitions[from];
        if (!allowed.includes(to)) {
            throw new Error(`Invalid state transition: ${from} → ${to}`);
        }
    }

    // Check if a state is terminal
    isTerminal(state: SettlementState): boolean {
        return transitions[state].length === 0;
    }

    // [DAY1 FIX] Get next valid states
    getNextStates(from: SettlementState): SettlementState[] {
        return transitions[from];
    }
}
