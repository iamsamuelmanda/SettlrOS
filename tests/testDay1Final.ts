// tests/testDay1Final.ts
import { Ledger } from "../src/domain/ledger";
import { Settlement, SettlementState } from "../src/domain/settlement";
import { StateMachine } from "../src/domain/stateMachine";
import { ReplayEngine } from "../src/domain/replayEngine";

// -----------------------------
// CONFIGURATION
// -----------------------------
const NUM_SETTLEMENTS = 5;
const MAX_TRANSITIONS = 5;
const FAILURE_INJECTION_PROB = 0.1;

// -----------------------------
// HELPER FUNCTIONS
// -----------------------------
function randomBoolean(prob: number): boolean {
    return Math.random() < prob;
}

// -----------------------------
// MAIN SANDBOX FUNCTION
// -----------------------------
async function runDay1Sandbox() {
    const ledger = new Ledger();
    const stateMachine = new StateMachine();
    const replayEngine = new ReplayEngine(ledger);

    console.log("=== Day 1 Sandbox: Starting ===");

    // Step 1: truncate tables for rerunnable sandbox
    await ledger.withTransaction(async (client) => {
        await client.query("TRUNCATE ledger_entries, settlements RESTART IDENTITY CASCADE");
        console.log("[DB] Truncated settlements and ledger_entries");
    });

    // Step 2: create settlements
    const settlements: Settlement[] = [];
    for (let i = 0; i < NUM_SETTLEMENTS; i++) {
        const ref = `SETTLEMENT-${i + 1}`;
        const owner = `owner-${i + 1}`;
        settlements.push(new Settlement(ref, owner, ledger));
    }

    console.log(`[INFO] Created ${NUM_SETTLEMENTS} settlement instances`);

    // Step 3: start all settlements concurrently
    await Promise.all(settlements.map(async (s) => {
        try {
            await s.start();
            console.log(`[START] ${s["reference"]} initiated`);
        } catch (err: unknown) {
            console.error(`[ERROR] Starting ${s["reference"]}:`, (err as Error).message);
        }
    }));

    // Step 4: simulate transitions
    for (let t = 0; t < MAX_TRANSITIONS; t++) {
        await Promise.all(settlements.map(async (s) => {
            const currentState: SettlementState = s.getState();
            const possibleNext: SettlementState[] = stateMachine.getNextStates(currentState);
            if (possibleNext.length === 0) return;

            const nextState: SettlementState = possibleNext[Math.floor(Math.random() * possibleNext.length)];

            // simulate failure injection
            if (randomBoolean(FAILURE_INJECTION_PROB)) {
                console.log(`[FAIL] Simulating failure for ${s["reference"]} ${currentState} → ${nextState}`);
                return;
            }

            try {
                await s.transitionTo(currentState, nextState, s["owner"]);
                console.log(`[TRANSITION] ${s["reference"]}: ${currentState} → ${nextState}`);
            } catch (err: unknown) {
                console.error(`[ERROR] Transition ${s["reference"]}:`, (err as Error).message);
            }
        }));
    }

    // Step 5: replay settlements deterministically
    await ledger.withTransaction(async (client) => {
        for (const s of settlements) {
            try {
                const finalState = await replayEngine.replaySettlement(s["reference"], client);
                console.log(`[REPLAY] ${s["reference"]} final state: ${finalState}`);
            } catch (err: unknown) {
                console.error(`[ERROR] Replay ${s["reference"]}:`, (err as Error).message);
            }
        }
    });

    await ledger.close();
    console.log("=== Day 1 Sandbox: Completed ===");
}

// -----------------------------
// Execute
// -----------------------------
runDay1Sandbox()
    .then(() => console.log("[SUCCESS] Day 1 sandbox finished"))
    .catch((err) => {
        console.error("[FATAL] Sandbox failed:", err);
        process.exit(1);
    });
