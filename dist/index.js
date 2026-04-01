"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const ledger_1 = require("./domain/ledger");
const stateMachine_1 = require("./domain/stateMachine");
const settlement_1 = require("./domain/settlement");
dotenv_1.default.config();
async function main() {
    const ledger = new ledger_1.Ledger();
    const sm = new stateMachine_1.StateMachine(); // currently unused but kept for future wiring
    const owner = "owner-1";
    const settlement = new settlement_1.Settlement("SETTLEMENT-001", owner, ledger);
    await settlement.start();
    await settlement.transitionTo("INITIATED", "PENDING", owner);
    await settlement.transitionTo("PENDING", "COMPLETED", owner);
    console.log("Connexa core booted successfully.");
    await ledger.close();
}
main().catch(err => {
    console.error("Fatal error initializing Connexa-core:", err);
    process.exit(1);
});
