import { Pool, PoolClient } from "pg";
import dotenv from "dotenv";

dotenv.config();

export class Ledger {
    private pool: Pool;

    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
    }

    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const result = await fn(client);
            await client.query("COMMIT");
            return result;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    }

    async append(
        client: PoolClient,
        settlementReference: string,
        state: string,
        sequenceNumber: number
    ): Promise<void> {
        await client.query(
            `
            INSERT INTO ledger_entries
                (settlement_reference, state, sequence_number)
            VALUES
                ($1, $2, $3)
            ON CONFLICT (settlement_reference, sequence_number) DO NOTHING
            `,
            [settlementReference, state, sequenceNumber]
        );
    }

    async fetchEvents(client: PoolClient, settlementReference: string) {
        const res = await client.query(
            `SELECT state, sequence_number, occurred_at
             FROM ledger_entries
             WHERE settlement_reference = $1
             ORDER BY sequence_number ASC`,
            [settlementReference]
        );
        return res.rows;
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}
