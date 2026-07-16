import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const statusForAuthError = vi.fn(error => (
  error === 'Unauthorized' ? 401 : error === 'Account suspended' ? 403 : 500
))
const enforceRateLimit = vi.fn()
const requireOpenPhase = vi.fn()
const storeCaptainLogo = vi.fn()
const teamLogoPathFromUrl = vi.fn()
const storageRemove = vi.fn()
const storageFrom = vi.fn(() => ({ remove: storageRemove }))

vi.mock('./supabase.js', () => ({
  default: { from, rpc, storage: { from: storageFrom } },
}))

vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError,
  getActiveEventYear: vi.fn(),
}))

vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./eventPhase.js', () => ({ requireOpenPhase }))
vi.mock('./captainLogoUpload.js', () => ({
  storeCaptainLogo,
  teamLogoPathFromUrl,
}))

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

function queryResult(data, error = null) {
  const query = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error })
  return query
}

function mockOwnedScope({
  event = { id: EVENT_ID, year: 2026, status: 'open' },
  ownedTeam = team(),
} = {}) {
  from
    .mockReturnValueOnce(queryResult(event))
    .mockReturnValueOnce(queryResult(ownedTeam))
}

describe('captain team presentation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    requireOpenPhase.mockResolvedValue({ ok: true, phase: 'open' })
    rpc.mockResolvedValue({ data: null, error: null })
    storeCaptainLogo.mockResolvedValue({
      data: {
        bucket: 'team-logos',
        path: `${TEAM_ID}/upload-id.png`,
        url: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/upload-id.png`,
        contentType: 'image/png',
        sizeBytes: 8,
      },
    })
    teamLogoPathFromUrl.mockReturnValue(null)
    storageRemove.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates a team with no client-controlled logo reference', async () => {
    const createBody = {
      action: 'create-team',
      year: 2026,
      name: 'Team Photon',
      entryType: 'direct_entry',
      state: 'NSW',
      homeVenue: 'Central Arena',
      colour: '#00ff41',
    }
    rpc.mockResolvedValueOnce({ data: { team: team() }, error: null })

    const response = res()
    await handler(req(createBody), response)
    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('create_zltac_captain_team', expect.objectContaining({
      p_user_id: USER_ID,
      p_logo_url: null,
    }))
  })

  it.each(['logoUrl', 'logo_url'])(
    'rejects client-controlled %s during team creation',
    async logoField => {
      const response = res()
      await handler(req({
        action: 'create-team',
        year: 2026,
        name: 'Team Photon',
        entryType: 'direct_entry',
        state: 'NSW',
        [logoField]: `https://project.supabase.co/storage/v1/object/public/team-logos/${USER_ID}/logo.png`,
      }), response)

      expect(response.statusCode).toBe(400)
      expect(response.body.error).toContain(logoField)
      expect(rpc).not.toHaveBeenCalled()
    },
  )

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
      },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it.each(['logoUrl', 'logo_url'])(
    'rejects client-controlled %s during settings updates',
    async logoField => {
      const response = res()
      await handler(req(body({
        [logoField]: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/logo.png`,
      })), response)

      expect(response.statusCode).toBe(400)
      expect(response.body.error).toContain(logoField)
      expect(rpc).not.toHaveBeenCalled()
    },
  )

  it('uploads a validated logo only after captain scope and lifecycle checks', async () => {
    const previousUrl = `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/previous.png`
    const updated = team({
      logo_url: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/upload-id.png`,
    })
    mockOwnedScope({ ownedTeam: team({ logo_url: previousUrl }) })
    teamLogoPathFromUrl.mockReturnValue(`${TEAM_ID}/previous.png`)
    rpc.mockResolvedValueOnce({ data: { team: updated }, error: null })

    const response = res()
    await handler(req({
      action: 'upload-team-logo',
      teamId: TEAM_ID,
      eventId: EVENT_ID,
      contentType: 'image/png',
      sizeBytes: 8,
      dataBase64: 'iVBORw0KGgo=',
    }), response)

    expect(response.statusCode).toBe(200)
    expect(enforceRateLimit).toHaveBeenCalledTimes(2)
    expect(enforceRateLimit).toHaveBeenLastCalledWith(
      expect.any(Object),
      response,
      expect.objectContaining({
        identifier: USER_ID,
        limit: 5,
        window: '1 d',
        prefix: 'captain-logo-uploads',
        requireDistributed: true,
      }),
    )
    expect(requireOpenPhase).toHaveBeenCalledWith(2026)
    expect(storeCaptainLogo).toHaveBeenCalledWith(expect.objectContaining({
      teamId: TEAM_ID,
      input: expect.objectContaining({
        eventId: EVENT_ID,
        contentType: 'image/png',
      }),
    }))
    expect(rpc).toHaveBeenCalledWith('captain_mutate_zltac_team', {
      p_actor_id: USER_ID,
      p_team_id: TEAM_ID,
      p_event_id: EVENT_ID,
      p_action: 'settings',
      p_changes: {
        logo_url: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/upload-id.png`,
      },
    })
    expect(storageFrom).toHaveBeenCalledWith('team-logos')
    expect(storageRemove).toHaveBeenCalledWith([`${TEAM_ID}/previous.png`])
  })

  it('stops an upload before Storage when the team is not owned or the event is locked', async () => {
    mockOwnedScope({ ownedTeam: null })
    const missingResponse = res()
    await handler(req({
      action: 'upload-team-logo',
      teamId: TEAM_ID,
      eventId: EVENT_ID,
    }), missingResponse)

    expect(missingResponse.statusCode).toBe(404)
    expect(storeCaptainLogo).not.toHaveBeenCalled()

    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    requireOpenPhase.mockResolvedValue({
      error: 'Registration is locked.',
      phase: 'locked',
      status: 403,
    })
    mockOwnedScope()

    const lockedResponse = res()
    await handler(req({
      action: 'upload-team-logo',
      teamId: TEAM_ID,
      eventId: EVENT_ID,
    }), lockedResponse)

    expect(lockedResponse.statusCode).toBe(403)
    expect(storeCaptainLogo).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('removes a unique new object when the database logo update fails', async () => {
    mockOwnedScope({
      ownedTeam: team({
        logo_url: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/previous.png`,
      }),
    })
    teamLogoPathFromUrl.mockReturnValue(`${TEAM_ID}/previous.png`)
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'Registration is not open for this event.' },
    })

    const response = res()
    await handler(req({
      action: 'upload-team-logo',
      teamId: TEAM_ID,
      eventId: EVENT_ID,
    }), response)

    expect(response.statusCode).toBe(409)
    expect(storageRemove).toHaveBeenCalledWith([`${TEAM_ID}/upload-id.png`])
  })

  it('never deletes the still-referenced object when rollback paths match', async () => {
    mockOwnedScope({
      ownedTeam: team({
        logo_url: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/upload-id.png`,
      }),
    })
    teamLogoPathFromUrl.mockReturnValue(`${TEAM_ID}/upload-id.png`)
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'Registration is not open for this event.' },
    })

    const response = res()
    await handler(req({
      action: 'upload-team-logo',
      teamId: TEAM_ID,
      eventId: EVENT_ID,
    }), response)

    expect(response.statusCode).toBe(409)
    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('best-effort removes only the current team-scoped logo after disbanding', async () => {
    mockOwnedScope({
      ownedTeam: team({
        logo_url: `https://project.supabase.co/storage/v1/object/public/team-logos/${TEAM_ID}/upload-id.png`,
      }),
    })
    teamLogoPathFromUrl.mockReturnValue(`${TEAM_ID}/upload-id.png`)
    rpc.mockResolvedValueOnce({ data: { deleted: true }, error: null })

    const response = res()
    await handler(req({
      action: 'disband-team',
      teamId: TEAM_ID,
      eventId: EVENT_ID,
    }), response)

    expect(response.statusCode).toBe(200)
    expect(storageRemove).toHaveBeenCalledWith([`${TEAM_ID}/upload-id.png`])

    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    requireOpenPhase.mockResolvedValue({ ok: true, phase: 'open' })
    rpc.mockResolvedValueOnce({ data: { deleted: true }, error: null })
    storageRemove.mockResolvedValue({ data: null, error: null })
    teamLogoPathFromUrl.mockReturnValue('different-team/upload-id.png')
    mockOwnedScope({
      ownedTeam: team({
        logo_url: 'https://project.supabase.co/storage/v1/object/public/team-logos/different-team/upload-id.png',
      }),
    })

    const otherFolderResponse = res()
    await handler(req({
      action: 'disband-team',
      teamId: TEAM_ID,
      eventId: EVENT_ID,
    }), otherFolderResponse)

    expect(otherFolderResponse.statusCode).toBe(200)
    expect(storageRemove).not.toHaveBeenCalled()
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
