import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc },
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

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const APPROVAL_ID = '123e4567-e89b-42d3-a456-426614174001'
const COMMITTEE_ID = '123e4567-e89b-42d3-a456-426614174099'

function req(method, body = {}) {
  return {
    method,
    query: { resource: 'under-18-approvals' },
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

describe('admin event under-18-approvals resource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: COMMITTEE_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('rejects malformed create ids before touching the database', async () => {
    const response = res()
    await handler(req('POST', {
      user_id: `${USER_ID}),status.eq.approved`,
      event_year: 2026,
      status: 'approved',
    }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual({ error: 'user_id must be a valid UUID' })
    expect(from).not.toHaveBeenCalled()
  })

  it('stamps new approvals with the verified committee user server-side', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: APPROVAL_ID }, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    from.mockReturnValueOnce({ insert })

    const response = res()
    await handler(req('POST', {
      user_id: USER_ID,
      event_year: 2026,
      status: 'approved',
      notes: '  emailed form  ',
    }), response)

    expect(response.statusCode).toBe(201)
    expect(response.body).toEqual({ ok: true, id: APPROVAL_ID })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: USER_ID,
      event_year: 2026,
      status: 'approved',
      notes: 'emailed form',
      approved_by: COMMITTEE_ID,
    }))
    expect(insert.mock.calls[0][0].approved_at).toEqual(expect.any(String))
  })

  it('updates approval status through the service-role route', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: APPROVAL_ID, status: 'pending', approved_at: null, approved_by: null },
      error: null,
    })
    const lookupEq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq: lookupEq }))
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq: updateEq }))
    from
      .mockReturnValueOnce({ select })
      .mockReturnValueOnce({ update })

    const response = res()
    await handler(req('PATCH', {
      id: APPROVAL_ID,
      status: 'approved',
      notes: '',
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'approved',
      notes: null,
      approved_by: COMMITTEE_ID,
    }))
    expect(update.mock.calls[0][0].approved_at).toEqual(expect.any(String))
    expect(updateEq).toHaveBeenCalledWith('id', APPROVAL_ID)
  })
})
