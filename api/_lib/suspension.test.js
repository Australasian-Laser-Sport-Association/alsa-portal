import { describe, expect, it, vi } from 'vitest'
import { PERMANENT_BAN, setUserSuspension } from './suspension.js'

function client({ authError = null, profileError = null } = {}) {
  const updateUserById = vi.fn().mockResolvedValue({ error: authError })
  const eq = vi.fn().mockResolvedValue({ error: profileError })
  const update = vi.fn(() => ({ eq }))
  return {
    supabase: {
      auth: { admin: { updateUserById } },
      from: vi.fn(() => ({ update })),
    },
    updateUserById,
  }
}

describe('setUserSuspension', () => {
  it('bans Auth before marking the profile suspended', async () => {
    const { supabase, updateUserById } = client()
    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
    })

    expect(result.error).toBeNull()
    expect(updateUserById).toHaveBeenCalledWith('user-1', { ban_duration: PERMANENT_BAN })
  })

  it('lifts the Auth ban when restoring access', async () => {
    const { supabase, updateUserById } = client()
    await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: false,
      previousSuspended: true,
      isPlaceholder: false,
    })

    expect(updateUserById).toHaveBeenCalledWith('user-1', { ban_duration: 'none' })
  })

  it('restores the previous Auth state when the profile update fails', async () => {
    const { supabase, updateUserById } = client({ profileError: { message: 'profile failed' } })
    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
    })

    expect(result.error).toBe('profile failed')
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', { ban_duration: 'none' })
  })
})

