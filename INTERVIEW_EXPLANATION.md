# Interview Explanation: Shared Bill Splitter

This document accompanies the Shared Bill Splitter submission, providing a clear architecture walkthrough, deep dive into concurrency and idempotency mechanics, important trade-offs, a 3-minute video script, and potential interview questions and answers.

---

## 1. System Architecture Walkthrough

The application operates as a cohesive, serverless monorepo running on Cloudflare Workers and Cloudflare D1:

1. **Client Layer (Web):**
   - Built with React 19, Vite, and TanStack Router.
   - Communicates with the backend using standard REST JSON contracts over HTTP.
   - Provides an interactive dashboard showing homes, members, bills, share statuses, and dynamic outstanding balances.
   - Incorporates client-side UUID generation for `Idempotency-Key` headers when submitting payments.
   - Includes full UI protection against double submissions (buttons automatically disable with spinners during flight) and provides graceful error boundaries and alerts when the API is slow or returns 4xx/5xx responses.

2. **Server Layer (API):**
   - Implemented with [Hono](https://hono.dev) framework compiled to run inside Cloudflare Workers (`workerd`).
   - Uses zero heavy ORMs; instead, executes direct, parameterized SQL statements via Cloudflare D1's native prepared statement API (`c.env.DB.prepare(...).bind(...)`).
   - Provides deterministic error handling: all errors conform strictly to `{ "error": "message" }`.

3. **Storage Layer (Database):**
   - Cloudflare D1 (SQLite engine at the edge).
   - Enforces relational consistency with 7 named constraints: foreign keys (`ON DELETE CASCADE`), positive integer `CHECK` constraints on cents, and `UNIQUE` indexes on idempotency keys.

---

## 2. Database and API Interaction

The database schema models 4 core entities: `homes`, `members`, `bills`, and `shares`.

- **Home & Member Creation:**
  - Members are recorded with `created_at` timestamps to preserve exact insertion order.
  - Adding a member validates that the parent `homeId` exists; foreign key `fk_members_home_id` prevents orphaned member records.
- **Fair Bill Splitting:**
  - A bill is submitted with integer `totalCents`.
  - The API queries existing members for the home, sorted by insertion order: `ORDER BY created_at ASC`.
  - Base amount per share: `Math.floor(totalCents / N)`.
  - Remainder cents: `totalCents % N`.
  - The first `remainder` members in insertion order receive `base + 1` cents; the remaining members receive `base` cents.
  - The bill record and all individual share records are committed atomically in a single D1 batch transaction (`c.env.DB.batch([billInsert, ...shareInserts])`).

---

## 3. Concurrency & Race-Condition Prevention

### The Double-Payment Risk

In a multi-user environment, two network requests could arrive at the exact same millisecond trying to pay the same bill share. A naive "read-then-write" approach:
```ts
// Flawed approach:
const share = await DB.get('SELECT paid_at FROM shares WHERE id = ?')
if (!share.paid_at) {
  await DB.run('UPDATE shares SET paid_at = ? WHERE id = ?', [now, shareId])
}
```
can result in both requests observing `paid_at === null` simultaneously, causing a double-payment race condition.

### The Solution: Atomic Compare-and-Set (CAS)

Instead of application-level checks, we push concurrency arbitration directly into SQLite's atomic row-level update:
```sql
UPDATE shares
SET paid_at = ?, idempotency_key = ?
WHERE id = ? AND bill_id = ? AND paid_at IS NULL
```

- Because SQLite executes individual write statements serially with row-level locks, exactly one request will match the `paid_at IS NULL` condition and produce `changes === 1`.
- Any simultaneous competitor request will match zero rows and return `changes === 0`.
- The loser then inspects the committed row:
  - If the persisted `idempotency_key` matches its own header, it returns `200 OK` (idempotent replay).
  - If the persisted `idempotency_key` is different, it immediately returns `409 Conflict`.
- This ensures that double payments are physically impossible at the database layer.

---

## 4. How Idempotent Payments Work

Idempotence ensures that retrying an operation produce the same outcome as the initial execution without causing duplicate side effects.

1. **Header Requirement:** Every payment request must include the `Idempotency-Key: <uuid>` header. If omitted or empty, the server rejects the request with `400 Bad Request`.
2. **First Attempt:**
   - Server runs the CAS update and writes the `idempotency_key` and `paid_at` timestamp.
   - Returns `200 OK` with the paid share payload.
3. **Identical Replay (Network retry, client timeout, duplicate click):**
   - The server detects `paid_at !== null` and compares `share.idempotency_key === headerKey`.
   - Since the keys match, the server returns `200 OK` with the exact same payload (same `id`, `amountCents`, and original `paidAt` timestamp).
   - No balances are modified again.
4. **Different Key on Paid Share:**
   - If a different user or distinct request tries to pay a share that is already paid, `share.idempotency_key !== headerKey`.
   - The server responds with `409 Conflict: Share already paid with a different key`.

---

## 5. Important Engineering Trade-offs

| Decision                                                        | Trade-off Made                                                                | Rationale                                                                                                                            |
| :-------------------------------------------------------------- | :---------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Direct SQL prepared statements over ORMs (Prisma / Drizzle)** | Slightly more manual SQL query authoring.                                     | Zero dependency overhead, lightning-fast worker cold starts, and full transparency over executed SQL and named database constraints. |
| **Integer cents for all currency**                              | UI must convert between dollars and cents for display.                        | Completely eliminates binary floating-point rounding errors and ensures total cents equality across all split calculations.          |
| **Database CAS over Distributed Locks (KV / Durable Objects)**  | Depends on D1 row update semantics.                                           | Avoids the latency, complexity, and additional infrastructure costs of coordinating distributed mutexes across edge regions.         |
| **Single-Page Tabular UI with Pure Vanilla CSS**                | Custom styling rather than pre-made component libraries like Tailwind/shadcn. | Minimal bundle size (Vite build is under 300KB), no external build churn, and tailored glassmorphism aesthetics.                     |

---

## 6. 3-Minute Video Walkthrough Script

_Target Duration: ~2 minutes 45 seconds_

> **[0:00 - 0:30] Introduction & Architecture**
> "Hi everyone, I'm Kavya Sanghvi. Today I'm walking you through my solution for the Shared Bill Splitter application.
>
> The stack is built using Cloudflare Workers running Hono for the API, Cloudflare D1 for the SQLite database, and a React 19 frontend powered by Vite and TanStack Router. The entire codebase is strictly typed in TypeScript with zero `any` types and passes all Biome lint and formatting checks."

> **[0:30 - 1:15] Database Design & Fair Remainder Splitting**
> "In our D1 database schema, we enforce 7 named database constraints, including foreign keys with cascade deletions, check constraints ensuring strictly positive cents, and a unique constraint on idempotency keys.
>
> In shared living situations, odd amounts cannot always be divided equally among roommates. For example, splitting a $10.00 bill between 3 members leaves 1 remainder cent. Our splitting algorithm divides the integer cents and distributes remainder cents one-by-one according to the exact order members joined the home. We also verified that a home with 7 members splitting 100,001 cents produces shares that sum to exactly 100,001 cents."

> **[1:15 - 2:05] Concurrency & Idempotency Deep Dive**
> "The most critical part of financial software is preventing race conditions and double charges.
>
> When paying a share, clients supply an `Idempotency-Key` header. Instead of a vulnerable read-then-write check, we perform an atomic compare-and-set query:
> `UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL`
>
> If five requests fire at the same microsecond, SQLite's atomic write locks grant the update to only one request. The other four requests see zero rows updated. If their key matches, they receive an idempotent 200 OK with the original payment timestamp. If their key is different, they receive a 409 Conflict. We've proven this behavior with concurrency stress tests in our Vitest suite."

> **[2:05 - 2:45] Frontend Experience & Error Handling**
> "On the frontend, users can create homes, add members, split bills, and track outstanding balances in real time. We built defensive UX: forms disable submission buttons to prevent accidental double clicks, payments display animated spinners, and if the API is slow or encounters a 500 error, an alert notification appears while the share remains safely unpaid.
>
> Thank you for reviewing my submission!"

---

## 7. Potential Interview Questions and Answers

### Q1: Why did you store money in integer cents rather than decimals or floats?

**Answer:** Floating-point numbers in computer architecture are represented using base-2 scientific notation (IEEE 754), which cannot precisely represent fractional base-10 values like `0.1` or `0.01`. In billing systems, recurring float operations accumulate rounding errors, causing totals to drift. Representing all monetary values as integer cents guarantees exact arithmetic, simplifies remainder distribution algorithms, and matches standard financial database design.

### Q2: What happens if two roommates click "Pay" on the same share at the exact same millisecond?

**Answer:** Our backend issues an atomic `UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL`. SQLite's write lock ensures that only the first statement executes against a row where `paid_at IS NULL`. The second statement matches zero rows (`changes === 0`). The API then re-queries the row: if the second request sent the same idempotency key, it receives `200 OK` (replay); if it sent a different key, it receives `409 Conflict`. Double payment is physically prevented.

### Q3: How do you guarantee remainder cents are split fairly and deterministically?

**Answer:** We query home members with an explicit sort on insertion order (`ORDER BY created_at ASC`). If `totalCents` is divided among `N` members, the base share is `Math.floor(totalCents / N)` and the remainder is `totalCents % N`. The algorithm allocates `base + 1` cents to each member whose index is less than `remainder`, and `base` cents to all subsequent members. Because insertion order is deterministic, the sum of all shares equals `totalCents` every single time.

### Q4: How does the web UI prevent inconsistent states during slow network conditions or 500 errors?

**Answer:** The frontend uses optimistic lock guards in React state. When a payment is clicked, `payingShareId` is set, disabling all payment buttons and showing a spinner. The UI does not mark the share as paid until an HTTP 200 is received. If the server times out or responds with 500, a clear alert is rendered, and the share remains in its unpaid state with the "Pay Share" button re-enabled for retry.
