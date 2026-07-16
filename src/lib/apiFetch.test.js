import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
const refreshSession = vi.fn()
const signOut = vi.fn()

vi.mock('./supabase.js', () => ({
  supabase: { auth: { getSession, refreshSession, signOut } },
}))

const { apiFetch } = await import('./apiFetch.js')

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 500 ? 'Internal Server Error' : 'Forbidden',
    json: vi.fn(async () => body),
  }
}

describe('apiFetch authentication failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({
      data: { session: { access_token: 'current-token' } },
    })
    refreshSession.mockResolvedValue({ data: { session: null } })
    signOut.mockResolvedValue({ error: null })
  })

  it.each([403, 500])('does not refresh or sign out for HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response(status, { error: `failure-${status}` })))

    await expect(apiFetch('/api/example')).rejects.toThrow(`failure-${status}`)
    expect(refreshSession).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('retries one genuine 401 with a refreshed token', async () => {
    refreshSession.mockResolvedValue({
      data: { session: { access_token: 'refreshed-token' } },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401, { error: 'expired' }))
      .mockResolvedValueOnce(response(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/api/example')).resolves.toEqual({ ok: true })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-token')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('signs out locally only after an unrecoverable 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(401, { error: 'expired' })))

    await expect(apiFetch('/api/example')).rejects.toThrow('Your session expired. Please sign in again.')
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
