import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()
const getCaptainCurrentTeamReadiness = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(error => (error === 'Unauthorized' ? 401 : 403)),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./eventPhase.js', () => ({ requireOpenPhase: vi.fn() }))
vi.mock('./zltacReadinessData.js', () => ({ getCaptainCurrentTeamReadiness }))

const { default: handler } = await import('../captain.js')

const CAPTAIN_ID = '123e4567-e89b-42d3-a456-426614174000'
const TEAM_ID = '223e4567-e89b-42d3-a456-426614174000'
const EVENT_ID = '323e4567-e89b-42d3-a456-426614174000'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function request(body) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body,
  }
}

describe('captain current-team readiness route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: CAPTAIN_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('rejects client-selected players and requires exact team/event identifiers', async () => {
    const res = response()
    await handler(request({
      action: 'team-readiness',
      teamId: 'not-a-uuid',
      eventId: EVENT_ID,
      playerIds: [CAPTAIN_ID],
    }), res)

    expect(res.statusCode).toBe(400)
    expect(getCaptainCurrentTeamReadiness).not.toHaveBeenCalled()
  })

  it('derives the roster behind the caller, team, and current-event boundary', async () => {
    const result = {
      event: { id: EVENT_ID, year: 2027 },
      team: { id: TEAM_ID },
      registrations: [],
      readinessByUser: {},
    }
    getCaptainCurrentTeamReadiness.mockResolvedValue(result)
    const res = response()

    await handler(request({ action: 'team-readiness', teamId: TEAM_ID, eventId: EVENT_ID }), res)

    expect(getCaptainCurrentTeamReadiness).toHaveBeenCalledWith({
      captainId: CAPTAIN_ID,
      teamId: TEAM_ID,
      eventId: EVENT_ID,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject(result)
  })

  it('does not fall back to a historic captained team', async () => {
    getCaptainCurrentTeamReadiness.mockResolvedValue(null)
    const res = response()

    await handler(request({ action: 'team-readiness', teamId: TEAM_ID, eventId: EVENT_ID }), res)

    expect(res.statusCode).toBe(404)
    expect(res.body.error).toMatch(/current team/i)
  })
})
