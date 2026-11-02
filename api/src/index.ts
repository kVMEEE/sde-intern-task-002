import { type Context, Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

type HomeRow = {
  id: string
  name: string
  created_at: string
}

type MemberRow = {
  id: string
  home_id: string
  name: string
  created_at: string
}

type BillRow = {
  id: string
  home_id: string
  title: string
  total_cents: number
  created_at: string
}

type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
  created_at: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Helper for consistent error responses: { "error": "message" }
function errorResponse(c: Context, status: 400 | 404 | 409 | 422 | 500, message: string) {
  return c.json({ error: message }, status)
}

// ----------------------------------------------------
// Part 1: Homes & Members
// ----------------------------------------------------

// POST /api/homes
// Request: { "name": string }
// Success: 201 { id, name }
app.post('/api/homes', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return errorResponse(c, 422, 'Invalid JSON body')
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { name?: unknown }).name !== 'string' ||
    (body as { name: string }).name.trim().length === 0
  ) {
    return errorResponse(c, 422, 'Name is required and must be a non-empty string')
  }

  const name = (body as { name: string }).name.trim()
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// POST /api/homes/:homeId/members
// Request: { "name": string }
// Success: 201 { id, homeId, name }
// Errors: 404 home not found
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return errorResponse(c, 404, 'Home not found')
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return errorResponse(c, 422, 'Invalid JSON body')
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { name?: unknown }).name !== 'string' ||
    (body as { name: string }).name.trim().length === 0
  ) {
    return errorResponse(c, 422, 'Name is required and must be a non-empty string')
  }

  const name = (body as { name: string }).name.trim()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, now)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// ----------------------------------------------------
// Part 2: Bills, Payments, and Balances
// ----------------------------------------------------

// POST /api/homes/:homeId/bills
// Request: { "title": string, "totalCents": number }
// Success: 201 { id, homeId, title, totalCents, shares: [{ id, memberId, amountCents, paidAt: null }] }
// Errors: 404 home not found. 422 total is not a positive whole number, or the home has no members.
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  // Check home exists
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return errorResponse(c, 404, 'Home not found')
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return errorResponse(c, 422, 'Invalid JSON body')
  }

  if (!body || typeof body !== 'object') {
    return errorResponse(c, 422, 'Invalid request body')
  }

  const { title, totalCents } = body as { title?: unknown; totalCents?: unknown }

  if (typeof title !== 'string' || title.trim().length === 0) {
    return errorResponse(c, 422, 'Title is required and must be a non-empty string')
  }

  // totalCents must be a positive integer
  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return errorResponse(c, 422, 'totalCents must be a positive whole number')
  }

  // Fetch members in insertion order (created_at ASC)
  const { results: members } = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY created_at ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  if (!members || members.length === 0) {
    return errorResponse(c, 422, 'Home has no members')
  }

  const numMembers = members.length
  const baseShare = Math.floor(totalCents / numMembers)
  const remainder = totalCents % numMembers

  const billId = crypto.randomUUID()
  const shares: Array<{
    id: string
    memberId: string
    amountCents: number
    paidAt: null
  }> = []

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title.trim(), totalCents),
  ]

  for (let i = 0; i < numMembers; i++) {
    const member = members[i]
    if (!member) continue
    const shareAmount = baseShare + (i < remainder ? 1 : 0)
    const shareId = crypto.randomUUID()

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents: shareAmount,
      paidAt: null,
    })

    statements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key) VALUES (?, ?, ?, ?, NULL, NULL)',
      ).bind(shareId, billId, member.id, shareAmount),
    )
  }

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title: title.trim(),
      totalCents,
      shares,
    },
    201,
  )
})

// POST /api/bills/:billId/shares/:shareId/pay
// Request header: Idempotency-Key
// Success: 200 { id, memberId, amountCents, paidAt }
// Errors: 400 key missing. 404 bill or share not found. 409 share already paid with a different key.
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()

  if (!idempotencyKey) {
    return errorResponse(c, 400, 'Idempotency-Key header is required')
  }

  // Verify bill exists
  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<BillRow>()
  if (!bill) {
    return errorResponse(c, 404, 'Bill not found')
  }

  // Fetch target share
  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (!share) {
    return errorResponse(c, 404, 'Share not found')
  }

  // Check if already paid
  if (share.paid_at !== null) {
    if (share.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    }
    return errorResponse(c, 409, 'Share already paid with a different key')
  }

  // Attempt atomic update to prevent double-payment under concurrency:
  // UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL
  const now = new Date().toISOString()
  const result = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(now, idempotencyKey, shareId, billId)
    .run()

  if (result.meta.changes === 0) {
    // Another concurrent request may have just updated this share
    const refreshed = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
      .bind(shareId, billId)
      .first<ShareRow>()

    if (refreshed && refreshed.paid_at !== null) {
      if (refreshed.idempotency_key === idempotencyKey) {
        return c.json(
          {
            id: refreshed.id,
            memberId: refreshed.member_id,
            amountCents: refreshed.amount_cents,
            paidAt: refreshed.paid_at,
          },
          200,
        )
      }
      return errorResponse(c, 409, 'Share already paid with a different key')
    }
    return errorResponse(c, 409, 'Payment conflict occurred')
  }

  return c.json(
    {
      id: share.id,
      memberId: share.member_id,
      amountCents: share.amount_cents,
      paidAt: now,
    },
    200,
  )
})

// GET /api/homes/:homeId/balances
// Success: 200 { balances: [{ memberId, name, outstandingCents }] }
// Errors: 404 home not found
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return errorResponse(c, 404, 'Home not found')
  }

  // Fetch members ordered by insertion order
  const { results: members } = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY created_at ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  if (!members || members.length === 0) {
    return c.json({ balances: [] }, 200)
  }

  // Query sum of unpaid shares for members of this home
  const { results: unpaidSums } = await c.env.DB.prepare(`
    SELECT s.member_id, COALESCE(SUM(s.amount_cents), 0) AS outstanding_cents
    FROM shares s
    JOIN bills b ON s.bill_id = b.id
    WHERE b.home_id = ? AND s.paid_at IS NULL
    GROUP BY s.member_id
  `)
    .bind(homeId)
    .all<{ member_id: string; outstanding_cents: number }>()

  const unpaidMap = new Map<string, number>()
  if (unpaidSums) {
    for (const row of unpaidSums) {
      unpaidMap.set(row.member_id, row.outstanding_cents)
    }
  }

  const balances = members.map((m) => ({
    memberId: m.id,
    name: m.name,
    outstandingCents: unpaidMap.get(m.id) ?? 0,
  }))

  return c.json({ balances }, 200)
})

// Extra endpoints to support the full frontend UI:
// GET /api/homes - list all homes
app.get('/api/homes', async (c) => {
  const { results: homes } = await c.env.DB.prepare(
    'SELECT id, name, created_at FROM homes ORDER BY created_at DESC, rowid DESC',
  ).all<HomeRow>()
  return c.json({ homes: homes ?? [] }, 200)
})

// GET /api/homes/:homeId - get single home with members and bills
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) {
    return errorResponse(c, 404, 'Home not found')
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id, home_id, name FROM members WHERE home_id = ? ORDER BY created_at ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents, created_at FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<BillRow>()

  const billIds = (bills ?? []).map((b) => b.id)
  let allShares: ShareRow[] = []
  if (billIds.length > 0) {
    const placeholders = billIds.map(() => '?').join(',')
    const { results } = await c.env.DB.prepare(
      `SELECT id, bill_id, member_id, amount_cents, paid_at FROM shares WHERE bill_id IN (${placeholders})`,
    )
      .bind(...billIds)
      .all<ShareRow>()
    allShares = results ?? []
  }

  const sharesByBill = new Map<
    string,
    Array<{ id: string; memberId: string; amountCents: number; paidAt: string | null }>
  >()
  for (const s of allShares) {
    const arr = sharesByBill.get(s.bill_id) ?? []
    arr.push({
      id: s.id,
      memberId: s.member_id,
      amountCents: s.amount_cents,
      paidAt: s.paid_at,
    })
    sharesByBill.set(s.bill_id, arr)
  }

  const billsWithShares = (bills ?? []).map((b) => ({
    id: b.id,
    homeId: b.home_id,
    title: b.title,
    totalCents: b.total_cents,
    shares: sharesByBill.get(b.id) ?? [],
  }))

  return c.json(
    {
      home: {
        id: home.id,
        name: home.name,
        members: members ?? [],
        bills: billsWithShares,
      },
    },
    200,
  )
})

export default app
