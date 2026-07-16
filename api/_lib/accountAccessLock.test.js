import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_ACCESS_LOCK_NAMESPACE,
  ACCOUNT_ACCESS_LOCK_QUARANTINE_TTL_MS,
  ACCOUNT_ACCESS_LOCK_RENEW_SCRIPT,
  ACCOUNT_ACCESS_LOCK_RELEASE_SCRIPT,
  acquireAccountAccessLock,
  createAccountAccessLockGuard,
  releaseAccountAccessLock,
  renewAccountAccessLock,
  resetAccountAccessLocksForTests,
} from './accountAccessLock.js'

const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_TARGET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('account access distributed lock', () => {
  beforeEach(() => resetAccountAccessLocksForTests())

  it('uses an atomic token + TTL acquire and compare-and-delete release', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    }

    const lock = await acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      ttlMs: 45_000,
      redis,
      requireDistributed: true,
    })
    const token = redis.set.mock.calls[0][1]
    const key = `${ACCOUNT_ACCESS_LOCK_NAMESPACE}:${createHash('sha256').update(TARGET_ID).digest('hex')}`

    expect(lock.acquired).toBe(true)
    expect(redis.set).toHaveBeenCalledWith(
      key,
      token,
      { nx: true, px: 45_000 },
    )
    await expect(releaseAccountAccessLock(lock)).resolves.toEqual({
      released: true,
      lost: false,
      error: null,
    })
    expect(redis.eval).toHaveBeenCalledWith(
      ACCOUNT_ACCESS_LOCK_RELEASE_SCRIPT,
      [key],
      [token],
    )
    expect(key).not.toContain(TARGET_ID)
  })

  it('reports a conflict without replacing the current distributed owner', async () => {
    const redis = { set: vi.fn().mockResolvedValue(null) }

    await expect(acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      redis,
      requireDistributed: true,
    })).resolves.toMatchObject({
      acquired: false,
      conflict: true,
      unavailable: false,
    })
  })

  it('renews only the matching distributed owner token', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    }
    const lock = await acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      ttlMs: 90_000,
      redis,
      requireDistributed: true,
    })

    await expect(renewAccountAccessLock(lock)).resolves.toEqual({
      renewed: true,
      lost: false,
      error: null,
    })
    expect(redis.eval).toHaveBeenCalledWith(
      ACCOUNT_ACCESS_LOCK_RENEW_SCRIPT,
      [lock.key],
      [lock.token, '90000'],
    )

    redis.eval.mockResolvedValueOnce(0)
    await expect(renewAccountAccessLock(lock)).resolves.toEqual({
      renewed: false,
      lost: true,
      error: null,
    })
  })

  it('fails closed when the required distributed store is unavailable', async () => {
    const redis = { set: vi.fn().mockRejectedValue(new Error('redis offline')) }

    await expect(acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      redis,
      requireDistributed: true,
    })).resolves.toMatchObject({
      acquired: false,
      conflict: false,
      unavailable: true,
      error: expect.objectContaining({ message: 'redis offline' }),
    })
  })

  it('automatically requires the distributed lock in a hosted runtime', async () => {
    await expect(acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      environment: { VERCEL_ENV: 'preview', NODE_ENV: 'production' },
    })).resolves.toMatchObject({
      acquired: false,
      conflict: false,
      unavailable: true,
    })
  })

  it('rejects an oversized target before creating a Redis key', async () => {
    const redis = { set: vi.fn() }

    await expect(acquireAccountAccessLock({
      targetUserId: 'x'.repeat(129),
      redis,
      requireDistributed: true,
    })).resolves.toMatchObject({ acquired: false, unavailable: true })
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('serializes concurrent local operations on the same target', async () => {
    const environment = { NODE_ENV: 'test' }
    const first = await acquireAccountAccessLock({ targetUserId: TARGET_ID, environment })
    const second = await acquireAccountAccessLock({ targetUserId: TARGET_ID, environment })
    const otherTarget = await acquireAccountAccessLock({ targetUserId: OTHER_TARGET_ID, environment })

    expect(first.acquired).toBe(true)
    expect(second).toMatchObject({ acquired: false, conflict: true })
    expect(otherTarget.acquired).toBe(true)

    await releaseAccountAccessLock(first)
    await expect(acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      environment,
    })).resolves.toMatchObject({ acquired: true })
  })

  it('canonicalizes equivalent UUID spellings to one lock owner', async () => {
    const environment = { NODE_ENV: 'test' }
    const first = await acquireAccountAccessLock({
      targetUserId: `  ${TARGET_ID.toUpperCase()}  `,
      environment,
    })
    const second = await acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      environment,
    })

    expect(first.acquired).toBe(true)
    expect(second).toMatchObject({ acquired: false, conflict: true })
    await releaseAccountAccessLock(first)
  })

  it('never releases a newer owner when an expired owner releases late', async () => {
    const environment = { NODE_ENV: 'test' }
    const first = await acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      ttlMs: 10,
      now: 100,
      environment,
    })
    const second = await acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      ttlMs: 10,
      now: 111,
      environment,
    })

    expect(second.acquired).toBe(true)
    await expect(releaseAccountAccessLock(first)).resolves.toEqual({
      released: false,
      lost: true,
      error: null,
    })
    await expect(releaseAccountAccessLock(second)).resolves.toMatchObject({ released: true })
  })

  it('keeps concurrent local requests excluded past the original expiry after renewal', async () => {
    const environment = { NODE_ENV: 'test' }
    const first = await acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      ttlMs: 10,
      now: 100,
      environment,
    })

    await expect(renewAccountAccessLock(first, { ttlMs: 10, now: 105 })).resolves.toEqual({
      renewed: true,
      lost: false,
      error: null,
    })
    await expect(acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      ttlMs: 10,
      now: 111,
      environment,
    })).resolves.toMatchObject({ acquired: false, conflict: true })
    await expect(acquireAccountAccessLock({
      targetUserId: TARGET_ID,
      ttlMs: 10,
      now: 116,
      environment,
    })).resolves.toMatchObject({ acquired: true })
  })

  it('fails the guarded step and forbids release when ownership is lost', async () => {
    const lock = {
      acquired: true,
      backend: 'redis',
      key: 'lock-key',
      token: 'lock-token',
      ttlMs: 120_000,
    }
    const renew = vi.fn()
      .mockResolvedValueOnce({ renewed: true, lost: false, error: null })
      .mockResolvedValueOnce({ renewed: false, lost: true, error: null })
    const guard = createAccountAccessLockGuard(lock, {
      renew,
      renewIntervalMs: 60_000,
      mutationTimeoutMs: 45_000,
    })
    const operation = vi.fn().mockResolvedValue('done')

    await expect(guard.run('profile-write', operation)).rejects.toMatchObject({
      code: 'ACCOUNT_ACCESS_LOCK_LOST',
    })
    expect(operation).toHaveBeenCalledTimes(1)
    await expect(guard.finish()).resolves.toMatchObject({
      safeToRelease: false,
      lost: true,
    })
  })

  it('renews in the background while a guarded operation is active', async () => {
    vi.useFakeTimers()
    try {
      const lock = {
        acquired: true,
        backend: 'redis',
        key: 'lock-key',
        token: 'lock-token',
        ttlMs: 120_000,
      }
      const renew = vi.fn().mockResolvedValue({ renewed: true, lost: false, error: null })
      const guard = createAccountAccessLockGuard(lock, {
        renew,
        renewIntervalMs: 1_000,
        operationTimeoutMs: 10_000,
        mutationTimeoutMs: 30_000,
      })

      await vi.advanceTimersByTimeAsync(1_000)
      expect(renew).toHaveBeenCalledTimes(1)
      await expect(guard.run('auth-read', async () => 'ok')).resolves.toBe('ok')
      expect(renew).toHaveBeenCalledTimes(3)
      await expect(guard.finish()).resolves.toMatchObject({ safeToRelease: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out an unbounded operation and retains the lease for safe expiry', async () => {
    vi.useFakeTimers()
    try {
      const lock = {
        acquired: true,
        backend: 'redis',
        key: 'lock-key',
        token: 'lock-token',
        ttlMs: 120_000,
      }
      const renew = vi.fn().mockResolvedValue({ renewed: true, lost: false, error: null })
      const guard = createAccountAccessLockGuard(lock, {
        renew,
        renewIntervalMs: 60_000,
        operationTimeoutMs: 1_000,
        mutationTimeoutMs: 30_000,
      })
      const pending = guard.run('auth-update', () => new Promise(() => {}))
      const observed = pending.catch(error => error)

      await vi.advanceTimersByTimeAsync(1_000)
      await expect(observed).resolves.toMatchObject({
        code: 'ACCOUNT_ACCESS_OPERATION_TIMEOUT',
      })
      expect(renew).toHaveBeenLastCalledWith(lock, expect.objectContaining({
        ttlMs: ACCOUNT_ACCESS_LOCK_QUARANTINE_TTL_MS,
      }))
      await expect(guard.finish()).resolves.toMatchObject({
        safeToRelease: false,
        timedOut: true,
        quarantined: true,
        quarantineTtlMs: ACCOUNT_ACCESS_LOCK_QUARANTINE_TTL_MS,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports ownership loss when the timeout quarantine cannot extend the owner token', async () => {
    vi.useFakeTimers()
    try {
      const lock = {
        acquired: true,
        backend: 'redis',
        key: 'lock-key',
        token: 'lock-token',
        ttlMs: 120_000,
      }
      const renew = vi.fn()
        .mockResolvedValueOnce({ renewed: true, lost: false, error: null })
        .mockResolvedValueOnce({ renewed: false, lost: true, error: null })
      const guard = createAccountAccessLockGuard(lock, {
        renew,
        renewIntervalMs: 60_000,
        operationTimeoutMs: 1_000,
        mutationTimeoutMs: 30_000,
      })
      const observed = guard
        .run('auth-update', () => new Promise(() => {}))
        .catch(error => error)

      await vi.advanceTimersByTimeAsync(1_000)
      await expect(observed).resolves.toMatchObject({
        code: 'ACCOUNT_ACCESS_LOCK_LOST',
      })
      await expect(guard.finish()).resolves.toMatchObject({
        safeToRelease: false,
        timedOut: true,
        lost: true,
        quarantined: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
