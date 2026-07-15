import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const verifyCommittee = vi.fn()
const sendServerError = vi.fn((res) => res.status(500).json({ error: 'Internal server error' }))

vi.mock('./supabase.js', () => ({ default: { from } }))
vi.mock('./auth.js', () => ({
  verifyCommittee,
  statusForAuthError: vi.fn((error) => {
    if (error === 'Unauthorized') return 401
    if (error === 'Forbidden' || error === 'Account suspended') return 403
    return 500
  }),
}))
vi.mock('./apiErrors.js', () => ({ sendServerError }))

const { default: handler } = await import('../admin/alsa.js')

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
  for (const method of ['select', 'order', 'insert', 'delete', 'update', 'eq', 'neq', 'lt', 'gt']) {
    query[method] = vi.fn(() => query)
  }
  query.single = vi.fn(() => Promise.resolve(result))
  query.maybeSingle = vi.fn(() => Promise.resolve(result))
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  return query
}

describe('admin ALSA membership security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({
      user: { id: 'committee-1' },
      roles: ['alsa_committee', 'player'],
      error: null,
    })
  })

  it.each([
    ['members', { id: 'membership-1' }],
    ['lifetime-members', { profile_id: 'profile-1' }],
    ['periods', { id: 'period-1' }],
  ])('requires superadmin for destructive %s requests', async (resource, query) => {
    const res = response()

    await handler(request(resource, 'DELETE', { query }), res)

    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })
    expect(from).not.toHaveBeenCalled()
  })

  it('allows a superadmin to remove an unreferenced membership', async () => {
    verifyCommittee.mockResolvedValue({
      user: { id: 'superadmin-1' },
      roles: ['superadmin', 'player'],
      error: null,
    })
    const deletion = queryResult({ data: null, error: null })
    from.mockReturnValueOnce(deletion)
    const res = response()

    await handler(request('members', 'DELETE', { query: { id: 'membership-1' } }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(deletion.eq).toHaveBeenCalledWith('id', 'membership-1')
  })

  it('returns a stable conflict without exposing foreign-key details', async () => {
    verifyCommittee.mockResolvedValue({
      user: { id: 'superadmin-1' },
      roles: ['superadmin', 'player'],
      error: null,
    })
    from.mockReturnValueOnce(queryResult({
      data: null,
      error: { code: '23503', message: 'violates secret_internal_fk on private_table' },
    }))
    const res = response()

    await handler(request('periods', 'DELETE', { query: { id: 'period-1' } }), res)

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('Cannot delete a period that has memberships. Remove the memberships first.')
    expect(res.body.error).not.toContain('secret_internal_fk')
    expect(sendServerError).not.toHaveBeenCalled()
  })

  it('uses the generic error boundary for an unexpected database failure', async () => {
    const databaseError = { message: 'relation private_membership_ledger does not exist' }
    from.mockReturnValueOnce(queryResult({ data: null, error: databaseError }))
    const res = response()

    await handler(request('members'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(sendServerError).toHaveBeenCalledWith(res, databaseError, 'admin-alsa:members-list')
    expect(JSON.stringify(res.body)).not.toContain('private_membership_ledger')
  })

  it('does not expose an internal authorisation failure', async () => {
    verifyCommittee.mockResolvedValue({ user: null, roles: null, error: 'Internal error' })
    const res = response()

    await handler(request('members'), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(sendServerError).toHaveBeenCalledWith(res, expect.any(Error), 'admin-alsa:auth')
  })

  it('contains no direct unexpected-error response that can leak error.message', async () => {
    const source = await readFile(new URL('../admin/alsa.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/status\(500\)\.json\(\{\s*error:\s*\w+\.message/)
  })
})
