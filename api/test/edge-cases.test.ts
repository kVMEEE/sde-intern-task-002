import { describe, expect, it } from 'vitest'
import { type Balance, call, createBill, createHome, type Share } from './helpers'

describe('edge cases and reliability', () => {
  it('handles invalid JSON payload on POST /api/homes', async () => {
    const res = await call('POST', '/api/homes', {
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(422)
    expect((res.body as { error: string }).error).toBeDefined()
  })

  it('rejects empty or whitespace-only home name', async () => {
    const res1 = await call('POST', '/api/homes', { body: { name: '' } })
    const res2 = await call('POST', '/api/homes', { body: { name: '   ' } })
    const res3 = await call('POST', '/api/homes', { body: { name: 123 } })

    expect(res1.status).toBe(422)
    expect(res2.status).toBe(422)
    expect(res3.status).toBe(422)
  })

  it('rejects empty or whitespace-only member name', async () => {
    const { homeId } = await createHome([])
    const res1 = await call('POST', `/api/homes/${homeId}/members`, { body: { name: '' } })
    const res2 = await call('POST', `/api/homes/${homeId}/members`, { body: { name: '   ' } })
    const res3 = await call('POST', `/api/homes/${homeId}/members`, { body: {} })

    expect(res1.status).toBe(422)
    expect(res2.status).toBe(422)
    expect(res3.status).toBe(422)
  })

  it('handles complex uneven bill splits with large member counts and cents', async () => {
    const memberNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const { homeId, members } = await createHome(memberNames)

    // 10 cents among 7 members: 10 / 7 = 1 cent each, 3 cents remainder.
    // First 3 members get 2 cents, remaining 4 members get 1 cent.
    const bill = await createBill(homeId, 10)
    expect(bill.status).toBe(201)
    expect(bill.body.shares.length).toBe(7)

    const amounts = bill.body.shares.map((s) => s.amountCents)
    expect(amounts).toEqual([2, 2, 2, 1, 1, 1, 1])

    const sum = amounts.reduce((a, b) => a + b, 0)
    expect(sum).toBe(10)

    // Member IDs match insertion order exactly
    expect(bill.body.shares.map((s) => s.memberId)).toEqual(members.map((m) => m.id))
  })

  it('returns empty balance array for a home with no members', async () => {
    const { homeId } = await createHome([])
    const balancesRes = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balancesRes.status).toBe(200)
    expect(balancesRes.body.balances).toEqual([])
  })

  it('returns 0 outstanding balances when home has members but no bills', async () => {
    const { homeId, members } = await createHome(['Alice', 'Bob'])
    const balancesRes = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balancesRes.status).toBe(200)
    expect(balancesRes.body.balances).toEqual([
      { memberId: members[0]?.id, name: 'Alice', outstandingCents: 0 },
      { memberId: members[1]?.id, name: 'Bob', outstandingCents: 0 },
    ])
  })

  it('handles concurrent payment attempts safely without double charging', async () => {
    const { homeId } = await createHome(['Alice', 'Bob'])
    const bill = await createBill(homeId, 1000)
    const targetShare = bill.body.shares[0]
    expect(targetShare).toBeDefined()
    if (!targetShare) return

    // Launch 5 concurrent payment attempts for the exact same share with different idempotency keys
    const paymentAttempts = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        call<Share>('POST', `/api/bills/${bill.body.id}/shares/${targetShare.id}/pay`, {
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }),
      ),
    )

    const successCount = paymentAttempts.filter((res) => res.status === 200).length
    const conflictCount = paymentAttempts.filter((res) => res.status === 409).length

    // Exactly one must succeed, and all others must receive 409 Conflict
    expect(successCount).toBe(1)
    expect(conflictCount).toBe(4)

    // Verify balance reflects exactly one payment
    const balRes = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balRes.status).toBe(200)
    expect(balRes.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])
  })

  it('handles concurrent identical payment attempts with the same Idempotency-Key safely', async () => {
    const { homeId } = await createHome(['Alice', 'Bob'])
    const bill = await createBill(homeId, 2000)
    const targetShare = bill.body.shares[0]
    expect(targetShare).toBeDefined()
    if (!targetShare) return

    const sharedKey = crypto.randomUUID()

    // Send 3 concurrent requests with the identical Idempotency-Key
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        call<Share>('POST', `/api/bills/${bill.body.id}/shares/${targetShare.id}/pay`, {
          headers: { 'Idempotency-Key': sharedKey },
        }),
      ),
    )

    // All should return 200 with the exact same payload
    for (const res of results) {
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(targetShare.id)
      expect(res.body.paidAt).toBe(results[0]?.body.paidAt)
    }
  })

  it('returns 404 for non-existent bill or share in payment', async () => {
    const resShare404 = await call('POST', '/api/bills/bill-xyz/shares/share-xyz/pay', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(resShare404.status).toBe(404)
  })
})
