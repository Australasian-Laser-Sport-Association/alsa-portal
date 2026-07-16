import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROFILE_HANDLE_PURPOSES,
  issueOpaqueProfileHandle,
} from './opaqueProfileHandle.js'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const requireOpenPhase = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(() => 401),
  getActiveEventYear: vi.fn(),
}))
vi.mock('./eventPhase.js', () => ({ requireOpenPhase }))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

const { default: handler } = await import('../captain.js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const PLAYER_ID = '223e4567-e89b-42d3-a456-426614174000'
const TEAM_ID = '323e4567-e89b-42d3-a456-426614174000'
const EVENT_ID = '423e4567-e89b-42d3-a456-426614174000'
const YEAR = 2028

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

function query(result) {
  const builder = {}
  for (const method of ['select', 'eq', 'is', 'neq', 'in', 'ilike', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return builder
}

function installScopeQueries(extra = {}) {
  const eventQuery = query({ data: { id: EVENT_ID, year: YEAR, status: 'open' }, error: null })
  const teamQuery = query({
    data: { id: TEAM_ID, event_id: EVENT_ID, captain_id: USER_ID, status: 'draft' },
    error: null,
  })
  const registrationQuery = extra.registrationQuery ?? query({ data: [], error: null })
  const profileQuery = extra.profileQuery ?? query({ data: [], error: null })
  from.mockImplementation(table => ({
    zltac_events: eventQuery,
    teams: teamQuery,
    zltac_registrations: registrationQuery,
    profiles: profileQuery,
  })[table])
  return { eventQuery, teamQuery, registrationQuery, profileQuery }
}

describe('captain roster selector privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'captain-roster-test-secret')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    requireOpenPhase.mockResolvedValue({ ok: true, phase: 'open' })
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('fails captain team creation closed before its registration window', async () => {
    requireOpenPhase.mockResolvedValueOnce({
      error: 'Registration is locked. Contact the committee for changes.',
      phase: 'locked',
      status: 403,
    })
    const response = res()

    await handler(req({
      action: 'create-team', year: YEAR, name: 'Early Team',
      entryType: 'direct_entry', state: 'NSW',
    }), response)

    expect(response.statusCode).toBe(403)
    expect(response.body.phase).toBe('locked')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns only alias plus an actor/year-bound opaque handle from search', async () => {
    const registrationQuery = query({ data: [{ user_id: PLAYER_ID }], error: null })
    const profileQuery = query({
      data: [{
        id: PLAYER_ID,
        alias: 'Photon',
        first_name: 'Private',
        last_name: 'Player',
        state: 'NSW',
        roles: ['player'],
      }],
      error: null,
    })
    installScopeQueries({ registrationQuery, profileQuery })
    const response = res()

    await handler(req({
      action: 'search-players', teamId: TEAM_ID, eventId: EVENT_ID, term: 'Pho',
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.profiles).toHaveLength(1)
    expect(Object.keys(response.body.profiles[0]).sort()).toEqual(['alias', 'handle'])
    expect(response.body.profiles[0].alias).toBe('Photon')
    expect(response.body.profiles[0].handle).not.toContain(PLAYER_ID)
    expect(registrationQuery.neq).toHaveBeenCalledWith('status', 'cancelled')
    expect(profileQuery.select).toHaveBeenCalledWith('id, alias')
    expect(profileQuery.eq).toHaveBeenCalledWith('is_placeholder', false)
    expect(profileQuery.eq).toHaveBeenCalledWith('suspended', false)
  })

  it('rejects raw UUID mutation input before any roster query', async () => {
    const response = res()
    await handler(req({
      action: 'add-player', playerId: PLAYER_ID, teamId: TEAM_ID, eventId: EVENT_ID,
    }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/selection returned by search/i)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('resolves a valid actor/year-bound handle only at the service RPC boundary', async () => {
    installScopeQueries()
    const playerHandle = issueOpaqueProfileHandle({
      profileId: PLAYER_ID,
      actorId: USER_ID,
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
      scope: `event-year:${YEAR}`,
    })
    const response = res()

    await handler(req({
      action: 'add-player', playerHandle, teamId: TEAM_ID, eventId: EVENT_ID,
    }), response)

    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('add_zltac_team_player', {
      p_captain_id: USER_ID,
      p_player_id: PLAYER_ID,
      p_team_id: TEAM_ID,
      p_year: YEAR,
    })
  })

  it('rejects a handle issued for another event year', async () => {
    installScopeQueries()
    const playerHandle = issueOpaqueProfileHandle({
      profileId: PLAYER_ID,
      actorId: USER_ID,
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
      scope: `event-year:${YEAR + 1}`,
    })
    const response = res()

    await handler(req({
      action: 'add-player', playerHandle, teamId: TEAM_ID, eventId: EVENT_ID,
    }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/invalid or expired/i)
    expect(rpc).not.toHaveBeenCalled()
  })
})
