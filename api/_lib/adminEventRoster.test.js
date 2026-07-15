import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { rpc },
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
const TEAM_ID = '123e4567-e89b-42d3-a456-426614174001'

function req(body) {
  return {
    method: 'POST',
    query: { resource: 'team-roster' },
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

describe('admin event team-roster resource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: 'committee-1' }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    rpc.mockResolvedValue({
      data: { registrationId: 'reg-1', team_id: TEAM_ID, amountOwing: 1234 },
      error: null,
    })
  })

  it('routes add actions through the roster sync RPC', async () => {
    const response = res()
    await handler(req({ action: 'add', userId: USER_ID, year: 2026, teamId: TEAM_ID }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, registrationId: 'reg-1', team_id: TEAM_ID, amountOwing: 1234 })
    expect(rpc).toHaveBeenCalledWith('committee_set_zltac_team_roster', {
      p_actor_id: 'committee-1',
      p_user_id: USER_ID,
      p_year: 2026,
      p_team_id: TEAM_ID,
    })
  })

  it('routes remove actions through the roster sync RPC with a null team id', async () => {
    const response = res()
    await handler(req({ action: 'remove', userId: USER_ID, year: 2026 }), response)

    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('committee_set_zltac_team_roster', {
      p_actor_id: 'committee-1',
      p_user_id: USER_ID,
      p_year: 2026,
      p_team_id: null,
    })
  })

  it('rejects malformed ids before calling the database', async () => {
    const response = res()
    await handler(req({ action: 'move', userId: `${USER_ID}),player1_id.not.is.null`, year: 2026, teamId: TEAM_ID }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual({ error: 'userId must be a valid UUID' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps not-found RPC failures to 404 responses', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'Player is not registered for this event year.' } })

    const response = res()
    await handler(req({ action: 'remove', userId: USER_ID, year: 2026 }), response)

    expect(response.statusCode).toBe(404)
    expect(response.body).toEqual({ error: 'Player is not registered for this event year.' })
  })
})
