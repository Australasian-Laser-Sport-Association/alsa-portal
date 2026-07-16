import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()
const sendServerError = vi.fn((res) => res.status(500).json({ error: 'Internal server error' }))

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError: vi.fn(() => 401),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./apiErrors.js', () => ({ sendServerError }))

const { default: handler } = await import('../volunteer-signup.js')

const USER_ID = '63000000-0000-4000-8000-000000000002'
const REGISTRATION_ID = '63000000-0000-4000-8000-000000000020'
const ROLE_ID = '63000000-0000-4000-8000-000000000030'

function request(method, { body = {}, query = {} } = {}) {
  return {
    method,
    query: { registration_id: REGISTRATION_ID, ...query },
    headers: { authorization: 'Bearer test' },
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

function queryResult(result) {
  const query = {}
  for (const method of ['select', 'eq', 'maybeSingle']) {
    query[method] = vi.fn(() => query)
  }
  query.maybeSingle = vi.fn(() => Promise.resolve(result))
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return query
}

describe('atomic player volunteer signup route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    from.mockImplementation((table) => {
      if (table === 'zltac_registrations') {
        return queryResult({ data: { id: REGISTRATION_ID, user_id: USER_ID }, error: null })
      }
      throw new Error(`Unexpected table access: ${table}`)
    })
  })

  it('sends the whole PUT through one service-only RPC without a base event read', async () => {
    const payload = {
      signup: {
        id: '63000000-0000-4000-8000-000000000040',
        notes: 'Can help',
        roles: [{ role_id: ROLE_ID, status: 'pending', decided_at: null }],
      },
    }
    rpc.mockResolvedValueOnce({ data: payload, error: null })
    const res = response()

    await handler(request('PUT', { body: { role_ids: [ROLE_ID], notes: 'Can help' } }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(payload)
    expect(rpc).toHaveBeenCalledWith('mutate_own_volunteer_signup', {
      p_actor_id: USER_ID,
      p_registration_id: REGISTRATION_ID,
      p_action: 'upsert',
      p_role_ids: [ROLE_ID],
      p_notes: 'Can help',
    })
    expect(from.mock.calls.map(([table]) => table)).toEqual(['zltac_registrations'])
  })

  it('sends DELETE through the same atomic RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null })
    const res = response()

    await handler(request('DELETE'), res)

    expect(res.body).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('mutate_own_volunteer_signup', {
      p_actor_id: USER_ID,
      p_registration_id: REGISTRATION_ID,
      p_action: 'delete',
      p_role_ids: null,
      p_notes: null,
    })
  })

  it('preserves the safe approved-evidence response without leaking database detail', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '55000',
        hint: 'VOLUNTEER_APPROVED',
        message: 'private volunteer constraint and host detail',
      },
    })
    const res = response()

    await handler(request('DELETE'), res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({
      error: 'Contact committee to withdraw because you have an approved role.',
    })
    expect(JSON.stringify(res.body)).not.toContain('private volunteer')
  })

  it('rejects malformed role identifiers before the RPC', async () => {
    const res = response()

    await handler(request('PUT', { body: { role_ids: ['not-a-uuid'] } }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'role_ids contains an invalid id' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('contains no authenticated browser client or split event/child mutation path', async () => {
    const source = await readFile(new URL('../volunteer-signup.js', import.meta.url), 'utf8')

    expect(source).not.toContain('createClient')
    expect(source).not.toContain('eventPhase(')
    expect(source).not.toMatch(/from\(['"]zltac_events['"]\)/)
    expect(source).not.toMatch(/from\(['"]volunteer_signup_roles['"]\)\s*\.(insert|delete|update|upsert)/)
    expect(source).toContain("rpc('mutate_own_volunteer_signup'")
  })
})
