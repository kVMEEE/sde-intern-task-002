# SDE Intern Assignment: Shared Bill Splitter

A full-stack shared bill splitting web application designed for shared homes and roommates, engineered with strict data integrity, fair remainder distribution, and atomic, idempotent payment processing.

## Live Repository & Links

- **GitHub Repository:** [https://github.com/kVMEEE/sde-intern-task-002](https://github.com/kVMEEE/sde-intern-task-002)
- **Account:** [https://github.com/kVMEEE](https://github.com/kVMEEE)
- **Technical Walkthrough & Interview Document:** [INTERVIEW_EXPLANATION.md](file:///c:/Users/sangh/OneDrive/Desktop/DoCoDeGo/INTERVIEW_EXPLANATION.md)

---

## Architecture Overview

The system is organized as a unified, high-performance monorepo:

```
sde-intern-task-002/
├── api/                             # Cloudflare Workers backend
│   ├── migrations/
│   │   └── 0001_init.sql           # D1 schema with 7 named constraints
│   ├── src/
│   │   └── index.ts                # Hono application & route handlers
│   ├── test/
│   │   ├── bills.test.ts           # Visible bill splitting test suite
│   │   ├── edge-cases.test.ts      # Extra concurrency & edge-case test suite
│   │   ├── helpers.ts              # Test client & harness utilities
│   │   ├── homes.test.ts           # Visible homes and members test suite
│   │   └── payments.test.ts        # Visible idempotent payment test suite
│   ├── wrangler.jsonc              # Cloudflare Workers & D1 configuration
│   └── package.json
├── web/                             # React + Vite frontend
│   ├── src/
│   │   ├── routes/
│   │   │   ├── __root.tsx          # TanStack Router root outlet
│   │   │   └── index.tsx           # Interactive Shared Bill Splitter UI
│   │   ├── main.tsx                # Client entrypoint & router initialization
│   │   └── styles.css              # Custom design system with glassmorphism
│   ├── index.html
│   └── package.json
├── biome.json                       # Biome formatter & linter configuration
├── pnpm-workspace.yaml              # pnpm workspace definition
└── README.md
```

### Technology Stack

- **API Runtime:** Cloudflare Workers running [Hono](https://hono.dev) framework for ultra-low latency serverless edge execution.
- **Database:** Cloudflare D1 (SQLite) with atomic transactions and explicit named constraints.
- **Web App:** React 19, Vite, TanStack Router with pure Vanilla CSS tokens and glassmorphism design.
- **Language:** TypeScript with strict type checking (no `any` used).
- **Test Suite:** Vitest running directly inside Cloudflare's `workerd` runtime (`@cloudflare/vitest-plugin`).
- **Linter & Formatter:** Biome (`pnpm check` and `pnpm check:fix`).

---

## Local Setup & Development

Ensure you have Node.js (v20+ recommended) and `pnpm` installed:

```bash
# 1. Install dependencies
pnpm install

# 2. Run API and Web concurrently in development mode
pnpm dev
# API serves on http://localhost:8787
# Web serves on http://localhost:5173

# 3. Run all tests in the Cloudflare Workers runtime
pnpm test

# 4. Run Biome formatting and lint checks
pnpm check

# 5. Run TypeScript compiler type checks
pnpm typecheck

# 6. Build production frontend assets
pnpm build
```

---

## Database Design & Named Constraints

The SQLite database schema is defined in `api/migrations/0001_init.sql` and includes **7 named constraints** that prevent invalid state:

1. **`fk_members_home_id`**: `FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE`
   - _Prevents:_ Orphaned members whose associated home has been removed.
2. **`fk_bills_home_id`**: `FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE`
   - _Prevents:_ Assigning bills to non-existent homes or preserving bills of deleted homes.
3. **`chk_bills_total_cents_positive`**: `CHECK (total_cents > 0)`
   - _Prevents:_ Storing bills with 0 or negative monetary amounts at the database storage layer.
4. **`fk_shares_bill_id`**: `FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE`
   - _Prevents:_ Dangling bill shares when a bill is modified or deleted.
5. **`fk_shares_member_id`**: `FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE`
   - _Prevents:_ Assigning shares to non-existent members.
6. **`chk_shares_amount_cents_positive`**: `CHECK (amount_cents > 0)`
   - _Prevents:_ Creating shares with zero or negative cent amounts.
7. **`uq_shares_idempotency_key`**: `UNIQUE (idempotency_key)`
   - _Prevents:_ Reusing the same payment idempotency token across distinct shares or payments.

---

## API Endpoints

### 1. Homes & Members

- `POST /api/homes`: Create a home (`{ "name": string }` -> `201 { id, name }`).
- `POST /api/homes/:homeId/members`: Add a member in strict insertion order (`{ "name": string }` -> `201 { id, homeId, name }`). Returns `404` if home does not exist, `422` on empty or invalid names.
- `GET /api/homes`: List all homes with creation timestamps.
- `GET /api/homes/:homeId`: Fetch home details including members and existing bills with shares.

### 2. Bill Splitting & Balances

- `POST /api/homes/:homeId/bills`: Splits an integer `totalCents` among all home members. Extra remainder cents are distributed one by one to members in insertion order. Returns `201` with created bill and shares. Returns `404` if home not found, `422` if home has no members or amount is not a positive whole integer.
- `POST /api/bills/:billId/shares/:shareId/pay`: Atomically marks a share paid with `Idempotency-Key` header. Returns `200` with paid share. If the same `Idempotency-Key` is re-sent for that share, returns `200` with the identical result. If a different key is sent on an already paid share, returns `409 Conflict`.
- `GET /api/homes/:homeId/balances`: Calculates unpaid amounts across all bills for every member in the home. Returns `200 { balances: [{ memberId, name, outstandingCents }] }`.

---

## Engineering Decisions

### 1. Integer Cents Representation

- **Decision:** All monetary transactions (`totalCents`, `amountCents`, `outstandingCents`) are strictly represented and calculated as positive integer cents.
- **Reasoning:** Floating-point representations (such as IEEE-754 floats) introduce subtle binary rounding artifacts (e.g. `0.1 + 0.2 !== 0.3`). By maintaining integer arithmetic at both the database level (`INTEGER NOT NULL`) and application level, share sums are mathematically guaranteed to match the bill total with zero precision leakage.

### 2. Atomic Compare-and-Set for Concurrency & Idempotency

- **Decision:** Payments utilize an atomic conditional update query:

  ```sql
  UPDATE shares
  SET paid_at = ?, idempotency_key = ?
  WHERE id = ? AND bill_id = ? AND paid_at IS NULL
  ```
- **Reasoning:** When multiple concurrent requests attempt to pay the same share simultaneously, database lock arbitration ensures only one request modifies the row (`changes === 1`). The losing requests observe `changes === 0` and inspect the updated row: if their `Idempotency-Key` matches the saved key, they receive an idempotent `200 OK`; if the key differs, they receive `409 Conflict`. This avoids application-level race conditions and distributed locking overhead.

### 3. Remainder Cent Distribution by Deterministic Insertion Order

- **Decision:** Remainder cents from integer divisions (`totalCents % memberCount`) are allocated strictly by member insertion order (`ORDER BY created_at ASC`).
- **Reasoning:** Financial algorithms require absolute determinism. Random or un-ordered allocation leads to non-reproducible splits across multiple reads and tests. Using ordered member indexing guarantees fairness and full predictability.

---

## Testing & Reliability

The test suite runs inside Cloudflare's native `workerd` runtime with Vitest:

- **Visible Tests:**
  - `homes.test.ts`: Home creation, member addition, 404 validation.
  - `bills.test.ts`: Even splits, uneven remainder distribution, sum preservation, single-member splits, unpaid share defaults, validation of non-integers, negative amounts, empty homes.
  - `payments.test.ts`: Share payment, missing `Idempotency-Key` (400), repeated idempotency key replay (200), conflicting key replay (409), non-existent resources (404), cumulative multi-bill balance tracking.
- **Additional Edge-Case Tests (`edge-cases.test.ts`):**
  - Concurrency stress tests with 5 simultaneous requests competing to pay the same share.
  - Concurrent identical requests with the same `Idempotency-Key`.
  - Whitespace-only names and malformed JSON payloads.
  - Large member sets with uneven cent distributions.
  - Empty home balance calculations.

All 33 tests pass in the local Workers runtime:
```
✓ test/homes.test.ts (3 tests)
✓ test/edge-cases.test.ts (9 tests)
✓ test/payments.test.ts (9 tests)
✓ test/bills.test.ts (12 tests)

Test Files  4 passed (4)
     Tests  33 passed (33)
```

---

## AI Tools Used

- **Antigravity AI (powered by Google DeepMind):** Used as an autonomous pair programmer to inspect specifications, generate D1 SQL migration constraints, implement Hono routes, build the React/TanStack Router UI, and verify edge-case coverage. All generated code was verified with TypeScript compiler (`pnpm typecheck`), Biome linter (`pnpm check`), and runtime tests (`pnpm test`).
