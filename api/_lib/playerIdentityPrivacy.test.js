import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROFILE_HANDLE_PURPOSES,
  verifyOpaqueProfileHandle,
} from './opaqueProfileHandle.js'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(() => 401),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./eventPhase.js', () => ({
  requireOpenPhase: vi.fn(async () => ({ ok: true, phase: 'open' })),
}))

const { default: handler } = await import('../player.js')

const USER_ID = '71111111-1111-4111-8111-111111111111'
const PARTNER_ID = '72222222-2222-4222-8222-222222222222'
const SECRET = 'test-only-player-privacy-secret'

function request(resource, body, query = {}) {
  return {
    method: body ? 'POST' : 'GET',
    query: { resource, ...query },
    headers: { authorization: 'Bearer test-token' },
    body,
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

function chain(result, terminal) {
  const query = {}
  for (const method of ['select', 'eq', 'neq', 'contains', 'in', 'ilike', 'limit']) {
    query[method] = vi.fn(() => method === terminal ? Promise.resolve(result) : query)
  }
  query.maybeSingle = vi.fn(async () => result)
  return query
}

describe('player identity and payment privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, roles: ['player'], error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('returns alias-only, actor/year-bound partner handles for eligible active registrations', async () => {
    const profileQuery = chain({
      data: [{
        id: PARTNER_ID,
        alias: 'LaserFox',
        first_name: 'Never',
        last_name: 'Expose',
      }],
      error: null,
    }, 'limit')
    const registrationQuery = chain({ data: [{ user_id: PARTNER_ID }], error: null }, 'limit')
    const rosterQuery = chain({ data: [], error: null }, 'eq')

    from.mockImplementation(table => {
      if (table === 'profiles') return profileQuery
      if (table === 'zltac_registrations') return registrationQuery
      if (table === 'doubles_pairs') return rosterQuery
      throw new Error(`unexpected table: ${table}`)
    })

    const res = response()
    await handler(request('doubles', {
      action: 'search', eventYear: 2027, term: 'Laser',
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.results).toHaveLength(1)
    expect(Object.keys(res.body.results[0]).sort()).toEqual(['alias', 'handle'])
    expect(JSON.stringify(res.body)).not.toContain(PARTNER_ID)
    expect(JSON.stringify(res.body)).not.toContain('Never')
    expect(JSON.stringify(res.body)).not.toContain('Expose')
    expect(verifyOpaqueProfileHandle({
      handle: res.body.results[0].handle,
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER,
      actorId: USER_ID,
      scope: 'event-year:2027',
      secret: SECRET,
    }).profileId).toBe(PARTNER_ID)
    expect(profileQuery.in).toHaveBeenCalledWith('id', [PARTNER_ID])
    expect(profileQuery.ilike).toHaveBeenCalledWith('alias', '%Laser%')
    expect(registrationQuery.eq).toHaveBeenCalledWith('year', 2027)
    expect(registrationQuery.neq).toHaveBeenCalledWith('status', 'cancelled')
    expect(registrationQuery.neq).toHaveBeenCalledWith('user_id', USER_ID)
    expect(registrationQuery.contains).toHaveBeenCalledWith('side_events', ['doubles'])
    expect(registrationQuery.limit).toHaveBeenCalledWith(1000)
  })

  it('never echoes admin-only registration fields from a player mutation RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        registration: {
          id: '73333333-3333-4333-8333-333333333333',
          user_id: USER_ID,
          year: 2027,
          status: 'pending',
          amount_owing: 1000,
          admin_note: 'private committee note',
          admin_override_coc: true,
          admin_override_coc_set_by: PARTNER_ID,
          admin_override_coc_reason: 'private reason',
        },
        amountOwing: 1000,
      },
      error: null,
    })

    const res = response()
    await handler(request('registration', {
      action: 'confirm-extras', year: 2027, dinner_guests: 0,
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.registration).toMatchObject({
      user_id: USER_ID, year: 2027, status: 'pending', amount_owing: 1000,
    })
    expect(JSON.stringify(res.body)).not.toContain('admin_note')
    expect(JSON.stringify(res.body)).not.toContain('admin_override')
    expect(JSON.stringify(res.body)).not.toContain('private')
    expect(JSON.stringify(res.body)).not.toContain(PARTNER_ID)
  })

  it('returns bank instructions only for the authenticated owner while the payment gate is open', async () => {
    const registrationQuery = chain({ data: { id: 'reg', status: 'confirmed' }, error: null }, 'never')
    const eventQuery = chain({
      data: {
        status: 'open',
        reg_close_date: '2020-01-01T00:00:00.000Z',
        payments_override: null,
        bank_bsb: '123-456',
        bank_account_number: '12345678',
        bank_account_name: 'ALSA',
      },
      error: null,
    }, 'never')
    from.mockImplementation(table => (
      table === 'zltac_registrations' ? registrationQuery : eventQuery
    ))

    const res = response()
    await handler(request('payment-instructions', null, { year: '2027' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.payment_instructions).toEqual({
      available: true,
      reason: 'auto_open',
      opens_at: null,
      bank: {
        bsb: '123-456', account_number: '12345678', account_name: 'ALSA',
      },
    })
    expect(registrationQuery.eq).toHaveBeenCalledWith('user_id', USER_ID)
    expect(registrationQuery.eq).toHaveBeenCalledWith('year', 2027)

    eventQuery.maybeSingle.mockResolvedValueOnce({
      data: {
        status: 'open',
        reg_close_date: '2999-01-01T00:00:00.000Z',
        payments_override: null,
        bank_bsb: 'must-not-leak',
        bank_account_number: 'must-not-leak',
        bank_account_name: 'must-not-leak',
      },
      error: null,
    })
    const closed = response()
    await handler(request('payment-instructions', null, { year: '2027' }), closed)
    expect(closed.body.payment_instructions.available).toBe(false)
    expect(closed.body.payment_instructions.bank).toBeNull()
    expect(JSON.stringify(closed.body)).not.toContain('must-not-leak')
  })
})
