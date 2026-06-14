import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const maybeSingle = vi.fn()
const eq = vi.fn(() => ({ maybeSingle }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))

vi.mock('./supabase.js', () => ({
  default: {
    auth: { getUser },
    from,
  },
}))

const { statusForAuthError, verifyCommittee, verifyUser } = await import('./auth.js')

describe('authentication boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a suspended account even when its JWT is still valid', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    maybeSingle.mockResolvedValue({
      data: { roles: ['alsa_committee'], suspended: true },
      error: null,
    })

    const result = await verifyUser({ headers: { authorization: 'Bearer valid-token' } })

    expect(result).toEqual({ user: null, profile: null, roles: null, error: 'Account suspended' })
    expect(statusForAuthError(result.error)).toBe(403)
  })

  it('reuses the active profile when checking committee access', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    maybeSingle.mockResolvedValue({
      data: { roles: ['zltac_committee'], suspended: false },
      error: null,
    })

    const result = await verifyCommittee({ headers: { authorization: 'Bearer valid-token' } })

    expect(result.error).toBeNull()
    expect(result.roles).toEqual(['zltac_committee'])
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('does not treat an advisor designation as committee authority', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    maybeSingle.mockResolvedValue({
      data: { roles: ['advisor'], suspended: false },
      error: null,
    })

    const result = await verifyCommittee({ headers: { authorization: 'Bearer valid-token' } })

    expect(result.error).toBe('Forbidden')
  })
})
