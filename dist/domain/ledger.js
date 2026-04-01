"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ledger = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class Ledger {
    constructor() {
        this.pool = new pg_1.Pool({
            connectionString: process.env.DATABASE_URL,
        });
    }
    async withTransaction(fn) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const result = await fn(client);
            await client.query("COMMIT");
            return result;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    async append(client, settlementReference, state, sequenceNumber) {
        await client.query(`
            INSERT INTO ledger_entries
                (settlement_reference, state, sequence_number)
            VALUES
                ($1, $2, $3)
            ON CONFLICT (settlement_reference, sequence_number) DO NOTHING
            `, [settlementReference, state, sequenceNumber]);
    }
    async fetchEvents(client, settlementReference) {
        const res = await client.query(`SELECT state, sequence_number, occurred_at
             FROM ledger_entries
             WHERE settlement_reference = $1
             ORDER BY sequence_number ASC`, [settlementReference]);
        return res.rows;
    }
    async close() {
        await this.pool.end();
    }
}
exports.Ledger = Ledger;
