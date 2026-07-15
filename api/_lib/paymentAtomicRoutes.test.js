import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin: vi.fn(),
  statusForAuthError: vi.fn(() => 401),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

const { default: handler } = await import('../admin/event.js')

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const REGISTRATION_ID = '22222222-2222-4222-8222-222222222222'
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333'
const REQUEST_ID = '44444444-4444-4444-8444-444444444444'

function request(method, body) {
  return {
    method,
    query: { resource: 'payments' },
    headers: { authorization: 'Bearer test' },
    body,
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

const canonical = {
  records: [],
  summary: {
    registrationId: REGISTRATION_ID,
    amountOwing: 5000,
    amountPaid: 0,
    balance: 5000,
    status: 'unpaid',
  },
}

describe('atomic ZLTAC payment route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: ACTOR_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    rpc.mockResolvedValue({ data: canonical, error: null })
  })

  it('creates through one idempotent RPC and returns its canonical response', async () => {
    const res = response()
    await handler(request('POST', {
      registrationId: REGISTRATION_ID,
      requestId: REQUEST_ID,
      amountCents: 2500,
      datePaid: '2026-07-14',
      bankReference: ' BANK-1 ',
      notes: ' Part payment ',
      type: 'payment',
    }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual(canonical)
    expect(rpc).toHaveBeenCalledWith('record_zltac_payment', {
      p_actor_id: ACTOR_ID,
      p_registration_id: REGISTRATION_ID,
      p_request_id: REQUEST_ID,
      p_amount: 2500,
      p_recorded_at: '2026-07-14',
      p_bank_reference: 'BANK-1',
      p_notes: 'Part payment',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('edits and deletes without a split parent lookup or post-commit query', async () => {
    const edited = response()
    await handler(request('PATCH', {
      id: PAYMENT_ID,
      requestId: REQUEST_ID,
      amountCents: 3000,
      notes: 'Corrected',
    }), edited)
    expect(rpc).toHaveBeenCalledWith('update_zltac_payment', {
      p_actor_id: ACTOR_ID,
      p_payment_id: PAYMENT_ID,
      p_request_id: REQUEST_ID,
      p_changes: { amount: 3000, bank_reference: null, notes: 'Corrected' },
    })
    expect(from).not.toHaveBeenCalled()

    rpc.mockClear()
    const deleted = response()
    await handler(request('DELETE', { id: PAYMENT_ID, requestId: REQUEST_ID }), deleted)
    expect(rpc).toHaveBeenCalledWith('remove_zltac_payment', {
      p_actor_id: ACTOR_ID,
      p_payment_id: PAYMENT_ID,
      p_request_id: REQUEST_ID,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a missing retry key before touching the database', async () => {
    const res = response()
    await handler(request('POST', {
      registrationId: REGISTRATION_ID,
      amountCents: 2500,
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'requestId must be a valid UUID' })
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('does not disclose an unexpected database error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'private database implementation detail' },
    })
    const res = response()
    await handler(request('POST', {
      registrationId: REGISTRATION_ID,
      requestId: REQUEST_ID,
      amountCents: 2500,
      type: 'payment',
    }), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(res.body)).not.toContain('implementation detail')
    consoleError.mockRestore()
  })
})
