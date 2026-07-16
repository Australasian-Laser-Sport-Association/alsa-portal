import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyCommittee = vi.fn()
const verifySuperAdmin = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc },
}))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin,
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./rateLimit.js', () => ({
  enforceRateLimit,
}))

const { default: handler } = await import('../admin/event.js')

const EVENT_ID = '123e4567-e89b-42d3-a456-426614174010'
const COMMITTEE_ID = '123e4567-e89b-42d3-a456-426614174011'
const SUPERADMIN_ID = '123e4567-e89b-42d3-a456-426614174012'

function req(body) {
  return {
    method: 'POST',
    query: { resource: 'event' },
    headers: {},
    body,
  }
}

function getReq(resource, query = {}) {
  return {
    method: 'GET',
    query: { resource, ...query },
    headers: {},
  }
}

function query(result) {
  const builder = {}
  for (const method of ['select', 'eq', 'in', 'order']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return builder
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

describe('admin event resource actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: COMMITTEE_ID }, error: null })
    verifySuperAdmin.mockResolvedValue({ user: { id: SUPERADMIN_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('rejects malformed event ids before touching the database', async () => {
    const response = res()
    await handler(req({ action: 'status', eventId: `${EVENT_ID}),status.eq.open`, status: 'open' }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual({ error: 'A valid eventId is required' })
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('saves events through the locked configuration RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: { id: EVENT_ID, name: 'ZLTAC 2027', year: 2027, status: 'draft' },
      error: null,
    })

    const response = res()
    await handler(req({
      action: 'save',
      payload: {
        name: '  ZLTAC 2027  ',
        year: 2027,
        status: 'draft',
        main_fee: 0,
        team_fee: 0,
        dinner_guest_price: 6500,
        roles: ['superadmin'],
      },
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, event: { id: EVENT_ID, name: 'ZLTAC 2027', year: 2027, status: 'draft' } })
    expect(rpc).toHaveBeenCalledWith('committee_save_zltac_event', {
      p_actor_id: COMMITTEE_ID,
      p_event_id: null,
      p_changes: expect.objectContaining({
        name: 'ZLTAC 2027',
        year: 2027,
        status: 'draft',
        main_fee: 0,
      }),
    })
    expect(rpc.mock.calls[0][1].p_changes).not.toHaveProperty('roles')
    expect(from).not.toHaveBeenCalled()
  })

  it('updates event status through the locked configuration RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { id: EVENT_ID, status: 'open' }, error: null })

    const response = res()
    await handler(req({ action: 'status', eventId: EVENT_ID, status: 'open' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, event: { id: EVENT_ID, status: 'open' } })
    expect(rpc).toHaveBeenCalledWith('committee_save_zltac_event', {
      p_actor_id: COMMITTEE_ID,
      p_event_id: EVENT_ID,
      p_changes: { status: 'open' },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects archived status through generic status and save actions', async () => {
    const statusResponse = res()
    await handler(req({ action: 'status', eventId: EVENT_ID, status: 'archived' }), statusResponse)

    expect(statusResponse.statusCode).toBe(400)
    expect(statusResponse.body.error).toMatch(/dedicated archive action/i)

    const saveResponse = res()
    await handler(req({
      action: 'save',
      payload: { name: 'ZLTAC 2027', year: 2027, status: 'archived' },
    }), saveResponse)

    expect(saveResponse.statusCode).toBe(400)
    expect(saveResponse.body.error).toMatch(/dedicated archive action/i)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    { year: 2027 },
    { actor_id: SUPERADMIN_ID },
    { actorId: SUPERADMIN_ID },
  ])('rejects caller-controlled archive fields: %o', async extra => {
    const response = res()
    await handler(req({ action: 'archive', eventId: EVENT_ID, ...extra }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/only action and eventId/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('archives through one RPC with the verified session actor', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        eventId: EVENT_ID,
        year: 2027,
        status: 'archived',
        historyCreated: true,
      },
      error: null,
    })

    const response = res()
    await handler(req({ action: 'archive', eventId: EVENT_ID }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({ ok: true, eventId: EVENT_ID, status: 'archived' })
    expect(rpc).toHaveBeenCalledWith('archive_zltac_event', {
      event_id: EVENT_ID,
      actor_id: COMMITTEE_ID,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('maps a missing event from the archive RPC to 404', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'missing' } })

    const response = res()
    await handler(req({ action: 'archive', eventId: EVENT_ID }), response)

    expect(response.statusCode).toBe(404)
    expect(response.body).toEqual({ error: 'Event not found.' })
  })

  it('deletes through one RPC with the reverified superadmin actor', async () => {
    rpc.mockResolvedValueOnce({
      data: { deleted: true, eventId: EVENT_ID, year: 2027, deletedCounts: { registrations: 3 } },
      error: null,
    })

    const response = res()
    await handler(req({ action: 'delete', eventId: EVENT_ID }), response)

    expect(response.statusCode).toBe(200)
    expect(verifySuperAdmin).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('delete_zltac_event', {
      event_id: EVENT_ID,
      actor_id: SUPERADMIN_ID,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a caller-supplied delete year before superadmin verification', async () => {
    const response = res()
    await handler(req({ action: 'delete', eventId: EVENT_ID, year: 2026 }), response)

    expect(response.statusCode).toBe(400)
    expect(verifySuperAdmin).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not call the delete RPC when superadmin verification fails', async () => {
    verifySuperAdmin.mockResolvedValueOnce({ user: null, error: 'Forbidden' })

    const response = res()
    await handler(req({ action: 'delete', eventId: EVENT_ID }), response)

    expect(response.statusCode).toBe(401)
    expect(response.body).toEqual({ error: 'Forbidden' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('loads all event rows that controlled deletion will remove', async () => {
    from.mockImplementation(table => {
      if (table === 'zltac_events') return query({ data: { id: EVENT_ID, year: 2027 }, error: null })
      if (table === 'zltac_registrations') return query({ count: 3, error: null })
      if (table === 'teams') return query({ count: 1, error: null })
      if (table === 'legal_acceptances') return query({ count: 2, error: null })
      if (table === 'under_18_approvals') return query({ count: 1, error: null })
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(getReq('event-delete-impact', { eventId: EVENT_ID }), response)

    expect(response.statusCode).toBe(200)
    expect(verifySuperAdmin).toHaveBeenCalledTimes(1)
    expect(response.body).toEqual({
      registrations: 3,
      teams: 1,
      legalAcceptances: 2,
      under18Approvals: 1,
    })
  })

  it('returns portal-wide counts through the committee API', async () => {
    from.mockImplementation(table => {
      if (table === 'profiles') return query({ count: 42, error: null })
      if (table === 'zltac_registrations') return query({ count: 81, error: null })
      if (table === 'zltac_events') return query({ count: 6, error: null })
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(getReq('portal-dashboard'), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ totalUsers: 42, lifetimeRegistrations: 81, archivedEvents: 6 })
  })

  it('returns signed-document evidence without exposing network metadata', async () => {
    from.mockImplementation(table => {
      if (table === 'legal_documents') {
        return query({ data: [{ id: 'doc-1', document_type: 'code_of_conduct', version: 1 }], error: null })
      }
      if (table === 'legal_acceptances') {
        return query({ data: [{ id: 'acceptance-1', event_year: 2027, content_sha256: 'a'.repeat(64) }], error: null })
      }
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(getReq('signed-documents'), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.documents).toHaveLength(1)
    expect(response.body.acceptances).toHaveLength(1)
    expect(JSON.stringify(response.body)).not.toMatch(/ip_address|user_agent/)
  })
})
