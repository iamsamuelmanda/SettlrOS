import { InMemoryLedger } from "../src/domain/ledger";
import { Settlement, SettlementState } from "../src/domain/settlement";
import { StateMachine } from "../src/domain/stateMachine";
import { ReplayEngine } from "../src/domain/replayEngine";

// ── Configuration ─────────────────────────────────────────────────────────────

const CONFIG = {
  numSettlements:       5,
  maxTransitionRounds:  5,
  failureInjectionProb: 0.1,
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function shouldInjectFailure(probability: number): boolean {
  return Math.random() < probability;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Sandbox ───────────────────────────────────────────────────────────────────

async function runDay1Sandbox(): Promise<void> {
  const ledger        = new InMemoryLedger();   // zero network — runs anywhere
  const stateMachine  = new StateMachine();
  const replayEngine  = new ReplayEngine(ledger);

  console.log("=== SettlrOS Day 1 Sandbox: Starting ===\n");

  // Step 1 — Instantiate settlements
  const settlements: Settlement[] = Array.from(
    { length: CONFIG.numSettlements },
    (_, i) => new Settlement(`SETTLEMENT-${i + 1}`, `owner-${i + 1}`, ledger)
  );

  console.log(`[INIT] ${CONFIG.numSettlements} settlement instances created`);

  // Step 2 — Start all settlements concurrently
  await Promise.all(
    settlements.map(async (s) => {
      try {
        await s.start();
        console.log(`[START]      ${s.getReference()} → ${s.getState()}`);
      } catch (err) {
        console.error(`[ERROR] start(${s.getReference()}):`, (err as Error).message);
      }
    })
  );

  // Step 3 — Simulate concurrent transition rounds
  for (let round = 1; round <= CONFIG.maxTransitionRounds; round++) {
    console.log(`\n[ROUND ${round}]`);

    await Promise.all(
      settlements.map(async (s) => {
        const current: SettlementState  = s.getState();
        const options: SettlementState[] = stateMachine.getNextStates(current);

        if (options.length === 0) {
          console.log(`[TERMINAL]   ${s.getReference()} is in terminal state: ${current}`);
          return;
        }

        const next = pickRandom(options);

        if (shouldInjectFailure(CONFIG.failureInjectionProb)) {
          console.log(`[INJECTED]   ${s.getReference()} failure injected — skipping ${current} → ${next}`);
          return;
        }

        try {
          await s.transitionTo(current, next, s.getOwner());
          console.log(`[TRANSITION] ${s.getReference()}: ${current} → ${next}`);
        } catch (err) {
          console.error(`[ERROR] transition(${s.getReference()}):`, (err as Error).message);
        }
      })
    );
  }

  // Step 4 — Replay each settlement from ledger events
  console.log("\n[REPLAY PHASE]");

  for (const s of settlements) {
    try {
      const replayed = await replayEngine.replaySettlement(s.getReference());
      const inMemory = s.getState();
      const match    = replayed === inMemory ? "✓" : "✗ MISMATCH";

      console.log(
        `[REPLAY] ${s.getReference()} — in-memory: ${inMemory} | replayed: ${replayed} ${match}`
      );
    } catch (err) {
      console.error(`[ERROR] replay(${s.getReference()}):`, (err as Error).message);
    }
  }

  console.log("\n=== SettlrOS Day 1 Sandbox: Completed ===");
}

// ── Execute ───────────────────────────────────────────────────────────────────

runDay1Sandbox()
  .then(() => {
    console.log("[SUCCESS] Day 1 sandbox finished.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[FATAL] Sandbox failed:", err);
    process.exit(1);
  });