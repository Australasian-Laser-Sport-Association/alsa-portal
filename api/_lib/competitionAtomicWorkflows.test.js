import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROFILE_HANDLE_PURPOSES,
  issueOpaqueProfileHandle,
} from './opaqueProfileHandle.js'

const from = vi.fn()
const rpc = vi.fn()
const storageFrom = vi.fn()
const verifyUser = vi.fn()
const verifySuperAdmin = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc, storage: { from: storageFrom } } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  verifySuperAdmin,
  statusForAuthError: vi.fn(error => (error === 'Unauthorized' ? 401 : 403)),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
const { default: handler } = await import('../superadmin/[resource].js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const INVITEE_ID = '223e4567-e89b-42d3-a456-426614174000'
const COMPETITION_ID = '323e4567-e89b-42d3-a456-426614174000'
const TEAM_ID = '423e4567-e89b-42d3-a456-426614174000'
const MEMBERSHIP_ID = '523e4567-e89b-42d3-a456-426614174000'
const REGISTRATION_ID = '623e4567-e89b-42d3-a456-426614174000'
const PAYMENT_ID = '723e4567-e89b-42d3-a456-426614174000'
const REQUEST_ID = '823e4567-e89b-42d3-a456-426614174000'
const PENDING_MEMBER_ID = '923e4567-e89b-42d3-a456-426614174000'
const DECLINED_MEMBER_ID = 'a23e4567-e89b-42d3-a456-426614174000'

function req(resource, method, { body = {}, query = {} } = {}) {
  return {
    method,
    query: { resource, ...query },
    headers: { authorization: 'Bearer player-token' },
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

const team = {
  id: TEAM_ID,
  competition_id: COMPETITION_ID,
  name: 'Atomic Team',
  colour: '#00E6FF',
  captain_id: USER_ID,
  manager_id: USER_ID,
  status: 'pending',
  created_at: '2026-07-13T00:00:00Z',
}

const membership = {
  id: MEMBERSHIP_ID,
  team_id: TEAM_ID,
  user_id: INVITEE_ID,
  roles: ['player'],
  invite_status: 'pending',
  invited_at: '2026-07-13T00:00:00Z',
  responded_at: null,
  invited_by: USER_ID,
  profile: { id: INVITEE_ID, alias: 'Invitee', first_name: 'In', last_name: 'Vitee' },
}

function installReadMocks() {
  from.mockImplementation(table => {
    if (table === 'teams') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: team, error: null })),
          })),
        })),
      }
    }
    if (table === 'team_members') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(field => {
            if (field === 'id') {
              return {
                maybeSingle: vi.fn(() => Promise.resolve({ data: membership, error: null })),
              }
            }
            return Promise.resolve({
              data: [{ ...membership, user_id: USER_ID, roles: ['captain'], invite_status: 'accepted' }],
              error: null,
            })
          }),
        })),
      }
    }
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({
              data: { roles: ['superadmin'] },
              error: null,
            })),
          })),
        })),
      }
    }
    if (table === 'competition_registrations') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({
              data: { id: REGISTRATION_ID, competition_id: COMPETITION_ID },
              error: null,
            })),
          })),
        })),
      }
    }
    if (table === 'payment_records') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      }
    }
    throw new Error(`unexpected read from ${table}`)
  })
}

describe('atomic competition route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-existing-service-role-secret'
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, roles: ['player'], error: null })
    verifySuperAdmin.mockResolvedValue({ user: null, error: 'Forbidden' })
    enforceRateLimit.mockResolvedValue(true)
    installReadMocks()
    rpc.mockImplementation(async name => {
      if (name === 'create_competition_team' || name === 'update_competition_team') {
        return { data: { team_id: TEAM_ID }, error: null }
      }
      if (name === 'invite_competition_team_member' || name === 'respond_competition_team_invite') {
        return { data: { membership_id: MEMBERSHIP_ID }, error: null }
      }
      return { data: { deleted: true }, error: null }
    })
  })

  it('issues a banner upload token only for the exact managed competition', async () => {
    const managerCompetitionEq = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ count: 1, error: null })),
    }))
    from.mockImplementation(table => {
      if (table === 'competitions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: COMPETITION_ID, archived_at: null },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: { roles: ['player'] }, error: null }),
            })),
          })),
        }
      }
      if (table === 'competition_managers') {
        return { select: vi.fn(() => ({ eq: managerCompetitionEq })) }
      }
      throw new Error(`unexpected read from ${table}`)
    })
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { token: 'single-object-token' },
      error: null,
    })
    storageFrom.mockReturnValue({ createSignedUploadUrl })
    const response = res()

    await handler(req('competition-asset-upload', 'POST', {
      body: {
        action: 'issue',
        purpose: 'competition-banner',
        scopeId: COMPETITION_ID,
        contentType: 'image/png',
        sizeBytes: 2048,
      },
    }), response)

    expect(response.statusCode).toBe(201)
    expect(response.body).toMatchObject({
      bucket: 'competition-banners',
      token: 'single-object-token',
      url: expect.stringMatching(new RegExp(`^/assets/competition-banners/${COMPETITION_ID}/banners/`)),
    })
    expect(managerCompetitionEq).toHaveBeenCalledWith('competition_id', COMPETITION_ID)
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), response, expect.objectContaining({
      identifier: USER_ID,
      requireDistributed: true,
    }))
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${COMPETITION_ID}/banners/[0-9a-f-]+\\.png$`)),
      { upsert: false },
    )
  })

  it('finalizes a managed competition banner only after metadata verification and audit recording', async () => {
    const managerCompetitionEq = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ count: 1, error: null })),
    }))
    const upsert = vi.fn().mockResolvedValue({ error: null })
    from.mockImplementation(table => {
      if (table === 'competitions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: COMPETITION_ID, archived_at: null },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: { roles: ['player'] }, error: null }),
            })),
          })),
        }
      }
      if (table === 'competition_managers') {
        return { select: vi.fn(() => ({ eq: managerCompetitionEq })) }
      }
      if (table === 'admin_asset_upload_audit') return { upsert }
      throw new Error(`unexpected read from ${table}`)
    })
    const path = `${COMPETITION_ID}/banners/923e4567-e89b-42d3-a456-426614174000.png`
    const info = vi.fn().mockResolvedValue({
      data: { size: 2048, contentType: 'image/png', bucketId: 'competition-banners' },
      error: null,
    })
    storageFrom.mockReturnValue({ info })
    const response = res()

    await handler(req('competition-asset-upload', 'POST', {
      body: {
        action: 'finalize',
        purpose: 'competition-banner',
        scopeId: COMPETITION_ID,
        contentType: 'image/png',
        sizeBytes: 2048,
        bucket: 'competition-banners',
        path,
      },
    }), response)

    expect(response.statusCode).toBe(201)
    expect(response.body).toEqual({
      bucket: 'competition-banners',
      path,
      url: `/assets/competition-banners/${path}`,
      contentType: 'image/png',
      sizeBytes: 2048,
    })
    expect(info).toHaveBeenCalledWith(path)
    expect(upsert).toHaveBeenCalledWith({
      actor_id: USER_ID,
      purpose: 'competition-banner',
      scope_id: COMPETITION_ID,
      bucket: 'competition-banners',
      object_path: path,
      object_size: 2048,
      content_type: 'image/png',
    }, {
      onConflict: 'bucket,object_path',
      ignoreDuplicates: true,
    })
  })

  it('denies cross-competition managers and archived upload targets before signing', async () => {
    const install = ({ archivedAt = null, managerCount = 0 } = {}) => {
      from.mockImplementation(table => {
        if (table === 'competitions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: COMPETITION_ID, archived_at: archivedAt },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: { roles: ['player'] }, error: null }),
              })),
            })),
          }
        }
        if (table === 'competition_managers') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ count: managerCount, error: null }),
              })),
            })),
          }
        }
        throw new Error(`unexpected read from ${table}`)
      })
    }
    const createSignedUploadUrl = vi.fn()
    storageFrom.mockReturnValue({ createSignedUploadUrl })
    const body = {
      action: 'issue',
      purpose: 'competition-banner',
      scopeId: COMPETITION_ID,
      contentType: 'image/png',
      sizeBytes: 2048,
    }

    install({ managerCount: 0 })
    const forbidden = res()
    await handler(req('competition-asset-upload', 'POST', { body }), forbidden)
    expect(forbidden.statusCode).toBe(403)

    install({ archivedAt: '2026-07-13T00:00:00Z', managerCount: 1 })
    const archived = res()
    await handler(req('competition-asset-upload', 'POST', { body }), archived)
    expect(archived.statusCode).toBe(409)
    expect(createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('cancels registration through one database transaction', async () => {
    const response = res()
    await handler(req('competition-registration', 'DELETE', {
      query: { competition_id: COMPETITION_ID },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ deleted: true })
    expect(rpc).toHaveBeenCalledWith('cancel_competition_registration', {
      p_user_id: USER_ID,
      p_competition_id: COMPETITION_ID,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('creates, updates, and disbands a team only through atomic RPCs', async () => {
    const created = res()
    await handler(req('competition-team', 'POST', {
      body: { competition_id: COMPETITION_ID, name: 'Atomic Team', colour: '#00E6FF' },
    }), created)
    expect(created.statusCode).toBe(201)
    expect(created.body).toMatchObject({ id: TEAM_ID, members: expect.any(Array) })
    expect(rpc).toHaveBeenCalledWith('create_competition_team', {
      p_actor_id: USER_ID,
      p_competition_id: COMPETITION_ID,
      p_name: 'Atomic Team',
      p_colour: '#00E6FF',
    })

    const updated = res()
    await handler(req('competition-team', 'PATCH', {
      query: { team_id: TEAM_ID },
      body: { name: 'Renamed Team', colour: '#30D158' },
    }), updated)
    expect(updated.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('update_competition_team', {
      p_actor_id: USER_ID,
      p_team_id: TEAM_ID,
      p_name: 'Renamed Team',
      p_colour: '#30D158',
    })

    const deleted = res()
    await handler(req('competition-team', 'DELETE', {
      query: { team_id: TEAM_ID },
    }), deleted)
    expect(deleted.body).toEqual({ deleted: true })
    expect(rpc).toHaveBeenCalledWith('disband_competition_team', {
      p_actor_id: USER_ID,
      p_team_id: TEAM_ID,
    })
  })

  it('returns only accepted teammates to an accepted non-captain', async () => {
    verifyUser.mockResolvedValue({ user: { id: INVITEE_ID }, roles: ['player'], error: null })
    const acceptedViewer = { ...membership, invite_status: 'accepted' }
    const captain = {
      ...membership,
      id: 'b23e4567-e89b-42d3-a456-426614174000',
      user_id: USER_ID,
      roles: ['captain'],
      invite_status: 'accepted',
    }
    const pending = { ...membership, id: PENDING_MEMBER_ID, user_id: PENDING_MEMBER_ID }
    const declined = {
      ...membership,
      id: DECLINED_MEMBER_ID,
      user_id: DECLINED_MEMBER_ID,
      invite_status: 'declined',
    }

    from.mockImplementation(table => {
      if (table === 'teams') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: team, error: null }),
            })),
          })),
        }
      }
      if (table === 'team_members') {
        return {
          select: vi.fn(columns => {
            if (columns.startsWith('team_id, teams')) {
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { team_id: TEAM_ID },
                        error: null,
                      }),
                    })),
                  })),
                })),
              }
            }
            return {
              eq: vi.fn().mockResolvedValue({
                data: [acceptedViewer, captain, pending, declined],
                error: null,
              }),
            }
          }),
        }
      }
      throw new Error(`unexpected read from ${table}`)
    })

    const response = res()
    await handler(req('competition-team', 'GET', {
      query: { competition_id: COMPETITION_ID },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.members.map(row => row.invite_status)).toEqual(['accepted', 'accepted'])
    expect(response.body.members.map(row => row.id)).not.toContain(PENDING_MEMBER_ID)
    expect(response.body.members.map(row => row.id)).not.toContain(DECLINED_MEMBER_ID)
  })

  it('denies retained pending or declined invite rows access to the roster', async () => {
    verifyUser.mockResolvedValue({ user: { id: INVITEE_ID }, roles: ['player'], error: null })
    const rosterSelect = vi.fn()
    from.mockImplementation(table => {
      if (table !== 'team_members') throw new Error(`unexpected read from ${table}`)
      return {
        select: vi.fn(columns => {
          if (columns !== 'invite_status, roles') return rosterSelect(columns)
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { invite_status: 'declined', roles: ['player'] },
                  error: null,
                }),
              })),
            })),
          }
        }),
      }
    })

    const response = res()
    await handler(req('competition-team-member', 'GET', {
      query: { team_id: TEAM_ID },
    }), response)

    expect(response.statusCode).toBe(403)
    expect(response.body.error).toMatch(/accepted member/i)
    expect(rosterSelect).not.toHaveBeenCalled()
  })

  it('keeps pending invite visibility for the accepted captain but hides declined rows', async () => {
    const captain = {
      ...membership,
      id: 'b23e4567-e89b-42d3-a456-426614174000',
      user_id: USER_ID,
      roles: ['captain'],
      invite_status: 'accepted',
    }
    const pending = { ...membership, id: PENDING_MEMBER_ID, user_id: PENDING_MEMBER_ID }
    const declined = {
      ...membership,
      id: DECLINED_MEMBER_ID,
      user_id: DECLINED_MEMBER_ID,
      invite_status: 'declined',
    }

    from.mockImplementation(table => {
      if (table !== 'team_members') throw new Error(`unexpected read from ${table}`)
      return {
        select: vi.fn(columns => {
          if (columns === 'invite_status, roles') {
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { invite_status: 'accepted', roles: ['captain'] },
                    error: null,
                  }),
                })),
              })),
            }
          }
          return {
            eq: vi.fn().mockResolvedValue({ data: [captain, pending, declined], error: null }),
          }
        }),
      }
    })

    const response = res()
    await handler(req('competition-team-member', 'GET', {
      query: { team_id: TEAM_ID },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.map(row => row.invite_status)).toEqual(['accepted', 'pending'])
    expect(response.body.map(row => row.id)).not.toContain(DECLINED_MEMBER_ID)
  })

  it('invites and removes membership through locked workflows', async () => {
    const profileHandle = issueOpaqueProfileHandle({
      profileId: INVITEE_ID,
      actorId: USER_ID,
      purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
    })
    const invited = res()
    await handler(req('competition-team-member', 'POST', {
      body: { team_id: TEAM_ID, profile_handle: profileHandle },
    }), invited)
    expect(invited.statusCode).toBe(201)
    expect(invited.body.id).toBe(MEMBERSHIP_ID)
    expect(rpc).toHaveBeenCalledWith('invite_competition_team_member', {
      p_actor_id: USER_ID,
      p_team_id: TEAM_ID,
      p_invitee_id: INVITEE_ID,
    })

    const removed = res()
    await handler(req('competition-team-member', 'DELETE', {
      query: { id: MEMBERSHIP_ID },
    }), removed)
    expect(removed.body).toEqual({ deleted: true })
    expect(rpc).toHaveBeenCalledWith('remove_competition_team_member', {
      p_actor_id: USER_ID,
      p_membership_id: MEMBERSHIP_ID,
    })
  })

  it('accepts or declines an invite through the serialized response workflow', async () => {
    const response = res()
    await handler(req('competition-team-invite', 'PATCH', {
      query: { id: MEMBERSHIP_ID },
      body: { action: 'accept' },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.id).toBe(MEMBERSHIP_ID)
    expect(rpc).toHaveBeenCalledWith('respond_competition_team_invite', {
      p_actor_id: USER_ID,
      p_membership_id: MEMBERSHIP_ID,
      p_action: 'accept',
    })
  })

  it('records competition billing through the lifecycle-locked payment RPC', async () => {
    const response = res()
    await handler(req('competition-payment-records', 'POST', {
      body: {
        competition_registration_id: REGISTRATION_ID,
        requestId: REQUEST_ID,
        amountCents: 2500,
        bank_reference: 'BANK-1',
        notes: 'Part payment',
      },
    }), response)

    expect(response.statusCode).toBe(201)
    expect(rpc).toHaveBeenCalledWith('record_competition_payment', {
      p_actor_id: USER_ID,
      p_registration_id: REGISTRATION_ID,
      p_request_id: REQUEST_ID,
      p_amount: 2500,
      p_recorded_at: null,
      p_bank_reference: 'BANK-1',
      p_notes: 'Part payment',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('edits and deletes competition payments through retry-safe RPCs without split reads', async () => {
    const edited = res()
    await handler(req('competition-payment-records', 'PATCH', {
      query: { id: PAYMENT_ID },
      body: { requestId: REQUEST_ID, amountCents: 3000, notes: 'Corrected' },
    }), edited)

    expect(edited.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('update_competition_payment', {
      p_actor_id: USER_ID,
      p_payment_id: PAYMENT_ID,
      p_request_id: REQUEST_ID,
      p_changes: { amount: 3000, notes: 'Corrected' },
    })
    expect(from).not.toHaveBeenCalled()

    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, roles: ['player'], error: null })
    rpc.mockResolvedValue({ data: { records: [], summary: { registrationId: REGISTRATION_ID } }, error: null })

    const deleted = res()
    await handler(req('competition-payment-records', 'DELETE', {
      query: { id: PAYMENT_ID },
      body: { requestId: REQUEST_ID },
    }), deleted)

    expect(deleted.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('remove_competition_payment', {
      p_actor_id: USER_ID,
      p_payment_id: PAYMENT_ID,
      p_request_id: REQUEST_ID,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('moderates official roster status through the locked manager RPC', async () => {
    const response = res()
    await handler(req('competition-team-approve', 'POST', {
      body: { team_id: TEAM_ID },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('moderate_competition_team', {
      p_actor_id: USER_ID,
      p_team_id: TEAM_ID,
      p_status: 'approved',
      p_name: null,
    })
  })

  it('updates competition configuration through one locked RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: { id: COMPETITION_ID, name: 'Locked Config' },
      error: null,
    })

    const response = res()
    await handler(req('competitions', 'PATCH', {
      query: { id: COMPETITION_ID },
      body: { name: 'Locked Config', price_per_player: 4500 },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('update_competition_config', {
      p_actor_id: USER_ID,
      p_competition_id: COMPETITION_ID,
      p_changes: { name: 'Locked Config', price_per_player: 4500 },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('nulls bank instructions when payment details are not visible', async () => {
    const hidden = {
      id: 'registration-1',
      competition: {
        id: COMPETITION_ID,
        payment_info_visible: false,
        bank_account_name: 'Private Account',
        bank_bsb: '123-456',
        bank_account_number: '987654',
      },
    }
    const maybeSingle = vi.fn().mockResolvedValue({ data: hidden, error: null })
    const secondEq = vi.fn(() => ({ maybeSingle }))
    const firstEq = vi.fn(() => ({ eq: secondEq }))
    const select = vi.fn(() => ({ eq: firstEq }))
    from.mockReturnValueOnce({ select })

    const response = res()
    await handler(req('competition-registration', 'GET', {
      query: { competition_id: COMPETITION_ID },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.competition).toMatchObject({
      payment_info_visible: false,
      bank_account_name: null,
      bank_bsb: null,
      bank_account_number: null,
    })
  })

  it('does not expose unexpected competition config failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'sensitive database detail' },
    })

    const response = res()
    await handler(req('competitions', 'PATCH', {
      query: { id: COMPETITION_ID },
      body: { name: 'Locked Config' },
    }), response)

    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual({ error: 'Internal server error' })
    consoleError.mockRestore()
  })
})

describe('atomic competition database boundary', () => {
  it('contains the database uniqueness invariant and service-only workflows', async () => {
    const migration = await readFile(
      new URL('../../supabase/migrations/20260713030000_atomic_competition_team_workflows.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toMatch(/CREATE UNIQUE INDEX team_members_one_accepted_per_competition/i)
    expect(migration).toMatch(/WHERE competition_id IS NOT NULL\s+AND invite_status = 'accepted'/i)
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE\s+ON TABLE public\.team_members\s+FROM authenticated/i)

    const workflowNames = [
      'register_for_competition',
      'cancel_competition_registration',
      'create_competition_team',
      'update_competition_team',
      'disband_competition_team',
      'invite_competition_team_member',
      'respond_competition_team_invite',
      'remove_competition_team_member',
      'moderate_competition_team',
      'record_competition_payment',
      'update_competition_payment',
      'remove_competition_payment',
    ]
    for (const name of workflowNames) {
      expect(migration).toContain(`FUNCTION public.${name}`)
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`, 'i'))
    }
    expect((migration.match(/FOR UPDATE/gi) ?? []).length).toBeGreaterThanOrEqual(20)
  })

  it('contains no direct table writes in the consolidated player mutation handlers', async () => {
    const route = await readFile(new URL('../superadmin/[resource].js', import.meta.url), 'utf8')
    const mutationSection = route.slice(
      route.indexOf('async function handleCompetitionRegistration'),
      route.indexOf('// ── competition team moderation'),
    )
    expect(mutationSection).not.toMatch(/\.insert\s*\(/)
    expect(mutationSection).not.toMatch(/\.update\s*\(/)
    expect(mutationSection).not.toMatch(/\.delete\s*\(/)
  })
})
