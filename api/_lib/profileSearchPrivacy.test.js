import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROFILE_HANDLE_PURPOSES,
  issueOpaqueProfileHandle,
  verifyOpaqueProfileHandle,
} from './opaqueProfileHandle.js'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const verifySuperAdmin = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  verifySuperAdmin,
  statusForAuthError: vi.fn(error => (error === 'Unauthorized' ? 401 : 403)),
}))

const { default: handler } = await import('../superadmin/[resource].js')

const ACTOR_ID = '123e4567-e89b-42d3-a456-426614174000'
const PROFILE_ID = '223e4567-e89b-42d3-a456-426614174000'
const COMPETITION_ID = '323e4567-e89b-42d3-a456-426614174000'
const TEAM_ID = '423e4567-e89b-42d3-a456-426614174000'
const MEMBERSHIP_ID = '523e4567-e89b-42d3-a456-426614174000'
const SECRET = 'test-only-existing-service-role-secret'

function req(resource, method, { query = {}, body = {} } = {}) {
  return {
    method,
    query: { resource, ...query },
    body,
    headers: { authorization: 'Bearer test-token' },
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

function handleFor(purpose) {
  return issueOpaqueProfileHandle({
    profileId: PROFILE_ID,
    actorId: ACTOR_ID,
    purpose,
  })
}

describe('superadmin profile-selection privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET
    verifyUser.mockResolvedValue({ user: { id: ACTOR_ID }, roles: ['player'], error: null })
    verifySuperAdmin.mockResolvedValue({ user: { id: ACTOR_ID }, error: null })
  })

  it('returns only alias plus an opaque handle and filters placeholder and suspended profiles', async () => {
    const eq = vi.fn(function eq() { return this })
    const is = vi.fn(function is() { return this })
    const ilike = vi.fn(function ilike() { return this })
    const limit = vi.fn(async () => ({
      data: [{
        id: PROFILE_ID,
        alias: 'LaserFox',
        first_name: 'LegalGivenNameNeverExpose',
        last_name: 'LegalFamilyNameNeverExpose',
        email: 'private@example.test',
        phone: '+61 400 123 456',
        alsa_member_id: 'ALSA-PRIVATE-007',
        suspended: false,
      }],
      error: null,
    }))
    const select = vi.fn(() => ({ eq, is, ilike, limit }))
    from.mockReturnValue({ select })

    const response = res()
    await handler(req('profile-search', 'GET', {
      query: {
        q: 'laser',
        purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
      },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(verifyUser).toHaveBeenCalledTimes(1)
    expect(verifySuperAdmin).not.toHaveBeenCalled()
    expect(response.body).toHaveLength(1)
    expect(Object.keys(response.body[0]).sort()).toEqual(['alias', 'handle'])
    expect(response.body[0].alias).toBe('LaserFox')
    expect(JSON.stringify(response.body)).not.toContain(PROFILE_ID)
    expect(JSON.stringify(response.body)).not.toContain(PROFILE_ID.split('-')[0])
    expect(JSON.stringify(response.body)).not.toContain('LegalGivenNameNeverExpose')
    expect(JSON.stringify(response.body)).not.toContain('LegalFamilyNameNeverExpose')
    expect(JSON.stringify(response.body)).not.toContain('private@example.test')
    expect(JSON.stringify(response.body)).not.toContain('+61 400 123 456')
    expect(JSON.stringify(response.body)).not.toContain('ALSA-PRIVATE-007')
    expect(select).toHaveBeenCalledWith('id, alias')
    expect(eq).toHaveBeenCalledWith('is_placeholder', false)
    expect(eq).toHaveBeenCalledWith('suspended', false)
    expect(is).toHaveBeenCalledWith('access_revoked_at', null)
    expect(verifyOpaqueProfileHandle({
      handle: response.body[0].handle,
      actorId: ACTOR_ID,
      purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
    }).profileId).toBe(PROFILE_ID)
  })

  it('resolves a captain invite handle server-side and rejects the old UUID body contract', async () => {
    const membership = {
      id: MEMBERSHIP_ID,
      user_id: PROFILE_ID,
      invite_status: 'pending',
    }
    from.mockImplementation(table => {
      if (table !== 'team_members') throw new Error(`unexpected table ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: membership, error: null })),
          })),
        })),
      }
    })
    rpc.mockResolvedValue({ data: { membership_id: MEMBERSHIP_ID }, error: null })

    const accepted = res()
    await handler(req('competition-team-member', 'POST', {
      body: {
        team_id: TEAM_ID,
        profile_handle: handleFor(PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE),
      },
    }), accepted)

    expect(accepted.statusCode).toBe(201)
    expect(rpc).toHaveBeenCalledWith('invite_competition_team_member', {
      p_actor_id: ACTOR_ID,
      p_team_id: TEAM_ID,
      p_invitee_id: PROFILE_ID,
    })

    rpc.mockClear()
    const rejected = res()
    await handler(req('competition-team-member', 'POST', {
      body: { team_id: TEAM_ID, invitee_user_id: PROFILE_ID },
    }), rejected)
    expect(rejected.statusCode).toBe(400)
    expect(rejected.body).toEqual({ error: 'profile_handle is required' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('resolves a manager-grant handle while leaving authorized list and delete IDs unchanged', async () => {
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: { competition_id: COMPETITION_ID, user_id: PROFILE_ID },
          error: null,
        })),
      })),
    }))
    from.mockImplementation(table => {
      if (table === 'competitions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { id: COMPETITION_ID }, error: null })),
            })),
          })),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { id: PROFILE_ID, is_placeholder: false, suspended: false },
                error: null,
              })),
            })),
          })),
        }
      }
      if (table === 'competition_managers') return { insert }
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(req('competition-managers', 'POST', {
      body: {
        competition_id: COMPETITION_ID,
        profile_handle: handleFor(PROFILE_HANDLE_PURPOSES.COMPETITION_MANAGER_GRANT),
      },
    }), response)

    expect(response.statusCode).toBe(201)
    expect(insert).toHaveBeenCalledWith({
      competition_id: COMPETITION_ID,
      user_id: PROFILE_ID,
      granted_by: ACTOR_ID,
    })

    insert.mockClear()
    const rejected = res()
    await handler(req('competition-managers', 'POST', {
      body: { competition_id: COMPETITION_ID, user_id: PROFILE_ID },
    }), rejected)
    expect(rejected.statusCode).toBe(400)
    expect(rejected.body).toEqual({ error: 'profile_handle is required' })
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('profile-selection browser contracts', () => {
  it('uses opaque handles in both search pickers and renders no search-result identity fragments', async () => {
    const [competitionHub, adminCompetitions, route] = await Promise.all([
      readFile(new URL('../../src/pages/competition/CompetitionHub.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/admin/AdminCompetitions.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../superadmin/[resource].js', import.meta.url), 'utf8'),
    ])

    const captainPanel = competitionHub.slice(
      competitionHub.indexOf('function CaptainInvitePanel'),
      competitionHub.indexOf('// ── Invitee alerts'),
    )
    const managerPanel = adminCompetitions.slice(
      adminCompetitions.indexOf('function ManagerPanel'),
      adminCompetitions.indexOf('// ── Page'),
    )
    const searchHandler = route.slice(
      route.indexOf('async function handleProfileSearch'),
      route.indexOf('// ── my-competitions'),
    )

    expect(captainPanel).toContain('purpose=competition-team-invite')
    expect(captainPanel).toContain('profile_handle: profile.handle')
    expect(captainPanel).not.toContain('invitee_user_id: profile.id')
    expect(captainPanel).not.toMatch(/p\.(?:id|first_name|last_name|alsa_id_short)/)

    expect(managerPanel).toContain('purpose=competition-manager-grant')
    expect(managerPanel).toContain('profile_handle: profile.handle')
    expect(managerPanel).not.toContain('user_id: profile.id')
    expect(managerPanel).not.toMatch(/p\.(?:id|first_name|last_name|alsa_id_short)/)

    expect(searchHandler).toContain(".select('id, alias')")
    expect(searchHandler).toContain(".eq('suspended', false)")
    expect(searchHandler).toContain(".is('access_revoked_at', null)")
    expect(searchHandler).not.toMatch(/first_name|last_name|email|phone|alsa_(?:id|member_id|id_short)/)
    expect(searchHandler).not.toMatch(/\bid:\s*profile\.id/)
  })
})
