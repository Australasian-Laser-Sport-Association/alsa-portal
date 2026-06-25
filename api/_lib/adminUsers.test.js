import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const verifyCommittee = vi.fn()
const verifySuperAdmin = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from },
}))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin,
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./suspension.js', () => ({
  PERMANENT_BAN: '876000h',
  setUserSuspension: vi.fn(),
}))

vi.mock('./profileChanges.js', () => ({
  changeProfileAlias: vi.fn(),
}))

const { default: handler } = await import('../admin/users.js')

function queryResult(result) {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    contains: vi.fn(() => query),
    overlaps: vi.fn(() => query),
    or: vi.fn(() => query),
    not: vi.fn(() => query),
    then(resolve) {
      return Promise.resolve(result).then(resolve)
    },
  }
  return query
}

function req(query = {}) {
  return { method: 'GET', query, headers: {} }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('admin users list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ error: null })
    verifySuperAdmin.mockResolvedValue({ user: { id: 'superadmin-1' }, error: null })
  })

  it('returns one paginated page and enriches only those users', async () => {
    const profilesQuery = queryResult({
      data: [
        { id: 'user-1', roles: ['player'], created_at: '2026-01-02' },
        { id: 'user-2', roles: ['player'], created_at: '2026-01-01' },
      ],
      error: null,
      count: 125,
    })
    const regsQuery = queryResult({ data: [{ user_id: 'user-1', year: 2026 }], error: null })
    const teamsQuery = queryResult({ data: [{ id: 'team-1', name: 'Alpha', captain_id: 'user-2' }], error: null })
    from
      .mockReturnValueOnce(profilesQuery)
      .mockReturnValueOnce(regsQuery)
      .mockReturnValueOnce(teamsQuery)

    const response = res()
    await handler(req({ page: '2', pageSize: '25' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.total).toBe(125)
    expect(response.body.page).toBe(2)
    expect(response.body.pageSize).toBe(25)
    expect(profilesQuery.range).toHaveBeenCalledWith(25, 49)
    expect(regsQuery.in).toHaveBeenCalledWith('user_id', ['user-1', 'user-2'])
    expect(teamsQuery.in).toHaveBeenCalledWith('captain_id', ['user-1', 'user-2'])
  })

  it('cleans search text before building the PostgREST or filter', async () => {
    const profilesQuery = queryResult({ data: [], error: null, count: 0 })
    from.mockReturnValueOnce(profilesQuery)

    const response = res()
    await handler(req({ search: 'adam),roles.cs.{superadmin}' }), response)

    expect(response.statusCode).toBe(200)
    const filter = profilesQuery.or.mock.calls[0][0]
    expect(filter).not.toContain(')')
    expect(filter).not.toContain('{')
    expect(filter).not.toContain('}')
  })

  it('short-circuits captain filter when no captains exist', async () => {
    const captainQuery = queryResult({ data: [], error: null })
    from.mockReturnValueOnce(captainQuery)

    const response = res()
    await handler(req({ role: 'captain' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.profiles).toEqual([])
    expect(response.body.total).toBe(0)
    expect(from).toHaveBeenCalledTimes(1)
  })
})
