-- Settlement table
CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    reference VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL,
    owner VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Ledger table
CREATE TABLE IF NOT EXISTS ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    settlement_reference VARCHAR(100) NOT NULL REFERENCES settlements(reference) ON DELETE RESTRICT,
    state VARCHAR(50) NOT NULL,
    sequence_number INT NOT NULL,
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE (settlement_reference, sequence_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ledger_settlement_reference
ON ledger_entries (settlement_reference);

CREATE INDEX IF NOT EXISTS idx_ledger_occurred_at
ON ledger_entries (occurred_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_idempotency
ON ledger_entries (settlement_reference, sequence_number);

CREATE INDEX IF NOT EXISTS idx_settlements_reference
ON settlements (reference);
