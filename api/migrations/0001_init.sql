-- Migration: 0001_init.sql
-- Schema for Shared Bill Splitter with named constraints

-- 1. homes table
CREATE TABLE IF NOT EXISTS homes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 2. members table
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  -- Named Constraint 1: fk_members_home_id ensures member belongs to a valid home
  CONSTRAINT fk_members_home_id FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

-- Index for querying members by home_id
CREATE INDEX IF NOT EXISTS idx_members_home_id ON members(home_id);

-- 3. bills table
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  -- Named Constraint 2: fk_bills_home_id ensures bill belongs to a valid home
  CONSTRAINT fk_bills_home_id FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  -- Named Constraint 3: chk_bills_total_cents_positive ensures total_cents is strictly positive
  CONSTRAINT chk_bills_total_cents_positive CHECK (total_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_bills_home_id ON bills(home_id);

-- 4. shares table
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  -- Named Constraint 4: fk_shares_bill_id ensures share is linked to a valid bill
  CONSTRAINT fk_shares_bill_id FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  -- Named Constraint 5: fk_shares_member_id ensures share is assigned to an existing member
  CONSTRAINT fk_shares_member_id FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  -- Named Constraint 6: chk_shares_amount_cents_positive ensures share amount is strictly positive
  CONSTRAINT chk_shares_amount_cents_positive CHECK (amount_cents > 0),
  -- Named Constraint 7: uq_shares_idempotency_key ensures an idempotency key cannot be reused across different shares
  CONSTRAINT uq_shares_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_shares_bill_id ON shares(bill_id);
CREATE INDEX IF NOT EXISTS idx_shares_member_id ON shares(member_id);
CREATE INDEX IF NOT EXISTS idx_shares_paid_at ON shares(paid_at);
