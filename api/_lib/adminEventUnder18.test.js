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
    expect(rpc).not.toHaveBeenCalled()
  })

  it('creates approvals through the actor-bound transactional RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { id: APPROVAL_ID }, error: null })

    const response = res()
    await handler(req('POST', {
      user_id: USER_ID,
      event_year: 2026,
      status: 'approved',
      notes: '  emailed form  ',
    }), response)

    expect(response.statusCode).toBe(201)
    expect(response.body).toEqual({ ok: true, id: APPROVAL_ID })
    expect(rpc).toHaveBeenCalledWith('committee_create_under_18_approval', {
      p_actor_id: COMMITTEE_ID,
      p_user_id: USER_ID,
      p_event_year: 2026,
      p_status: 'approved',
      p_notes: 'emailed form',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('decides approvals through the actor-bound transactional RPC', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: APPROVAL_ID }], error: null })

    const response = res()
    await handler(req('PATCH', {
      id: APPROVAL_ID,
      status: 'approved',
      notes: '',
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('committee_decide_under_18_approval', {
      p_actor_id: COMMITTEE_ID,
      p_approval_id: APPROVAL_ID,
      p_status: 'approved',
      p_notes: null,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('returns a conflict when the RPC observes an archived event', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'Archived event' },
    })

    const response = res()
    await handler(req('PATCH', {
      id: APPROVAL_ID,
      status: 'rejected',
      notes: 'wrong form',
    }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/event cannot accept/i)
    expect(from).not.toHaveBeenCalled()
  })
})
