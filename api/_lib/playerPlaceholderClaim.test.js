import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(() => 401),
  getActiveEventYear: vi.fn(),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./eventPhase.js', () => ({
  requireOpenPhase: vi.fn(),
  getEventPhase: vi.fn(),
}))
vi.mock('./sideEventCleanup.js', () => ({
  cleanupFormerSideEventMember: vi.fn(),
  cleanupFormerSideEventMembers: vi.fn(),
  ensureSideEventMember: vi.fn(),
}))
vi.mock('./placeholders.js', () => ({ anyPlaceholder: vi.fn() }))

const { default: handler } = await import('../player.js')

const USER_ID = '71010000-0000-4000-8000-000000000001'
const PLACEHOLDER_ID = '71010000-0000-4000-8000-000000000002'

function query(result) {
  const builder = {}
  for (const method of ['select', 'eq', 'in', 'order']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => result)
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return builder
}

function request(method = 'POST', resource = 'claim') {
  return {
    method,
    query: { resource },
    headers: { authorization: 'Bearer test-token' },
    body: method === 'POST' ? { placeholder_id: PLACEHOLDER_ID } : undefined,
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('player placeholder ownership boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({
      user: {
        id: USER_ID,
        email: 'committee@example.test',
        email_confirmed_at: '2026-07-14T00:00:00.000Z',
        user_metadata: { alias: 'UnrelatedPlayer' },
      },
      roles: ['alsa_committee', 'player'],
      error: null,
    })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('does not treat a matching alias or committee role as ownership proof', async () => {
    const placeholder = query({
      data: {
        placeholder_email: 'other@example.test',
        is_placeholder: true,
      },
      error: null,
    })
    from.mockReturnValueOnce(placeholder)

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'This registration cannot be claimed by this account.' })
    expect(placeholder.select).toHaveBeenCalledWith('placeholder_email, is_placeholder')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('allows a confirmed-email match to use the service-only merge RPC', async () => {
    from.mockReturnValueOnce(query({
      data: {
        placeholder_email: ' Committee@Example.Test ',
        is_placeholder: true,
      },
      error: null,
    }))
    rpc.mockResolvedValue({ data: { ok: true }, error: null })

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('merge_placeholder_profile', {
      p_actor_id: USER_ID,
      p_placeholder_id: PLACEHOLDER_ID,
      p_real_id: USER_ID,
      p_mode: 'self',
    })
  })

  it('rejects an unconfirmed account before reading any placeholder', async () => {
    verifyUser.mockResolvedValue({
      user: { id: USER_ID, email: 'committee@example.test', email_confirmed_at: null },
      roles: ['player'],
      error: null,
    })

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      error: 'A verified account email is required to claim a registration.',
    })
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lists only confirmed-email matches and returns no legal name, email, or payment reference', async () => {
    const placeholders = query({
      data: [
        {
          id: PLACEHOLDER_ID,
          alias: 'ClaimMe',
          first_name: 'Private',
          last_name: 'Person',
          placeholder_email: 'COMMITTEE@example.test',
        },
        {
          id: '71010000-0000-4000-8000-000000000003',
          alias: 'CommitteeAlias',
          placeholder_email: 'other@example.test',
        },
      ],
      error: null,
    })
    const registrations = query({
      data: [{
        user_id: PLACEHOLDER_ID,
        year: 2027,
        side_events: ['doubles'],
        payment_reference: 'PRIVATE-REF',
      }],
      error: null,
    })
    from.mockReturnValueOnce(placeholders).mockReturnValueOnce(registrations)

    const res = response()
    await handler(request('GET', 'claimable'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      matches: [{
        placeholder: { id: PLACEHOLDER_ID, alias: 'ClaimMe' },
        registrations: [{ year: 2027, side_events: ['doubles'] }],
      }],
    })
    expect(placeholders.select).toHaveBeenCalledWith('id, alias, placeholder_email')
    expect(registrations.select).toHaveBeenCalledWith('user_id, year, side_events')
    expect(JSON.stringify(res.body)).not.toContain('committee@example.test')
    expect(JSON.stringify(res.body)).not.toContain('Private')
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE-REF')
  })

  it('returns no claimable records for an unconfirmed account', async () => {
    verifyUser.mockResolvedValue({
      user: { id: USER_ID, email: 'committee@example.test', email_confirmed_at: null },
      roles: ['player'],
      error: null,
    })

    const res = response()
    await handler(request('GET', 'claimable'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ matches: [] })
    expect(from).not.toHaveBeenCalled()
  })
})
