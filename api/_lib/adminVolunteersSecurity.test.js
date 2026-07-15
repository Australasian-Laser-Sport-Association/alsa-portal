import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyCommittee = vi.fn()
const sendServerError = vi.fn((res) => res.status(500).json({ error: 'Internal server error' }))

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyCommittee,
  statusForAuthError: vi.fn((error) => {
    if (error === 'Unauthorized') return 401
    if (error === 'Forbidden' || error === 'Account suspended') return 403
    return 500
  }),
}))
vi.mock('./apiErrors.js', () => ({ sendServerError }))

const { default: handler } = await import('../admin/volunteers.js')

function request(resource, method = 'GET', { query = {}, body = {} } = {}) {
  return {
    method,
    query: { resource, ...query },
    headers: {},
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
  for (const method of ['select', 'order', 'insert', 'delete', 'update', 'upsert', 'eq', 'neq', 'in']) {
    query[method] = vi.fn(() => query)
  }
  query.single = vi.fn(() => Promise.resolve(result))
  query.maybeSingle = vi.fn(() => Promise.resolve(result))
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return query
}

describe('admin volunteer error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: 'committee-1' }, error: null })
  })

  it('uses the generic error response for an unexpected database failure', async () => {
    const databaseError = { message: 'permission denied for private_volunteer_table' }
    from.mockReturnValueOnce(queryResult({ data: null, error: databaseError }))
    const res = response()

    await handler(request('roles'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(sendServerError).toHaveBeenCalledWith(res, databaseError, 'admin-volunteers:roles-list')
    expect(JSON.stringify(res.body)).not.toContain('private_volunteer_table')
  })

  it('fails safely when signup identity enrichment cannot be loaded', async () => {
    const enrichmentError = { message: 'profiles access exposed internal policy detail' }
    from
      .mockReturnValueOnce(queryResult({
        data: [{
          id: 'signup-1',
          notes: null,
          created_at: '2026-07-14T00:00:00.000Z',
          registration_id: 'registration-1',
          zltac_registrations: { user_id: 'user-1', team_id: 'team-1', year: 2026 },
          volunteer_signup_roles: [],
        }],
        error: null,
      }))
      .mockReturnValueOnce(queryResult({ data: null, error: enrichmentError }))
      .mockReturnValueOnce(queryResult({ data: [{ id: 'team-1', name: 'Alpha' }], error: null }))
      .mockReturnValueOnce(queryResult({ data: [{ year: 2026, name: 'ZLTAC 2026' }], error: null }))
    const res = response()

    await handler(request('signups'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(sendServerError).toHaveBeenCalledWith(res, enrichmentError, 'admin-volunteers:signups-list')
    expect(JSON.stringify(res.body)).not.toContain('internal policy detail')
  })

  it('preserves the deliberate duplicate-code conflict response', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate internal volunteer_roles_code_key' },
    })
    const res = response()

    await handler(request('roles', 'POST', {
      body: {
        code: 'MAR',
        name: 'Marshal',
        short_description: 'Supports event operations',
      },
    }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'A role with this code already exists.', field: 'code' })
    expect(JSON.stringify(res.body)).not.toContain('volunteer_roles_code_key')
    expect(sendServerError).not.toHaveBeenCalled()
  })

  it('creates and selects a default role in one actor-bound RPC', async () => {
    const roleId = '63000000-0000-4000-8000-000000000030'
    const role = { id: roleId, code: 'MAR', name: 'Marshal', is_default: true }
    rpc.mockResolvedValueOnce({ data: { role }, error: null })
    const res = response()

    await handler(request('roles', 'POST', {
      body: {
        code: 'MAR',
        name: 'Marshal',
        short_description: 'Supports event operations',
        is_default: true,
        is_active: true,
      },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ role })
    expect(rpc).toHaveBeenCalledWith('admin_upsert_volunteer_role', {
      p_actor_id: 'committee-1',
      p_role_id: null,
      p_changes: {
        code: 'MAR',
        name: 'Marshal',
        short_description: 'Supports event operations',
        target_count: null,
        min_count: null,
        sort_order: 0,
        requires_experience: false,
        experience_notes: null,
        is_default: true,
        is_active: true,
      },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('updates a role through the same atomic configuration RPC', async () => {
    const roleId = '63000000-0000-4000-8000-000000000030'
    rpc.mockResolvedValueOnce({ data: { role: { id: roleId, is_default: true } }, error: null })
    const res = response()

    await handler(request('roles', 'PATCH', {
      query: { id: roleId },
      body: { is_default: true },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('admin_upsert_volunteer_role', {
      p_actor_id: 'committee-1',
      p_role_id: roleId,
      p_changes: { is_default: true },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('preserves the safe role-in-use delete conflict', async () => {
    from
      .mockReturnValueOnce(queryResult({ data: null, error: null, count: 0 }))
      .mockReturnValueOnce(queryResult({
        data: null,
        error: { code: '23503', message: 'violates private signup role foreign key' },
      }))
    const res = response()

    await handler(request('roles', 'DELETE', { query: { id: 'role-1' } }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      error: "This role is now in use and can't be hard-deleted.",
      referenceCount: null,
    })
    expect(JSON.stringify(res.body)).not.toContain('private signup role')
    expect(sendServerError).not.toHaveBeenCalled()
  })

  it('catches an unexpected thrown failure at the route boundary', async () => {
    const thrown = new Error('network response included secret database host')
    from.mockImplementationOnce(() => { throw thrown })
    const res = response()

    await handler(request('roles'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(sendServerError).toHaveBeenCalledWith(res, thrown, 'admin-volunteers')
  })

  it('does not expose an internal authorisation failure', async () => {
    verifyCommittee.mockResolvedValue({ user: null, error: 'Internal error' })
    const res = response()

    await handler(request('roles'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(sendServerError).toHaveBeenCalledWith(res, expect.any(Error), 'admin-volunteers:auth')
  })

  it('contains no direct unexpected-error response that can leak error.message', async () => {
    const source = await readFile(new URL('../admin/volunteers.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/status\(500\)\.json\(\{\s*error:\s*\w+\.message/)
  })

  it('creates a manual signup and its approved roles in one RPC', async () => {
    const signupId = '63000000-0000-4000-8000-000000000040'
    const registrationId = '63000000-0000-4000-8000-000000000020'
    const roleId = '63000000-0000-4000-8000-000000000030'
    rpc.mockResolvedValueOnce({ data: { created: true, signup_id: signupId }, error: null })
    from.mockReturnValueOnce(queryResult({
      data: [{
        id: signupId,
        notes: 'Manual',
        created_at: '2026-07-14T00:00:00.000Z',
        zltac_registrations: { user_id: null, team_id: null, year: null },
        volunteer_signup_roles: [],
      }],
      error: null,
    }))
    const res = response()

    await handler(request('signups', 'POST', {
      body: { registration_id: registrationId, role_ids: [roleId], notes: 'Manual' },
    }), res)

    expect(res.statusCode).toBe(201)
    expect(rpc).toHaveBeenCalledWith('admin_create_volunteer_signup', {
      p_actor_id: 'committee-1',
      p_registration_id: registrationId,
      p_role_ids: [roleId],
      p_notes: 'Manual',
    })
    expect(from.mock.calls.map(([table]) => table)).toEqual(['volunteer_signups'])
  })

  it('applies a decision batch in one RPC rather than per-row writes', async () => {
    const signupId = '63000000-0000-4000-8000-000000000040'
    const roleA = '63000000-0000-4000-8000-000000000030'
    const roleB = '63000000-0000-4000-8000-000000000031'
    const decisions = [
      { role_id: roleA, status: 'approved' },
      { role_id: roleB, status: 'declined' },
    ]
    rpc.mockResolvedValueOnce({ data: { signup_id: signupId }, error: null })
    from.mockReturnValueOnce(queryResult({
      data: [{
        id: signupId,
        notes: null,
        created_at: '2026-07-14T00:00:00.000Z',
        zltac_registrations: { user_id: null, team_id: null, year: null },
        volunteer_signup_roles: [],
      }],
      error: null,
    }))
    const res = response()

    await handler(request('signups', 'PATCH', {
      query: { signup_id: signupId },
      body: { role_decisions: decisions },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('admin_set_volunteer_role_decisions', {
      p_actor_id: 'committee-1',
      p_signup_id: signupId,
      p_decisions: decisions,
    })
    expect(from.mock.calls.map(([table]) => table)).toEqual(['volunteer_signups'])
  })
})
