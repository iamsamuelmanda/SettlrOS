"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateMachine = void 0;
// Allowed transitions map
const transitions = {
    INITIATED: ["PENDING"],
    PENDING: ["COMPLETED", "FAILED"],
    COMPLETED: [],
    FAILED: [],
};
class StateMachine {
    getInitialState() {
        return "INITIATED";
    }
    // Validate transitions, including replay
    validateTransition(from, to) {
        const allowed = transitions[from];
        if (!allowed.includes(to)) {
            throw new Error(`Invalid state transition: ${from} → ${to}`);
        }
    }
    // Check if a state is terminal
    isTerminal(state) {
        return transitions[state].length === 0;
    }
    // [DAY1 FIX] Get next valid states
    getNextStates(from) {
        return transitions[from];
    }
}
exports.StateMachine = StateMachine;
