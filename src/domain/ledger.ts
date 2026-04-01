import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// ── Shared types ──────────────────────────────────────────────────────────────

export interface LedgerEntry {
  settlementReference: string;
  state: string;
  sequenceNumber: number;
  occurredAt?: Date;
}

// ── Interface — domain depends only on this, never on Postgres ────────────────

export interface ILedger {
  append(entry: LedgerEntry): Promise<void>;
  fetchEvents(settlementReference: string): Promise<LedgerEntry[]>;
}

// ── In-memory implementation — tests only, zero network ──────────────────────

export class InMemoryLedger implements ILedger {
  private readonly entries: LedgerEntry[] = [];

  async append(entry: LedgerEntry): Promise<void> {
    const duplicate = this.entries.some(
      (e) =>
        e.settlementReference === entry.settlementReference &&
        e.sequenceNumber === entry.sequenceNumber
    );
    if (!duplicate) {
      this.entries.push({ ...entry, occurredAt: new Date() });
    }
  }

  async fetchEvents(settlementReference: string): Promise<LedgerEntry[]> {
    return this.entries
      .filter((e) => e.settlementReference === settlementReference)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }
}

// ── Postgres implementation — production only ─────────────────────────────────

export class PostgresLedger implements ILedger {
  private readonly pool: Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL,
    });
  }

  async append(entry: LedgerEntry): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ledger_entries (settlement_reference, state, sequence_number)
         VALUES ($1, $2, $3)
         ON CONFLICT (settlement_reference, sequence_number) DO NOTHING`,
        [entry.settlementReference, entry.state, entry.sequenceNumber]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async fetchEvents(settlementReference: string): Promise<LedgerEntry[]> {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        `SELECT state, sequence_number, occurred_at
         FROM ledger_entries
         WHERE settlement_reference = $1
         ORDER BY sequence_number ASC`,
        [settlementReference]
      );
      return res.rows.map((r) => ({
        settlementReference,
        state: r.state,
        sequenceNumber: r.sequence_number,
        occurredAt: r.occurred_at,
      }));
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}