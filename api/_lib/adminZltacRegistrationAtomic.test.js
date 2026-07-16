import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc, storage: { from: vi.fn() } },
}))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin: vi.fn(),
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./serverTelemetry.js', () => ({ captureServerException: vi.fn() }))

const { default: handler } = await import('../admin/event.js')

const ACTOR_ID = '123e4567-e89b-42d3-a456-426614174010'
const USER_ID = '123e4567-e89b-42d3-a456-426614174011'
const REGISTRATION_ID = '123e4567-e89b-42d3-a456-426614174012'
const TEAM_ID = '123e4567-e89b-42d3-a456-426614174013'
const DOUBLE_ID = '123e4567-e89b-42d3-a456-426614174014'
const TRIPLE_A_ID = '123e4567-e89b-42d3-a456-426614174015'
const TRIPLE_B_ID = '123e4567-e89b-42d3-a456-426614174016'
const PLACEHOLDER_ID = '123e4567-e89b-42d3-a456-426614174017'

function request(method, body) {
  return {
    method,
    query: { resource: 'registrations' },
    headers: {},
    body,
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('admin ZLTAC registration atomic mutation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: ACTOR_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    rpc.mockResolvedValue({ data: {}, error: null })
  })

  it('routes registration, identity, team, doubles, and triples through one bundle RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        registrationId: REGISTRATION_ID,
        amountOwing: 4200,
        amountPaid: 0,
        balance: 4200,
      },
      error: null,
    })

    const res = response()
    await handler(request('PATCH', {
      registrationId: REGISTRATION_ID,
      side_events: ['doubles', 'triples'],
      state: 'NSW',
      alias: 'Atomic Alias',
      alias_change_reason: 'Corrected by player request',
      team_id: TEAM_ID,
      doubles_partner_id: DOUBLE_ID,
      triples_partner_ids: [TRIPLE_A_ID, TRIPLE_B_ID],
    }), res)

    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_update_zltac_registration_bundle', {
      p_actor_id: ACTOR_ID,
      p_registration_id: REGISTRATION_ID,
      p_bundle: {
        updates: { side_events: ['doubles', 'triples'] },
        state: 'NSW',
        alias: 'Atomic Alias',
        alias_reason: 'Corrected by player request',
        team_id: TEAM_ID,
        doubles_partner_ids: [DOUBLE_ID],
        triples_partner_ids: [TRIPLE_A_ID, TRIPLE_B_ID],
      },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('validates every partner before starting the bundle transaction', async () => {
    const res = response()
    await handler(request('PATCH', {
      registrationId: REGISTRATION_ID,
      admin_note: 'must not apply',
      doubles_partner_id: DOUBLE_ID,
      triples_partner_ids: [TRIPLE_A_ID, 'not-a-uuid'],
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/invalid id/i)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('requires the guarded cancellation action instead of a status-only edit', async () => {
    const res = response()
    await handler(request('PATCH', {
      registrationId: REGISTRATION_ID,
      status: 'cancelled',
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/cancellation action/i)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('maps a lifecycle race from the bundle to a conflict', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'The event roster and billable selections are locked.' },
    })
    const res = response()
    await handler(request('PATCH', {
      registrationId: REGISTRATION_ID,
      side_events: ['doubles'],
    }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatch(/locked/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('deletes a side-event roster through its atomic cleanup RPC', async () => {
    const res = response()
    await handler(request('DELETE', { kind: 'doubles', id: DOUBLE_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('admin_delete_zltac_side_event_roster', {
      p_actor_id: ACTOR_ID,
      p_format: 'doubles',
      p_roster_id: DOUBLE_ID,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('reports payment-recorded registration cancellation as a conflict', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '55000',
        hint: 'PAYMENT_RECORDS_EXIST',
        message: 'A registration with recorded payments cannot be cancelled.',
      },
    })
    const res = response()
    await handler(request('DELETE', { userId: USER_ID, year: 2026 }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      error: 'This registration has recorded payments. Resolve the payment records before cancelling it.',
      code: 'PAYMENT_RECORDS_EXIST',
    })
    expect(rpc).toHaveBeenCalledWith('cancel_zltac_registration', {
      p_user_id: USER_ID,
      p_event_year: 2026,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('creates a placeholder profile, registration, pricing, and rosters in one RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        profile: { id: USER_ID, alias: 'Atomic' },
        registration: { id: REGISTRATION_ID, payment_reference: '2026ATOMIC', amount_owing: 4200 },
        amountOwing: 4200,
      },
      error: null,
    })
    const res = response()
    await handler(request('POST', {
      action: 'create-placeholder-registration',
      event_year: 2026,
      first_name: 'Alex',
      alias: 'Atomic',
      dob: '2000-01-01',
      doubles_partner_id: DOUBLE_ID,
    }), res)

    expect(res.statusCode).toBe(201)
    expect(rpc).toHaveBeenCalledWith(
      'admin_create_placeholder_zltac_registration',
      expect.objectContaining({
        p_actor_id: ACTOR_ID,
        p_event_year: 2026,
        p_alias: 'Atomic',
        p_dob: '2000-01-01',
        p_doubles_partner_id: DOUBLE_ID,
      }),
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('passes the verified committee actor to the explicit admin merge mode', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null })
    const res = response()

    await handler(request('POST', {
      action: 'link-placeholder',
      placeholder_id: PLACEHOLDER_ID,
      real_user_id: USER_ID,
    }), res)

    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('merge_placeholder_profile', {
      p_actor_id: ACTOR_ID,
      p_placeholder_id: PLACEHOLDER_ID,
      p_real_id: USER_ID,
      p_mode: 'admin',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('excludes suspended and permanently revoked profiles from merge candidates', async () => {
    const builder = {}
    for (const method of ['eq', 'is', 'or']) builder[method] = vi.fn(() => builder)
    builder.limit = vi.fn(async () => ({ data: [], error: null }))
    const select = vi.fn(() => builder)
    from.mockReturnValue({ select })
    const res = response()

    await handler({
      ...request('GET'),
      query: { resource: 'profile-search', q: 'active' },
    }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual([])
    expect(select).toHaveBeenCalledWith('id, first_name, last_name, alias, state, is_placeholder')
    expect(builder.eq).toHaveBeenCalledWith('is_placeholder', false)
    expect(builder.eq).toHaveBeenCalledWith('suspended', false)
    expect(builder.is).toHaveBeenCalledWith('access_revoked_at', null)
  })

  it('rejects malformed placeholder links before the service RPC', async () => {
    const res = response()

    await handler(request('POST', {
      action: 'link-placeholder',
      placeholder_id: 'not-a-uuid',
      real_user_id: USER_ID,
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/valid UUIDs/i)
    expect(rpc).not.toHaveBeenCalled()
  })
})
