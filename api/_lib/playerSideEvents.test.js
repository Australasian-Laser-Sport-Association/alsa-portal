import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_HANDLE_PURPOSES, issueOpaqueProfileHandle } from './opaqueProfileHandle.js'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(error => (error === 'Unauthorized' ? 401 : error === 'Account suspended' ? 403 : 500)),
  getActiveEventYear: vi.fn(),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./eventPhase.js', () => ({
  requireOpenPhase: vi.fn(() => Promise.resolve({ ok: true, phase: 'open' })),
}))
vi.mock('./computeAmountOwing.js', () => ({ computeAndWriteAmountOwing: vi.fn() }))
vi.mock('./sideEventCleanup.js', () => ({ cleanupFormerSideEventMembers: vi.fn() }))

const { default: handler } = await import('../player.js')

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PARTNER_ID = '22222222-2222-4222-8222-222222222222'
const ROSTER_ID = '33333333-3333-4333-8333-333333333333'
const SECRET = 'test-only-side-event-handle-secret'

function partnerHandle(purpose, profileId = PARTNER_ID, year = 2027) {
  return issueOpaqueProfileHandle({
    profileId,
    actorId: USER_ID,
    purpose,
    scope: `event-year:${year}`,
    secret: SECRET,
  })
}

function req(resource, body) {
  return {
    method: 'POST',
    query: { resource },
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

describe('atomic player side-event API boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    rpc.mockResolvedValue({ data: { id: ROSTER_ID }, error: null })
  })

  it('creates doubles only through the authenticated-user RPC contract', async () => {
    const response = res()
    await handler(req('doubles', {
      action: 'create',
      eventYear: 2027,
      partnerHandle: partnerHandle(PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER),
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ record: { id: ROSTER_ID } })
    expect(rpc).toHaveBeenCalledWith('mutate_zltac_doubles_roster', {
      p_user_id: USER_ID,
      p_action: 'create',
      p_event_year: 2027,
      p_roster_id: null,
      p_partner_id: PARTNER_ID,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it.each([
    ['confirm', false],
    ['delete', true],
  ])('routes doubles %s through the same atomic RPC', async (action, deleted) => {
    const response = res()
    await handler(req('doubles', { action, id: ROSTER_ID }), response)

    expect(response.body).toEqual(deleted ? { ok: true } : { record: { id: ROSTER_ID } })
    expect(rpc).toHaveBeenCalledWith('mutate_zltac_doubles_roster', {
      p_user_id: USER_ID,
      p_action: action,
      p_event_year: null,
      p_roster_id: ROSTER_ID,
      p_partner_id: null,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('creates a triples roster with a constrained slot', async () => {
    const response = res()
    await handler(req('triples', {
      action: 'create',
      eventYear: 2027,
      slot: 3,
      partnerHandle: partnerHandle(PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER),
    }), response)

    expect(response.body).toEqual({ record: { id: ROSTER_ID } })
    expect(rpc).toHaveBeenCalledWith('mutate_zltac_triples_roster', {
      p_user_id: USER_ID,
      p_action: 'create',
      p_event_year: 2027,
      p_roster_id: null,
      p_slot: 3,
      p_partner_id: PARTNER_ID,
    })
  })

  it.each([
    [
      { action: 'add-slot', id: ROSTER_ID, eventYear: 2027, slot: 2, partnerHandle: partnerHandle(PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER) },
      { p_action: 'add-slot', p_event_year: 2027, p_slot: 2, p_partner_id: PARTNER_ID },
      false,
    ],
    [
      { action: 'confirm', id: ROSTER_ID, mySlot: 3 },
      { p_action: 'confirm', p_event_year: null, p_slot: 3, p_partner_id: null },
      false,
    ],
    [
      { action: 'clear-slot', id: ROSTER_ID, slot: 2 },
      { p_action: 'clear-slot', p_event_year: null, p_slot: 2, p_partner_id: null },
      false,
    ],
    [
      { action: 'disband', id: ROSTER_ID },
      { p_action: 'disband', p_event_year: null, p_slot: null, p_partner_id: null },
      true,
    ],
  ])('routes triples $body.action atomically', async (body, expected, deleted) => {
    const response = res()
    await handler(req('triples', body), response)

    expect(response.body).toEqual(deleted ? { ok: true } : { record: { id: ROSTER_ID } })
    expect(rpc).toHaveBeenCalledWith('mutate_zltac_triples_roster', {
      p_user_id: USER_ID,
      p_roster_id: ROSTER_ID,
      ...expected,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects forged slots and unsupported mutation fields before the RPC', async () => {
    const invalidSlot = res()
    await handler(req('triples', {
      action: 'create',
      eventYear: 2027,
      slot: 9,
      partnerHandle: partnerHandle(PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER),
    }), invalidSlot)
    expect(invalidSlot.statusCode).toBe(400)

    const forgedField = res()
    await handler(req('doubles', {
      action: 'confirm',
      id: ROSTER_ID,
      confirmed: true,
    }), forgedField)
    expect(forgedField.statusCode).toBe(400)
    expect(forgedField.body.error).toContain('confirmed')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects self-pairing and malformed roster identifiers', async () => {
    const selfPair = res()
    await handler(req('doubles', {
      action: 'create',
      eventYear: 2027,
      partnerHandle: partnerHandle(PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER, USER_ID),
    }), selfPair)
    expect(selfPair.statusCode).toBe(400)

    const malformed = res()
    await handler(req('triples', {
      action: 'disband',
      id: 'not-a-uuid',
    }), malformed)
    expect(malformed.statusCode).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects raw UUIDs and handles bound to the wrong actor, year, or purpose', async () => {
    for (const body of [
      { action: 'create', eventYear: 2027, partnerId: PARTNER_ID },
      {
        action: 'create',
        eventYear: 2028,
        partnerHandle: partnerHandle(PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER, PARTNER_ID, 2027),
      },
      {
        action: 'create',
        eventYear: 2027,
        partnerHandle: partnerHandle(PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER),
      },
    ]) {
      const response = res()
      await handler(req('doubles', body), response)
      expect(response.statusCode).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['23505', 409, /already assigned/i],
    ['42501', 403, /not allowed/i],
    ['55000', 409, /no longer be changed/i],
    ['P0002', 404, /not found/i],
    ['40001', 409, /try again/i],
  ])('maps database error %s without exposing database details', async (code, status, message) => {
    rpc.mockResolvedValue({
      data: null,
      error: { code, message: 'secret table and SQL details' },
    })
    const response = res()
    await handler(req('doubles', { action: 'confirm', id: ROSTER_ID }), response)

    expect(response.statusCode).toBe(status)
    expect(response.body.error).toMatch(message)
    expect(response.body.error).not.toContain('secret')
  })
})
