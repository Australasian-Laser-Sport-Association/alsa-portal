import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc },
}))

vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(error => (error === 'Unauthorized' ? 401 : error === 'Account suspended' ? 403 : 500)),
  getActiveEventYear: vi.fn(),
}))

vi.mock('./rateLimit.js', () => ({
  enforceRateLimit,
}))

vi.mock('./eventPhase.js', () => ({
  requireOpenPhase: vi.fn(() => Promise.resolve({ ok: true })),
  getEventPhase: vi.fn(() => Promise.resolve({ phase: 'open' })),
}))

vi.mock('./computeAmountOwing.js', () => ({
  computeAndWriteAmountOwing: vi.fn(),
}))

vi.mock('./placeholders.js', () => ({
  anyPlaceholder: vi.fn(),
}))

const { default: handler } = await import('../player.js')
const USER_ID = '123e4567-e89b-42d3-a456-426614174000'

function req(body = { action: 'cancel', year: 2026 }) {
  return {
    method: 'POST',
    query: { resource: 'registration' },
    headers: { authorization: 'Bearer test-token' },
    body,
  }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('player registration cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    rpc.mockResolvedValue({
      data: { deleted: true, registration_id: 'reg-1', doubles_deleted: 1, triples_deleted: 1 },
      error: null,
    })
  })

  it('cancels registration and side-event cleanup through one transaction RPC', async () => {
    const response = res()
    await handler(req(), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({
      ok: true,
      deleted: true,
      registration_id: 'reg-1',
      doubles_deleted: 1,
      triples_deleted: 1,
    })
    expect(rpc).toHaveBeenCalledWith('cancel_zltac_registration', {
      p_user_id: USER_ID,
      p_event_year: 2026,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('creates a player registration only through the transactional RPC', async () => {
    const registration = {
      id: 'reg-new',
      user_id: USER_ID,
      year: 2027,
      side_events: null,
      has_confirmed_side_events: false,
      dinner_guests: 0,
      has_confirmed_extras: false,
      dob_at_registration: '2000-01-02',
    }
    rpc.mockResolvedValueOnce({
      data: { ok: true, id: 'reg-new', existing: false, registration, amountOwing: 5000 },
      error: null,
    })

    const response = res()
    await handler(req({
      action: 'register',
      year: 2027,
      dob: '2000-01-02',
      emergency_contact_name: ' Helper ',
      emergency_contact_phone: ' 0400 000 000 ',
    }), response)

    expect(response.statusCode).toBe(201)
    expect(response.body).toEqual({ ok: true, id: 'reg-new', registration, amountOwing: 5000 })
    expect(rpc).toHaveBeenCalledWith('register_zltac_player', {
      p_user_id: USER_ID,
      p_event_year: 2027,
      p_dob: '2000-01-02',
      p_emergency_contact_name: 'Helper',
      p_emergency_contact_phone: '0400 000 000',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('returns a specific conflict when recorded payments block cancellation', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '55000',
        hint: 'PAYMENT_RECORDS_EXIST',
        message: 'A registration with recorded payments cannot be cancelled.',
      },
    })

    const response = res()
    await handler(req(), response)

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({
      error: 'A payment has been recorded for this registration. Contact the committee before cancelling.',
      code: 'PAYMENT_RECORDS_EXIST',
    })
    expect(from).not.toHaveBeenCalled()
  })
})
