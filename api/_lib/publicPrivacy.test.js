import { beforeEach, describe, expect, it, vi } from 'vitest'

const enforceRateLimit = vi.fn()
const from = vi.fn()

vi.mock('./rateLimit.js', () => ({
  clientIp: vi.fn(() => '127.0.0.1'),
  enforceRateLimit,
}))

vi.mock('./supabase.js', () => ({
  default: {
    from,
    storage: { from: vi.fn() },
  },
}))

const { default: handler } = await import('../public.js')

function query(result) {
  const builder = {}
  for (const method of ['select', 'eq', 'in', 'is', 'not', 'or', 'order', 'limit', 'lte', 'gt', 'contains']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return builder
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    setHeader: vi.fn(),
  }
}

async function run(queryParams) {
  const res = response()
  await handler({ method: 'GET', query: queryParams, headers: {} }, res)
  return res
}

describe('public API privacy boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    from.mockReset()
    enforceRateLimit.mockResolvedValue(true)
  })

  it('returns side-event aliases without profile UUIDs', async () => {
    from.mockImplementation(table => {
      if (table === 'public_zltac_events') {
        return query({ data: { id: 'event-1' }, error: null })
      }
      if (table === 'doubles_pairs') {
        return query({ data: [{
          id: 'double-1', event_year: 2027,
          player1_id: 'profile-a', player2_id: 'profile-b', confirmed: true,
        }], error: null })
      }
      if (table === 'triples_teams') {
        return query({ data: [{
          id: 'triple-1', event_year: 2027,
          player1_id: 'profile-a', player2_id: 'profile-b', player3_id: 'profile-c', confirmed: true,
        }], error: null })
      }
      if (table === 'profiles') {
        return query({ data: [
          { id: 'profile-a', alias: 'Alpha' },
          { id: 'profile-b', alias: 'Bravo' },
          { id: 'profile-c', alias: 'Charlie' },
        ], error: null })
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await run({ resource: 'event', year: '2027' })

    expect(res.statusCode).toBe(200)
    expect(res.body.doubles[0]).toEqual({
      id: 'double-1', event_year: 2027,
      player1_alias: 'Alpha', player2_alias: 'Bravo', confirmed: true,
    })
    expect(res.body.triples[0].player3_alias).toBe('Charlie')
    expect(JSON.stringify(res.body)).not.toMatch(/profile-[abc]|player[123]_id/)
  })

  it('does not disclose side-event rosters for draft or unknown event years', async () => {
    from.mockImplementation(table => {
      if (table === 'public_zltac_events') return query({ data: null, error: null })
      throw new Error(`side-event table queried before event visibility: ${table}`)
    })

    const res = await run({ resource: 'event', year: '2027' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ doubles: [], triples: [] })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('rejects non-canonical event years before querying the database', async () => {
    const res = await run({ resource: 'event', year: '2027-draft' })

    expect(res.statusCode).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('omits a roster entry when any participant is suspended or has no public alias', async () => {
    const profilesQuery = query({
      data: [{ id: 'profile-a', alias: 'Alpha' }],
      error: null,
    })
    from.mockImplementation(table => {
      if (table === 'public_zltac_events') {
        return query({ data: { id: 'event-1' }, error: null })
      }
      if (table === 'doubles_pairs') {
        return query({ data: [{
          id: 'double-1', event_year: 2027,
          player1_id: 'profile-a', player2_id: 'profile-suspended', confirmed: true,
        }], error: null })
      }
      if (table === 'triples_teams') return query({ data: [], error: null })
      if (table === 'profiles') return profilesQuery
      throw new Error(`unexpected table ${table}`)
    })

    const res = await run({ resource: 'event', year: '2027' })

    expect(res.body).toEqual({ doubles: [], triples: [] })
    expect(profilesQuery.eq).toHaveBeenCalledWith('suspended', false)
  })

  it('reads competition discovery and rosters only from masked views', async () => {
    from.mockImplementation(table => {
      if (table === 'public_competitions') {
        return query({ data: { id: 'competition-1', slug: 'demo', name: 'Demo' }, error: null })
      }
      if (table === 'public_competition_roster_safe') {
        return query({ data: [{
          team_id: 'team-1', team_name: 'Green', team_colour: '#00ff41',
          alias: 'Alpha', role_in_team: 'captain',
        }], error: null })
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await run({ resource: 'roster', slug: 'demo' })

    expect(res.statusCode).toBe(200)
    expect(from).toHaveBeenCalledWith('public_competitions')
    expect(from).toHaveBeenCalledWith('public_competition_roster_safe')
    expect(res.body.teams[0].captain).toEqual({ alias: 'Alpha' })
    expect(JSON.stringify(res.body)).not.toMatch(/first_name|last_name|user_id/)
  })

  it('uses masked views for the combined public competition feed', async () => {
    from.mockImplementation(table => {
      if (table === 'public_zltac_events') return query({ data: [], error: null })
      if (table === 'public_competitions') return query({ data: [], error: null })
      throw new Error(`unexpected table ${table}`)
    })

    const res = await run({ resource: 'competitions' })

    expect(res.statusCode).toBe(200)
    expect(from).toHaveBeenCalledWith('public_zltac_events')
    expect(from).toHaveBeenCalledWith('public_competitions')
    expect(from).not.toHaveBeenCalledWith('zltac_events')
    expect(from).not.toHaveBeenCalledWith('competitions')
  })

  it('does not return stable profile identifiers in public committee directories', async () => {
    const alsaQuery = query({ data: [{
      id: 'profile-a', first_name: 'Alice', last_name: 'Admin', alias: 'Alpha',
      avatar_url: '/avatar.png', alsa_position: 'Secretary', roles: ['superadmin'],
    }], error: null })
    const zltacQuery = query({ data: [{
      id: 'profile-b', first_name: 'Zoe', last_name: 'Zone', alias: 'Zulu',
      avatar_url: null, roles: ['zltac_committee'],
    }], error: null })
    from
      .mockReturnValueOnce(alsaQuery)
      .mockReturnValueOnce(zltacQuery)

    const res = await run({ resource: 'committee' })

    expect(res.statusCode).toBe(200)
    expect(res.body.alsa[0]).toEqual({
      first_name: 'Alice', last_name: 'Admin', alias: 'Alpha',
      avatar_url: '/avatar.png', alsa_position: 'Secretary',
    })
    expect(JSON.stringify(res.body)).not.toMatch(/profile-[ab]|"id"|"roles"/)
    expect(alsaQuery.eq).toHaveBeenCalledWith('suspended', false)
    expect(zltacQuery.eq).toHaveBeenCalledWith('suspended', false)
  })

  it('does not return stable profile identifiers in the public member register', async () => {
    from.mockImplementation(table => {
      if (table === 'alsa_membership_periods') {
        return query({ data: { id: 'period-1', label: '2030', starts_at: '2030-01-01', ends_at: '2031-01-01' }, error: null })
      }
      if (table === 'alsa_lifetime_members') {
        return query({ data: [
          { profiles: { id: 'profile-life', first_name: 'Life', last_name: 'Member', alias: 'Legend', suspended: false } },
          { profiles: { id: 'profile-hidden-life', first_name: 'Hidden', last_name: 'Life', alias: 'SuspendedLife', suspended: true } },
        ], error: null })
      }
      if (table === 'alsa_memberships') {
        return query({ data: [
          { profiles: { id: 'profile-annual', first_name: 'Annual', last_name: 'Member', alias: 'Active', suspended: false } },
          { profiles: { id: 'profile-hidden-annual', first_name: 'Hidden', last_name: 'Annual', alias: 'SuspendedAnnual', suspended: true } },
        ], error: null })
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await run({ resource: 'members' })

    expect(res.statusCode).toBe(200)
    expect(res.body.members[0].alias).toBe('Active')
    expect(res.body.lifetime_members[0].alias).toBe('Legend')
    expect(res.body.members[0]).not.toHaveProperty('id')
    expect(res.body.lifetime_members[0]).not.toHaveProperty('id')
    expect(JSON.stringify(res.body)).not.toMatch(/profile-(life|annual)/)
    expect(JSON.stringify(res.body)).not.toMatch(/Suspended(Life|Annual)|Hidden/)
  })
})
