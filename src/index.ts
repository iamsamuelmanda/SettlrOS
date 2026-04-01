import dotenv from "dotenv";
import { Ledger } from "./domain/ledger";
import { StateMachine } from "./domain/stateMachine";
import { Settlement } from "./domain/settlement";

dotenv.config();

async function main() {
    const ledger = new Ledger();
    const sm = new StateMachine(); // currently unused but kept for future wiring

    const owner = "owner-1";
    const settlement = new Settlement("SETTLEMENT-001", owner, ledger);

    await settlement.start();
    await settlement.transitionTo("INITIATED", "PENDING", owner);
    await settlement.transitionTo("PENDING", "COMPLETED", owner);

    console.log("Connexa core booted successfully.");
    await ledger.close();
}

main().catch(err => {
    console.error("Fatal error initializing settlr-os:", err);
    process.exit(1);
});

