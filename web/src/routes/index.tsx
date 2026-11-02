import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: SharedBillSplitterApp,
})

type Member = {
  id: string
  homeId: string
  name: string
}

type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

type HomeSummary = {
  id: string
  name: string
  created_at: string
}

type HomeDetail = {
  id: string
  name: string
  members: Member[]
  bills: Bill[]
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function SharedBillSplitterApp() {
  // Navigation & Data States
  const [homes, setHomes] = useState<HomeSummary[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null)
  const [homeDetail, setHomeDetail] = useState<HomeDetail | null>(null)
  const [balances, setBalances] = useState<Balance[]>([])

  // Loading States
  const [isLoadingHomes, setIsLoadingHomes] = useState(false)
  const [isLoadingHomeDetail, setIsLoadingHomeDetail] = useState(false)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)

  // Form Submitting States
  const [isCreatingHome, setIsCreatingHome] = useState(false)
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [isCreatingBill, setIsCreatingBill] = useState(false)

  // Form Inputs
  const [newHomeName, setNewHomeName] = useState('')
  const [newMemberName, setNewMemberName] = useState('')
  const [newBillTitle, setNewBillTitle] = useState('')
  const [newBillAmountDollars, setNewBillAmountDollars] = useState('')

  // Notifications & Error Messages
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null)

  // Clear banners
  const clearNotifications = useCallback(() => {
    setGlobalError(null)
    setGlobalSuccess(null)
  }, [])

  // 1. Fetch all homes
  const fetchHomes = useCallback(async () => {
    setIsLoadingHomes(true)
    try {
      const res = await fetch('/api/homes')
      if (!res.ok) {
        throw new Error(`Failed to load homes (${res.status})`)
      }
      const data = (await res.json()) as { homes: HomeSummary[] }
      setHomes(data.homes || [])
      // If nothing selected and homes exist, select the first home
      if (data.homes && data.homes.length > 0) {
        setSelectedHomeId((prev) => prev || data.homes[0]?.id || null)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching homes'
      setGlobalError(msg)
    } finally {
      setIsLoadingHomes(false)
    }
  }, [])

  // 2. Fetch selected home detail & balances
  const fetchHomeData = useCallback(async (homeId: string) => {
    setIsLoadingHomeDetail(true)
    try {
      const [detailRes, balancesRes] = await Promise.all([
        fetch(`/api/homes/${homeId}`),
        fetch(`/api/homes/${homeId}/balances`),
      ])

      if (!detailRes.ok) {
        throw new Error(`Failed to fetch home details (${detailRes.status})`)
      }
      if (!balancesRes.ok) {
        throw new Error(`Failed to fetch balances (${balancesRes.status})`)
      }

      const detailData = (await detailRes.json()) as { home: HomeDetail }
      const balancesData = (await balancesRes.json()) as { balances: Balance[] }

      setHomeDetail(detailData.home)
      setBalances(balancesData.balances || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error loading home data'
      setGlobalError(msg)
    } finally {
      setIsLoadingHomeDetail(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchHomes()
  }, [fetchHomes])

  // Load home details when selection changes
  useEffect(() => {
    if (selectedHomeId) {
      fetchHomeData(selectedHomeId)
    } else {
      setHomeDetail(null)
      setBalances([])
    }
  }, [selectedHomeId, fetchHomeData])

  // Handler: Create Home
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim() || isCreatingHome) return
    clearNotifications()
    setIsCreatingHome(true)

    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })

      const data = (await res.json()) as { id?: string; name?: string; error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Failed to create home (${res.status})`)
      }

      setGlobalSuccess(`Home "${data.name}" created!`)
      setNewHomeName('')
      await fetchHomes()
      if (data.id) setSelectedHomeId(data.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating home'
      setGlobalError(msg)
    } finally {
      setIsCreatingHome(false)
    }
  }

  // Handler: Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHomeId || !newMemberName.trim() || isAddingMember) return
    clearNotifications()
    setIsAddingMember(true)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })

      const data = (await res.json()) as { id?: string; name?: string; error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Failed to add member (${res.status})`)
      }

      setGlobalSuccess(`Member "${data.name}" added successfully!`)
      setNewMemberName('')
      await fetchHomeData(selectedHomeId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error adding member'
      setGlobalError(msg)
    } finally {
      setIsAddingMember(false)
    }
  }

  // Handler: Create Bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHomeId || !newBillTitle.trim() || !newBillAmountDollars || isCreatingBill) return
    clearNotifications()

    const parsedDollars = Number.parseFloat(newBillAmountDollars)
    if (Number.isNaN(parsedDollars) || parsedDollars <= 0) {
      setGlobalError('Please enter a valid positive bill amount.')
      return
    }

    const totalCents = Math.round(parsedDollars * 100)
    setIsCreatingBill(true)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newBillTitle.trim(),
          totalCents,
        }),
      })

      const data = (await res.json()) as { id?: string; title?: string; error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Failed to create bill (${res.status})`)
      }

      setGlobalSuccess(`Bill "${data.title}" split among members!`)
      setNewBillTitle('')
      setNewBillAmountDollars('')
      await fetchHomeData(selectedHomeId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating bill'
      setGlobalError(msg)
    } finally {
      setIsCreatingBill(false)
    }
  }

  // Handler: Pay Share with Idempotency-Key
  const handlePayShare = async (billId: string, shareId: string) => {
    if (!selectedHomeId || payingShareId) return
    clearNotifications()
    setPayingShareId(shareId)

    // Generate client-side UUID idempotency key for this payment attempt
    const idempotencyKey = crypto.randomUUID()

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })

      const data = (await res.json()) as { paidAt?: string; error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Payment failed with status ${res.status}`)
      }

      setGlobalSuccess('Payment processed successfully!')
      // Refresh home data and balances
      await fetchHomeData(selectedHomeId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setGlobalError(msg)
    } finally {
      setPayingShareId(null)
    }
  }

  // Map member names for fast lookup
  const memberNameMap = new Map<string, string>()
  if (homeDetail?.members) {
    for (const m of homeDetail.members) {
      memberNameMap.set(m.id, m.name)
    }
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '28px',
              fontWeight: '700',
              letterSpacing: '-0.5px',
              background: 'linear-gradient(to right, #ffffff, #94a3b8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Shared Bill Splitter
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
            Fair, transparent, and idempotent bill management for shared homes.
          </p>
        </div>

        {/* Home Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label htmlFor="home-select" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Selected Home:
          </label>
          <select
            id="home-select"
            value={selectedHomeId || ''}
            onChange={(e) => setSelectedHomeId(e.target.value)}
            className="input-field"
            style={{ width: 'auto', minWidth: '180px', padding: '8px 12px' }}
            disabled={isLoadingHomes}
          >
            {homes.length === 0 ? (
              <option value="">No homes created yet</option>
            ) : (
              homes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))
            )}
          </select>
        </div>
      </header>

      {/* Global Notifications */}
      {globalError && (
        <div className="alert alert-error animate-fade-in" role="alert">
          <span>⚠️ {globalError}</span>
          <button
            type="button"
            onClick={() => setGlobalError(null)}
            className="btn btn-secondary"
            style={{ padding: '2px 8px', fontSize: '12px', border: 'none' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {globalSuccess && (
        <div className="alert alert-success animate-fade-in" role="status">
          <span>✓ {globalSuccess}</span>
          <button
            type="button"
            onClick={() => setGlobalSuccess(null)}
            className="btn btn-secondary"
            style={{ padding: '2px 8px', fontSize: '12px', border: 'none' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Left Column: Home Management & Outstanding Balances */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Create Home Panel */}
          <section className="glass-panel">
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              Create a Home
            </h2>
            <form onSubmit={handleCreateHome}>
              <div className="input-group">
                <label htmlFor="home-name-input" className="input-label">
                  Home Name
                </label>
                <input
                  id="home-name-input"
                  type="text"
                  placeholder="e.g., Flat 4B, Sunnyvale Villa"
                  className="input-field"
                  value={newHomeName}
                  onChange={(e) => setNewHomeName(e.target.value)}
                  disabled={isCreatingHome}
                  required
                />
              </div>
              <button
                type="submit"
                id="create-home-btn"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={isCreatingHome || !newHomeName.trim()}
              >
                {isCreatingHome ? (
                  <>
                    <span className="spinner" /> Creating Home...
                  </>
                ) : (
                  '+ Create Home'
                )}
              </button>
            </form>
          </section>

          {/* Members Panel */}
          {selectedHomeId && (
            <section className="glass-panel animate-fade-in">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}
              >
                <h2 style={{ fontSize: '18px', fontWeight: '600' }}>
                  Members ({homeDetail?.members?.length || 0})
                </h2>
                <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Insertion Order</span>
              </div>

              {homeDetail?.members && homeDetail.members.length > 0 ? (
                <ul
                  style={{
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginBottom: '16px',
                  }}
                >
                  {homeDetail.members.map((m, index) => (
                    <li
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid var(--surface-border)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-dim)',
                            width: '20px',
                            fontWeight: '600',
                          }}
                        >
                          #{index + 1}
                        </span>
                        <span style={{ fontWeight: '500' }}>{m.name}</span>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                        {m.id.slice(0, 8)}...
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                    padding: '16px',
                    textAlign: 'center',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '16px',
                  }}
                >
                  No members added yet. Add at least one member to split bills.
                </p>
              )}

              {/* Add Member Form */}
              <form onSubmit={handleAddMember}>
                <div className="input-group">
                  <label htmlFor="member-name-input" className="input-label">
                    Add Member
                  </label>
                  <input
                    id="member-name-input"
                    type="text"
                    placeholder="e.g., Asha, Ben, Chitra"
                    className="input-field"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    disabled={isAddingMember}
                    required
                  />
                </div>
                <button
                  type="submit"
                  id="add-member-btn"
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                  disabled={isAddingMember || !newMemberName.trim()}
                >
                  {isAddingMember ? (
                    <>
                      <span className="spinner" /> Adding Member...
                    </>
                  ) : (
                    '+ Add Member'
                  )}
                </button>
              </form>
            </section>
          )}

          {/* Balances Panel */}
          {selectedHomeId && (
            <section className="glass-panel animate-fade-in">
              <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
                Outstanding Balances
              </h2>

              {balances.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {balances.map((b) => (
                    <div
                      key={b.memberId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 16px',
                        background:
                          b.outstandingCents > 0
                            ? 'rgba(245, 158, 11, 0.05)'
                            : 'rgba(16, 185, 129, 0.05)',
                        border: `1px solid ${
                          b.outstandingCents > 0
                            ? 'rgba(245, 158, 11, 0.2)'
                            : 'rgba(16, 185, 129, 0.2)'
                        }`,
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <span style={{ fontWeight: '500' }}>{b.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontWeight: '700',
                            color: b.outstandingCents > 0 ? 'var(--warning)' : 'var(--success)',
                          }}
                        >
                          {formatCents(b.outstandingCents)}
                        </span>
                        {b.outstandingCents === 0 && (
                          <span className="badge badge-paid">Settled</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
                  No balance data available.
                </p>
              )}
            </section>
          )}
        </div>

        {/* Right Column: Bills & Shares */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {selectedHomeId ? (
            <>
              {/* Create Bill Panel */}
              <section className="glass-panel">
                <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
                  Create & Split Bill
                </h2>
                <form onSubmit={handleCreateBill}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    <div className="input-group">
                      <label htmlFor="bill-title-input" className="input-label">
                        Bill Title
                      </label>
                      <input
                        id="bill-title-input"
                        type="text"
                        placeholder="e.g., Electricity, Wi-Fi, Groceries"
                        className="input-field"
                        value={newBillTitle}
                        onChange={(e) => setNewBillTitle(e.target.value)}
                        disabled={isCreatingBill}
                        required
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="bill-amount-input" className="input-label">
                        Total Amount ($)
                      </label>
                      <input
                        id="bill-amount-input"
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="e.g., 30.00"
                        className="input-field"
                        value={newBillAmountDollars}
                        onChange={(e) => setNewBillAmountDollars(e.target.value)}
                        disabled={isCreatingBill}
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    id="create-bill-btn"
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: '8px' }}
                    disabled={
                      isCreatingBill ||
                      !newBillTitle.trim() ||
                      !newBillAmountDollars ||
                      (homeDetail?.members?.length || 0) === 0
                    }
                  >
                    {isCreatingBill ? (
                      <>
                        <span className="spinner" /> Splitting Bill...
                      </>
                    ) : (
                      'Split Bill Evenly'
                    )}
                  </button>
                  {(homeDetail?.members?.length || 0) === 0 && (
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--warning)',
                        marginTop: '8px',
                        textAlign: 'center',
                      }}
                    >
                      Cannot split a bill without members in the home.
                    </p>
                  )}
                </form>
              </section>

              {/* Bills List */}
              <section className="glass-panel">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <h2 style={{ fontSize: '18px', fontWeight: '600' }}>
                    Bills & Shares ({homeDetail?.bills?.length || 0})
                  </h2>
                  {isLoadingHomeDetail && <span className="spinner" />}
                </div>

                {homeDetail?.bills && homeDetail.bills.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {homeDetail.bills.map((bill) => {
                      const allPaid = bill.shares.every((s) => s.paidAt !== null)
                      return (
                        <div
                          key={bill.id}
                          style={{
                            background: 'rgba(15, 23, 42, 0.4)',
                            border: '1px solid var(--surface-border)',
                            borderRadius: 'var(--radius-md)',
                            padding: '18px',
                          }}
                        >
                          {/* Bill Header */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '14px',
                            }}
                          >
                            <div>
                              <h3 style={{ fontSize: '16px', fontWeight: '600' }}>{bill.title}</h3>
                              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                                Total: {formatCents(bill.totalCents)}
                              </span>
                            </div>
                            <span className={allPaid ? 'badge badge-paid' : 'badge badge-unpaid'}>
                              {allPaid ? 'Fully Paid' : 'Pending Shares'}
                            </span>
                          </div>

                          {/* Shares List */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {bill.shares.map((share) => {
                              const isPaid = share.paidAt !== null
                              const isProcessing = payingShareId === share.id
                              const memberName =
                                memberNameMap.get(share.memberId) || share.memberId.slice(0, 8)

                              return (
                                <div
                                  key={share.id}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '10px 12px',
                                    background: isPaid
                                      ? 'rgba(16, 185, 129, 0.04)'
                                      : 'rgba(255, 255, 255, 0.03)',
                                    border: '1px solid rgba(255, 255, 255, 0.06)',
                                    borderRadius: '6px',
                                  }}
                                >
                                  <div>
                                    <span style={{ fontWeight: '500', marginRight: '8px' }}>
                                      {memberName}
                                    </span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                                      {formatCents(share.amountCents)}
                                    </span>
                                  </div>

                                  <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
                                  >
                                    {isPaid ? (
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'flex-end',
                                        }}
                                      >
                                        <span className="badge badge-paid">Paid</span>
                                        <span
                                          style={{ fontSize: '10px', color: 'var(--text-dim)' }}
                                        >
                                          {new Date(share.paidAt as string).toLocaleTimeString()}
                                        </span>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        id={`pay-share-${share.id}`}
                                        className="btn btn-pay"
                                        onClick={() => handlePayShare(bill.id, share.id)}
                                        disabled={isProcessing || payingShareId !== null}
                                      >
                                        {isProcessing ? (
                                          <>
                                            <span className="spinner" /> Paying...
                                          </>
                                        ) : (
                                          'Pay Share'
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                      textAlign: 'center',
                      padding: '24px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    No bills split in this home yet.
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>
                Create or select a home on the left to start splitting bills.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
