import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const statusForAuthError = vi.fn(error => (
  error === 'Unauthorized' ? 401 : error === 'Account suspended' ? 403 : 500
))
const enforceRateLimit = vi.fn()
const requireOpenPhase = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc },
}))

vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError,
  getActiveEventYear: vi.fn(),
}))

vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./eventPhase.js', () => ({ requireOpenPhase }))

const { default: handler } = await import('../captain.js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const TEAM_ID = '323e4567-e89b-42d3-a456-426614174000'
const EVENT_ID = '423e4567-e89b-42d3-a456-426614174000'

function req(body) {
  return {
    method: 'POST',
    query: {},
    headers: { authorization: 'Bearer captain-token' },
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

function body(overrides = {}) {
  return {
    action: 'update-team-settings',
    teamId: TEAM_ID,
    eventId: EVENT_ID,
    name: 'Team Photon',
    state: 'NSW',
    homeVenue: 'Central Arena',
    colour: '#00ff41',
    logoUrl: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/logo.png`,
    ...overrides,
  }
}

function team(overrides = {}) {
  return {
    id: TEAM_ID,
    event_id: EVENT_ID,
    captain_id: USER_ID,
    name: 'Team Photon',
    state: 'NSW',
    home_venue: 'Central Arena',
    colour: '#111111',
    logo_url: null,
    status: 'draft',
    ...overrides,
  }
}

describe('captain team presentation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    requireOpenPhase.mockResolvedValue({ ok: true, phase: 'open' })
    rpc.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts only the authenticated captain folder during initial team creation', async () => {
    const createBody = logoUrl => ({
      action: 'create-team',
      year: 2026,
      name: 'Team Photon',
      entryType: 'direct_entry',
      state: 'NSW',
      homeVenue: 'Central Arena',
      colour: '#00ff41',
      logoUrl,
    })
    const ownLogo = `https://project.supabase.co/storage/v1/object/public/team-logos/${USER_ID}/initial.png`
    rpc.mockResolvedValueOnce({ data: { team: team({ logo_url: ownLogo }) }, error: null })

    const accepted = res()
    await handler(req(createBody(ownLogo)), accepted)
    expect(accepted.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('create_zltac_captain_team', expect.objectContaining({
      p_user_id: USER_ID,
      p_logo_url: ownLogo,
    }))

    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    requireOpenPhase.mockResolvedValue({ ok: true, phase: 'open' })

    const rejected = res()
    await handler(req(createBody(
      'https://project.supabase.co/storage/v1/object/public/team-logos/other-captain/logo.png',
    )), rejected)
    expect(rejected.statusCode).toBe(400)
    expect(rejected.body.error).toMatch(/invalid team logo/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['Unauthorized', 401],
    ['Account suspended', 403],
    ['Internal error', 500],
  ])('maps %s authentication failure to %i', async (error, status) => {
    verifyUser.mockResolvedValueOnce({ user: null, error })

    const response = res()
    await handler(req(body()), response)

    expect(response.statusCode).toBe(status)
    expect(response.body).toEqual({ error })
    expect(enforceRateLimit).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects scope, status, and ownership fields before reading the team', async () => {
    const response = res()
    await handler(req(body({ status: 'approved', captain_id: USER_ID, competition_id: EVENT_ID })), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toContain('status')
    expect(from).not.toHaveBeenCalled()
  })

  it('maps database-enforced captain ownership denial', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Only the team captain can change this team.' },
    })

    const response = res()
    await handler(req(body()), response)

    expect(response.statusCode).toBe(403)
    expect(response.body.error).toMatch(/only the team captain/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('blocks presentation changes when the locked event lifecycle rejects them', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'Registration is not open for this event.' },
    })

    const response = res()
    await handler(req(body()), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/not open/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('updates presentation through one event-first RPC', async () => {
    const current = team({ status: 'pending' })
    const updated = {
      ...current,
      colour: '#00ff41',
      logo_url: body().logoUrl,
    }
    rpc.mockResolvedValueOnce({ data: { team: updated }, error: null })

    const response = res()
    await handler(req(body()), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ team: updated })
    expect(rpc).toHaveBeenCalledWith('captain_mutate_zltac_team', {
      p_actor_id: USER_ID,
      p_team_id: TEAM_ID,
      p_event_id: EVENT_ID,
      p_action: 'settings',
      p_changes: {
        name: 'Team Photon',
        state: 'NSW',
        home_venue: 'Central Arena',
        colour: '#00ff41',
        logo_url: body().logoUrl,
      },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('retains the captain-owned logo created before the team id existed', async () => {
    const captainLogo = `https://project.supabase.co/storage/v1/object/public/team-logos/${USER_ID}/initial.png`
    rpc.mockResolvedValueOnce({ data: { team: team({ logo_url: captainLogo }) }, error: null })

    const response = res()
    await handler(req(body({ logoUrl: captainLogo })), response)

    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('captain_mutate_zltac_team', expect.objectContaining({
      p_changes: expect.objectContaining({ logo_url: captainLogo }),
    }))
  })

  it('rejects a logo from another captain or team folder', async () => {
    const response = res()
    await handler(req(body({
      logoUrl: 'https://project.supabase.co/storage/v1/object/public/team-logos/other-team/logo.png',
    })), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/invalid team logo/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('locks identity fields after a team is submitted', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '55000',
        message: 'Team name, state, and home venue are locked after submission.',
      },
    })

    const response = res()
    await handler(req(body({ name: 'Renamed Team' })), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/locked after submission/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('submits through one atomic roster-validation RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { status: 'pending', count: 5 }, error: null })

    const response = res()
    await handler(req({ action: 'submit-team', teamId: TEAM_ID, eventId: EVENT_ID }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, status: 'pending', count: 5 })
    expect(rpc).toHaveBeenCalledWith('captain_mutate_zltac_team', {
      p_actor_id: USER_ID,
      p_team_id: TEAM_ID,
      p_event_id: EVENT_ID,
      p_action: 'submit',
      p_changes: {},
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('returns the atomic minimum-roster rejection without a separate count query', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'A team needs at least 5 eligible players to submit (currently 4).' },
    })

    const response = res()
    await handler(req({ action: 'submit-team', teamId: TEAM_ID, eventId: EVENT_ID }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/currently 4/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('routes unexpected mutation failures through the generic server error boundary', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'sensitive database detail' },
    })

    const response = res()
    await handler(req(body()), response)

    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual({ error: 'Internal server error' })
    consoleError.mockRestore()
  })
})
