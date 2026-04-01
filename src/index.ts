import dotenv from "dotenv";
import { PostgresLedger } from "./domain/ledger";
import { StateMachine } from "./domain/stateMachine";
import { Settlement } from "./domain/settlement";

dotenv.config();

async function main(): Promise<void> {
  const ledger      = new PostgresLedger();
  const stateMachine = new StateMachine(); // wired to Settlement internally — kept here for visibility

  const owner      = "owner-1";
  const reference  = "SETTLEMENT-001";
  const settlement = new Settlement(reference, owner, ledger);

  await settlement.start();
  console.log(`[BOOT] ${reference} started — state: ${settlement.getState()}`);

  await settlement.transitionTo("INITIATED", "PENDING", owner);
  console.log(`[BOOT] ${reference} — state: ${settlement.getState()}`);

  await settlement.transitionTo("PENDING", "COMPLETED", owner);
  console.log(`[BOOT] ${reference} — state: ${settlement.getState()}`);

  console.log("\nSettlrOS core booted successfully.");
  await ledger.close();
}

main().catch((err) => {
  console.error("[FATAL] Error initializing SettlrOS:", err);
  process.exit(1);
});