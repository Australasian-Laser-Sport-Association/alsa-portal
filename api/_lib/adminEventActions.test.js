import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from },
}))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin: vi.fn(),
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./rateLimit.js', () => ({
  enforceRateLimit,
}))

const { default: handler } = await import('../admin/event.js')

const EVENT_ID = '123e4567-e89b-42d3-a456-426614174010'

function req(body) {
  return {
    method: 'POST',
    query: { resource: 'event' },
    headers: {},
    body,
  }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('admin event resource actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: 'committee-1' }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('rejects malformed event ids before touching the database', async () => {
    const response = res()
    await handler(req({ action: 'status', eventId: `${EVENT_ID}),status.eq.open`, status: 'open' }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual({ error: 'A valid eventId is required' })
    expect(from).not.toHaveBeenCalled()
  })

  it('saves events through an allowlisted service-role insert', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: EVENT_ID, name: 'ZLTAC 2027', year: 2027, status: 'draft' },
      error: null,
    })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    from.mockReturnValueOnce({ insert })

    const response = res()
    await handler(req({
      action: 'save',
      payload: {
        name: '  ZLTAC 2027  ',
        year: 2027,
        status: 'draft',
        main_fee: 0,
        team_fee: 0,
        dinner_guest_price: 6500,
        roles: ['superadmin'],
      },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, event: { id: EVENT_ID, name: 'ZLTAC 2027', year: 2027, status: 'draft' } })
    expect(from).toHaveBeenCalledWith('zltac_events')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ZLTAC 2027',
      year: 2027,
      status: 'draft',
      main_fee: 0,
    }))
    expect(insert.mock.calls[0][0]).not.toHaveProperty('roles')
  })

  it('updates event status through the service-role route', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: EVENT_ID, status: 'open' }, error: null })
    const select = vi.fn(() => ({ single }))
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn(() => ({ eq }))
    from.mockReturnValueOnce({ update })

    const response = res()
    await handler(req({ action: 'status', eventId: EVENT_ID, status: 'open' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, event: { id: EVENT_ID, status: 'open' } })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'open',
      updated_at: expect.any(String),
    }))
    expect(eq).toHaveBeenCalledWith('id', EVENT_ID)
  })
})
