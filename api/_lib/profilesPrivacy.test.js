import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(() => 401),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

const { default: handler } = await import('../profiles.js')

const USER_ID = '81111111-1111-4111-8111-111111111111'
const RELATED_ID = '82222222-2222-4222-8222-222222222222'
const UNRELATED_ID = '83333333-3333-4333-8333-333333333333'
const TEAM_ID = '84444444-4444-4444-8444-444444444444'

function query(result) {
  const chain = {}
  for (const method of ['select', 'eq', 'neq', 'in', 'or']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => result)
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return chain
}

function req(body) {
  return {
    method: 'POST',
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

describe('scoped profile resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, roles: ['player'], error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('omits unrelated requested profiles without querying or returning their identity', async () => {
    const callerRegistration = query({ data: null, error: null })
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return callerRegistration
      throw new Error(`unrelated profile lookup reached ${table}`)
    })

    const response = res()
    await handler(req({ ids: [UNRELATED_ID], year: 2027 }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ profiles: [] })
    expect(JSON.stringify(response.body)).not.toContain(UNRELATED_ID)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('returns alias-only identity for an exact shared side-event roster and no legal name', async () => {
    const callerRegistration = query({ data: { team_id: null, status: 'confirmed' }, error: null })
    const doubles = query({
      data: [{ player1_id: USER_ID, player2_id: RELATED_ID }],
      error: null,
    })
    const triples = query({ data: [], error: null })
    const relatedProfile = query({
      data: [{
        id: RELATED_ID,
        alias: 'SharedPartner',
        first_name: 'MustNotAppear',
        last_name: 'MustNotAppear',
      }],
      error: null,
    })

    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return callerRegistration
      if (table === 'doubles_pairs') return doubles
      if (table === 'triples_teams') return triples
      if (table === 'profiles') return relatedProfile
      throw new Error(`unexpected table: ${table}`)
    })

    const response = res()
    await handler(req({ ids: [RELATED_ID, UNRELATED_ID], year: 2027 }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({
      profiles: [{ id: RELATED_ID, alias: 'SharedPartner' }],
    })
    expect(JSON.stringify(response.body)).not.toContain('MustNotAppear')
    expect(relatedProfile.select).toHaveBeenCalledWith('id, alias')
    expect(JSON.stringify(response.body)).not.toContain(UNRELATED_ID)
  })

  it('returns an alias-only exact-year team roster with relationship roles', async () => {
    const registrations = query({
      data: [{ user_id: USER_ID }, { user_id: RELATED_ID }],
      error: null,
    })
    const team = query({ data: { captain_id: USER_ID, manager_id: null }, error: null })
    const profiles = query({
      data: [{ id: USER_ID, alias: 'CaptainAlias' }, { id: RELATED_ID, alias: 'PlayerAlias' }],
      error: null,
    })
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return registrations
      if (table === 'teams') return team
      if (table === 'profiles') return profiles
      throw new Error(`unexpected table: ${table}`)
    })

    const response = res()
    await handler(req({ teamId: TEAM_ID, eventYear: 2027 }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.profiles).toEqual([
      { id: USER_ID, alias: 'CaptainAlias', team_role: 'captain' },
      { id: RELATED_ID, alias: 'PlayerAlias', team_role: 'player' },
    ])
    expect(profiles.select).toHaveBeenCalledWith('id, alias')
  })

  it('caps arbitrary ID batches far below the former enumeration boundary', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => (
      `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`
    ))
    const response = res()
    await handler(req({ ids }), response)
    expect(response.statusCode).toBe(400)
    expect(response.body.error).toContain('max 50')
    expect(from).not.toHaveBeenCalled()
  })
})
