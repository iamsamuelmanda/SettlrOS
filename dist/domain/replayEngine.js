"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplayEngine = void 0;
class ReplayEngine {
    constructor(ledger) {
        this.ledger = ledger;
    }
    async replaySettlement(settlementReference, client) {
        await client.query("BEGIN");
        try {
            // Lock settlement row
            const res = await client.query(`SELECT * FROM settlements WHERE reference = $1 FOR UPDATE`, [settlementReference]);
            if (res.rowCount === 0)
                throw new Error(`Settlement ${settlementReference} does not exist`);
            const events = await this.ledger.fetchEvents(client, settlementReference);
            let state = "INITIATED";
            for (const e of events) {
                state = e.state;
            }
            // Materialize final state
            await client.query(`UPDATE settlements SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE reference = $2`, [state, settlementReference]);
            await client.query("COMMIT");
            return state;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
    }
}
exports.ReplayEngine = ReplayEngine;
