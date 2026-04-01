"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Settlement = void 0;
class Settlement {
    constructor(reference, owner, ledger) {
        this.reference = reference;
        this.owner = owner;
        this.ledger = ledger;
        this.currentState = "INITIATED";
    }
    getState() {
        return this.currentState;
    }
    async start() {
        await this.ledger.withTransaction(async (client) => {
            // Insert settlement
            await client.query(`
                INSERT INTO settlements
                    (reference, status, owner)
                VALUES
                    ($1, $2, $3)
                ON CONFLICT(reference) DO NOTHING
                `, [this.reference, "INITIATED", this.owner]);
            // Ledger entry sequence = 1
            await this.ledger.append(client, this.reference, "INITIATED", 1);
        });
    }
    async transitionTo(expectedState, nextState, nextOwner) {
        await this.ledger.withTransaction(async (client) => {
            const { rows } = await client.query(`
                SELECT status, owner, version
                FROM settlements
                WHERE reference = $1
                FOR UPDATE
                `, [this.reference]);
            if (rows.length !== 1)
                throw new Error("Settlement not found");
            const { status, owner, version } = rows[0];
            if (status !== expectedState) {
                throw new Error(`Invalid state transition: expected ${expectedState}, got ${status}`);
            }
            // Append next ledger entry
            const nextVersion = version + 1;
            await this.ledger.append(client, this.reference, nextState, nextVersion);
            // Atomically update settlement
            const result = await client.query(`
                UPDATE settlements
                SET status = $1, owner = $2, version = version + 1, updated_at = NOW()
                WHERE reference = $3 AND owner = $4 AND version = $5
                `, [nextState, nextOwner, this.reference, owner, version]);
            if (result.rowCount !== 1) {
                throw new Error("Ownership or version conflict");
            }
            // Update in-memory view only after successful commit path
            this.currentState = nextState;
            this.owner = nextOwner;
        });
    }
}
exports.Settlement = Settlement;
