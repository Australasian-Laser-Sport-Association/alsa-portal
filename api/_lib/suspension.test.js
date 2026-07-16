import { describe, expect, it, vi } from 'vitest'
import {
  PERMANENT_BAN,
  authBanDurationForState,
  setUserSuspension,
} from './suspension.js'

function client({
  authError = null,
  profileError = null,
  rollbackAuthError = null,
  authReadData = { user: { banned_until: null } },
  authReadError = null,
  authReadResults,
  reconciliationData = { suspended: false },
  reconciliationError = null,
} = {}) {
  const updateUserById = vi.fn()
    .mockResolvedValueOnce({ error: authError })
    .mockResolvedValue({ error: rollbackAuthError })
  const defaultAuthRead = {
    data: authReadData,
    error: authReadError,
  }
  const getUserById = vi.fn()
  for (const result of authReadResults ?? []) {
    getUserById.mockResolvedValueOnce(result)
  }
  getUserById.mockResolvedValue(defaultAuthRead)
  const eq = vi.fn().mockResolvedValue({ error: profileError })
  const update = vi.fn(() => ({ eq }))
  const maybeSingle = vi.fn().mockResolvedValue({
    data: reconciliationData,
    error: reconciliationError,
  })
  const readEq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq: readEq }))
  const rpc = vi.fn().mockResolvedValue({ error: profileError })
  return {
    supabase: {
      auth: { admin: { updateUserById, getUserById } },
      from: vi.fn(() => ({ update, select })),
      rpc,
    },
    updateUserById,
    getUserById,
    rpc,
    maybeSingle,
  }
}

describe('setUserSuspension', () => {
  it('rejects a revoked target before reading or changing Auth', async () => {
    const { supabase, updateUserById, getUserById, rpc } = client()

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: false,
      previousSuspended: true,
      isPlaceholder: false,
      accessRevokedAt: '2026-07-14T00:00:00.000Z',
    })

    expect(result).toMatchObject({
      error: 'Account access has been permanently revoked.',
      accessRevoked: true,
    })
    expect(getUserById).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

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

  it('continues when an Auth update committed before its response was lost', async () => {
    const authError = new Error('auth response lost')
    const { supabase, getUserById, rpc } = client({
      authError,
      authReadResults: [
        { data: { user: { banned_until: null } }, error: null },
        { data: { user: { banned_until: '2126-01-01T00:00:00.000Z' } }, error: null },
      ],
    })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      actorId: 'admin-1',
    })

    expect(result.error).toBeNull()
    expect(getUserById).toHaveBeenCalledTimes(2)
    expect(getUserById).toHaveBeenCalledWith('user-1')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('requires reconciliation when an ambiguous Auth update cannot be read back', async () => {
    const authError = new Error('auth response lost')
    const authReadError = new Error('auth read unavailable')
    const { supabase, rpc } = client({
      authError,
      authReadResults: [
        { data: { user: { banned_until: null } }, error: null },
        { data: null, error: authReadError },
      ],
    })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      actorId: 'admin-1',
    })

    expect(rpc).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      reconciliationRequired: true,
      authError,
      authReconciliationError: authReadError,
    })
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

  it('restores the actual finite Auth ban when the profile incorrectly said unbanned', async () => {
    const now = Date.parse('2026-07-14T00:00:00.000Z')
    const bannedUntil = new Date(now + 120_000).toISOString()
    const { supabase, updateUserById } = client({
      profileError: { message: 'profile failed' },
      authReadData: { user: { banned_until: bannedUntil } },
      reconciliationData: { suspended: false },
    })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      now: () => now,
    })

    expect(result.error).toBe('profile failed')
    expect(updateUserById).toHaveBeenNthCalledWith(1, 'user-1', {
      ban_duration: PERMANENT_BAN,
    })
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', {
      ban_duration: '120s',
    })
  })

  it('restores the actual unbanned Auth state when the profile incorrectly said banned', async () => {
    const { supabase, updateUserById } = client({
      profileError: { message: 'profile failed' },
      authReadData: { user: { banned_until: null } },
      reconciliationData: { suspended: true },
    })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: false,
      previousSuspended: true,
      isPlaceholder: false,
    })

    expect(result.error).toBe('profile failed')
    expect(updateUserById).toHaveBeenNthCalledWith(1, 'user-1', {
      ban_duration: 'none',
    })
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', {
      ban_duration: 'none',
    })
  })

  it('fails closed before mutation when the previous Auth state cannot be read', async () => {
    const authReadError = new Error('auth unavailable')
    const { supabase, updateUserById, rpc } = client({ authReadError })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      actorId: 'admin-1',
    })

    expect(result).toMatchObject({
      reconciliationRequired: true,
      authPreflightError: authReadError,
    })
    expect(updateUserById).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('propagates lock-safety failures instead of treating them as ordinary Auth errors', async () => {
    const safetyError = Object.assign(new Error('lease lost'), {
      code: 'ACCOUNT_ACCESS_LOCK_LOST',
    })
    const { supabase } = client()
    const runOperation = vi.fn().mockRejectedValue(safetyError)

    await expect(setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      runOperation,
    })).rejects.toBe(safetyError)
  })

  it('does not roll Auth back when the RPC committed before its response was lost', async () => {
    const profileError = { message: 'network response lost' }
    const { supabase, updateUserById, maybeSingle } = client({
      profileError,
      reconciliationData: { suspended: true },
    })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      actorId: 'admin-1',
    })

    expect(maybeSingle).toHaveBeenCalledTimes(1)
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ error: null, reconciled: true, profileError })
  })

  it('requires reconciliation when the post-error profile state cannot be read', async () => {
    const profileError = { message: 'profile response lost' }
    const reconciliationError = new Error('read unavailable')
    const { supabase, updateUserById } = client({
      profileError,
      reconciliationData: null,
      reconciliationError,
    })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      actorId: 'admin-1',
    })

    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      reconciliationRequired: true,
      profileError,
      reconciliationError,
    })
    expect(result.error).toMatch(/could not be reconciled/i)
  })

  it('reports reconciliation when the profile write and Auth rollback both fail', async () => {
    const profileError = { message: 'profile failed' }
    const rollbackAuthError = { message: 'rollback failed' }
    const { supabase, updateUserById } = client({ profileError, rollbackAuthError })

    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      actorId: 'admin-1',
    })

    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', { ban_duration: 'none' })
    expect(result).toMatchObject({
      reconciliationRequired: true,
      profileError,
      rollbackError: rollbackAuthError,
    })
    expect(result.error).toMatch(/could not be restored/i)
  })

  it('attributes production profile changes through the governance RPC', async () => {
    const { supabase, rpc } = client()
    const result = await setUserSuspension({
      supabase,
      userId: 'user-1',
      suspended: true,
      previousSuspended: false,
      isPlaceholder: false,
      actorId: 'admin-1',
    })

    expect(result.error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('admin_mutate_profile_access', {
      p_actor_id: 'admin-1',
      p_target_id: 'user-1',
      p_action: 'suspension',
      p_payload: { suspended: true },
    })
  })
})

describe('authBanDurationForState', () => {
  it('converts the captured expiry to the exact remaining whole-second duration', () => {
    const now = Date.parse('2026-07-14T00:00:00.250Z')
    const bannedUntil = new Date(now + 1_250).toISOString()

    expect(authBanDurationForState({
      exists: true,
      suspended: true,
      bannedUntil,
    }, now)).toBe('2s')
  })
})
