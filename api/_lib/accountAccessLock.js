import { createHash, randomUUID } from 'node:crypto'
import { Redis } from '@upstash/redis'

export const ACCOUNT_ACCESS_LOCK_TTL_MS = 120_000
export const ACCOUNT_ACCESS_LOCK_RENEW_INTERVAL_MS = 20_000
export const ACCOUNT_ACCESS_OPERATION_TIMEOUT_MS = 15_000
export const ACCOUNT_ACCESS_MUTATION_TIMEOUT_MS = 45_000
export const ACCOUNT_ACCESS_LOCK_QUARANTINE_TTL_MS = 30 * 60_000
export const ACCOUNT_ACCESS_LOCK_NAMESPACE = 'alsa:portal:account-access:v1'
export const ACCOUNT_ACCESS_LOCK_RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`.trim()
export const ACCOUNT_ACCESS_LOCK_RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`.trim()

const LOCK_LOST_CODE = 'ACCOUNT_ACCESS_LOCK_LOST'
const OPERATION_TIMEOUT_CODE = 'ACCOUNT_ACCESS_OPERATION_TIMEOUT'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const memoryLocks = new Map()

function redisConfigured(environment) {
  return !!environment.UPSTASH_REDIS_REST_URL
    && !!environment.UPSTASH_REDIS_REST_TOKEN
}

export function requiresDistributedAccountAccessLock(environment = process.env) {
  return !!environment.VERCEL_ENV
    || !!environment.VERCEL
    || environment.NODE_ENV === 'production'
}

export function canonicalizeAccountAccessTargetId(targetUserId) {
  if (typeof targetUserId !== 'string') return null
  const canonical = targetUserId.trim().toLowerCase()
  return UUID_PATTERN.test(canonical) ? canonical : null
}

function lockKey(targetUserId) {
  const digest = createHash('sha256').update(targetUserId, 'utf8').digest('hex')
  return `${ACCOUNT_ACCESS_LOCK_NAMESPACE}:${digest}`
}

function unavailable(error) {
  return {
    acquired: false,
    conflict: false,
    unavailable: true,
    error,
  }
}

function lockSafetyError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}

export function isAccountAccessLockSafetyError(error) {
  return error?.code === LOCK_LOST_CODE || error?.code === OPERATION_TIMEOUT_CODE
}

function acquireMemoryLock({ key, token, ttlMs, now }) {
  const existing = memoryLocks.get(key)
  if (existing && existing.expiresAt > now) {
    return { acquired: false, conflict: true, unavailable: false, error: null }
  }

  memoryLocks.set(key, { token, expiresAt: now + ttlMs })
  return {
    acquired: true,
    conflict: false,
    unavailable: false,
    error: null,
    backend: 'memory',
    key,
    token,
    ttlMs,
  }
}

export async function acquireAccountAccessLock({
  targetUserId,
  ttlMs = ACCOUNT_ACCESS_LOCK_TTL_MS,
  environment = process.env,
  requireDistributed = requiresDistributedAccountAccessLock(environment),
  redis,
  now = Date.now(),
} = {}) {
  const canonicalTargetUserId = canonicalizeAccountAccessTargetId(targetUserId)
  if (!canonicalTargetUserId) {
    return unavailable(new Error('A canonical UUID target user id is required for the account access lock.'))
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return unavailable(new Error('The account access lock TTL is invalid.'))
  }

  const key = lockKey(canonicalTargetUserId)
  const token = randomUUID()
  let distributed = redis
  if (!distributed && redisConfigured(environment)) {
    try {
      distributed = Redis.fromEnv()
    } catch (error) {
      if (requireDistributed) return unavailable(error)
    }
  }

  if (distributed) {
    try {
      const result = await distributed.set(key, token, { nx: true, px: ttlMs })
      if (result !== 'OK') {
        return { acquired: false, conflict: true, unavailable: false, error: null }
      }
      return {
        acquired: true,
        conflict: false,
        unavailable: false,
        error: null,
        backend: 'redis',
        redis: distributed,
        key,
        token,
        ttlMs,
      }
    } catch (error) {
      if (requireDistributed) return unavailable(error)
    }
  } else if (requireDistributed) {
    return unavailable(new Error('The distributed account access lock is not configured.'))
  }

  return acquireMemoryLock({ key, token, ttlMs, now })
}

export async function renewAccountAccessLock(lock, {
  ttlMs = lock?.ttlMs ?? ACCOUNT_ACCESS_LOCK_TTL_MS,
  now = Date.now(),
} = {}) {
  if (!lock?.acquired || !lock.key || !lock.token) {
    return {
      renewed: false,
      lost: false,
      error: new Error('Invalid account access lock.'),
    }
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return {
      renewed: false,
      lost: false,
      error: new Error('The account access lock TTL is invalid.'),
    }
  }

  if (lock.backend === 'redis') {
    try {
      const result = await lock.redis.eval(
        ACCOUNT_ACCESS_LOCK_RENEW_SCRIPT,
        [lock.key],
        [lock.token, String(ttlMs)],
      )
      return { renewed: Number(result) === 1, lost: Number(result) !== 1, error: null }
    } catch (error) {
      return { renewed: false, lost: false, error }
    }
  }

  const existing = memoryLocks.get(lock.key)
  if (existing?.token !== lock.token || existing.expiresAt <= now) {
    return { renewed: false, lost: true, error: null }
  }
  existing.expiresAt = now + ttlMs
  return { renewed: true, lost: false, error: null }
}

export function createAccountAccessLockGuard(lock, {
  ttlMs = lock?.ttlMs ?? ACCOUNT_ACCESS_LOCK_TTL_MS,
  renewIntervalMs = Math.min(ACCOUNT_ACCESS_LOCK_RENEW_INTERVAL_MS, Math.floor(ttlMs / 3)),
  operationTimeoutMs = ACCOUNT_ACCESS_OPERATION_TIMEOUT_MS,
  mutationTimeoutMs = ACCOUNT_ACCESS_MUTATION_TIMEOUT_MS,
  quarantineTtlMs = ACCOUNT_ACCESS_LOCK_QUARANTINE_TTL_MS,
  renew = renewAccountAccessLock,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!lock?.acquired) throw new Error('An acquired account access lock is required.')
  if (!Number.isFinite(renewIntervalMs) || renewIntervalMs <= 0) {
    throw new Error('The account access lock renewal interval is invalid.')
  }
  if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0) {
    throw new Error('The account access operation timeout is invalid.')
  }
  if (!Number.isFinite(mutationTimeoutMs) || mutationTimeoutMs <= 0) {
    throw new Error('The account access mutation timeout is invalid.')
  }
  if (!Number.isFinite(quarantineTtlMs) || quarantineTtlMs <= ttlMs) {
    throw new Error('The account access lock quarantine TTL is invalid.')
  }

  const deadline = now() + mutationTimeoutMs
  let timer = null
  let renewalInFlight = null
  let stopped = false
  let quarantining = false
  let unsafe = null

  function clearScheduledRenewal() {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  function markUnsafe(error, details = {}) {
    if (!unsafe) unsafe = { error, ...details }
    else Object.assign(unsafe, details)
    clearScheduledRenewal()
    return unsafe.error
  }

  async function quarantineTimedOutMutation(timeoutError, details = {}) {
    // Promise.race cannot cancel Supabase Auth calls. Extend the same owner
    // token far beyond the route's execution budget before returning 503, so
    // a straggling remote mutation cannot overlap an automatic retry. The key
    // is deliberately retained for expiry and operator reconciliation.
    quarantining = true
    clearScheduledRenewal()
    if (renewalInFlight) await renewalInFlight

    let result
    try {
      result = await renew(lock, { ttlMs: quarantineTtlMs, now: now() })
    } catch (error) {
      result = { renewed: false, lost: false, error }
    }

    let safetyError = timeoutError
    if (result.lost) {
      safetyError = lockSafetyError(
        LOCK_LOST_CODE,
        'The account access lock was lost while quarantining a timed-out mutation.',
      )
    }
    const error = markUnsafe(safetyError, {
      ...details,
      timedOut: true,
      lost: !!result.lost,
      quarantined: !!result.renewed,
      quarantineTtlMs: result.renewed ? quarantineTtlMs : null,
      quarantineError: result.error ?? null,
    })
    quarantining = false
    return error
  }

  async function performRenewal() {
    if (renewalInFlight) return renewalInFlight
    renewalInFlight = Promise.resolve(renew(lock, { ttlMs, now: now() }))
      .catch(error => ({ renewed: false, lost: false, error }))
    try {
      const result = await renewalInFlight
      if (!result.renewed) {
        const error = lockSafetyError(
          LOCK_LOST_CODE,
          result.lost
            ? 'The account access lock is no longer owned by this request.'
            : 'The account access lock could not be renewed safely.',
          result.error,
        )
        markUnsafe(error, { lost: !!result.lost, renewalError: result.error ?? null })
      }
      return result
    } finally {
      renewalInFlight = null
    }
  }

  function scheduleRenewal() {
    if (stopped || quarantining || unsafe) return
    timer = setTimer(async () => {
      timer = null
      await performRenewal()
      scheduleRenewal()
    }, renewIntervalMs)
    timer?.unref?.()
  }

  async function assertOwned() {
    if (unsafe) throw unsafe.error
    if (now() >= deadline) {
      throw await quarantineTimedOutMutation(lockSafetyError(
        OPERATION_TIMEOUT_CODE,
        'The account access mutation exceeded its safe execution window.',
      ))
    }
    const result = await performRenewal()
    if (!result.renewed) throw unsafe.error
    return true
  }

  async function run(label, operation) {
    if (typeof operation !== 'function') throw new Error('A lock-guarded operation is required.')
    await assertOwned()

    const remainingMs = deadline - now()
    const timeoutMs = Math.min(operationTimeoutMs, remainingMs)
    if (timeoutMs <= 0) {
      throw await quarantineTimedOutMutation(lockSafetyError(
        OPERATION_TIMEOUT_CODE,
        `The account access operation ${label} exceeded its safe execution window.`,
      ), { operation: label })
    }

    let timeoutHandle
    const operationPromise = Promise.resolve().then(operation)
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimer(() => reject(lockSafetyError(
        OPERATION_TIMEOUT_CODE,
        `The account access operation ${label} timed out.`,
      )), timeoutMs)
      timeoutHandle?.unref?.()
    })

    try {
      const result = await Promise.race([operationPromise, timeoutPromise])
      clearTimer(timeoutHandle)
      await assertOwned()
      return result
    } catch (error) {
      clearTimer(timeoutHandle)
      if (error?.code === OPERATION_TIMEOUT_CODE) {
        operationPromise.catch(() => {})
        throw await quarantineTimedOutMutation(error, { operation: label })
      }
      await assertOwned()
      throw error
    }
  }

  async function finish() {
    stopped = true
    clearScheduledRenewal()
    if (renewalInFlight) await renewalInFlight
    if (!unsafe) await performRenewal()
    return {
      safeToRelease: !unsafe,
      lost: !!unsafe?.lost,
      timedOut: !!unsafe?.timedOut,
      quarantined: !!unsafe?.quarantined,
      quarantineTtlMs: unsafe?.quarantineTtlMs ?? null,
      error: unsafe?.error ?? null,
      renewalError: unsafe?.renewalError ?? null,
      quarantineError: unsafe?.quarantineError ?? null,
    }
  }

  scheduleRenewal()
  return {
    run,
    assertOwned,
    finish,
    get unsafe() { return unsafe },
  }
}

export async function releaseAccountAccessLock(lock) {
  if (!lock?.acquired || !lock.key || !lock.token) {
    return { released: false, lost: false, error: new Error('Invalid account access lock.') }
  }

  if (lock.backend === 'redis') {
    try {
      const result = await lock.redis.eval(
        ACCOUNT_ACCESS_LOCK_RELEASE_SCRIPT,
        [lock.key],
        [lock.token],
      )
      return { released: Number(result) === 1, lost: Number(result) !== 1, error: null }
    } catch (error) {
      return { released: false, lost: false, error }
    }
  }

  const existing = memoryLocks.get(lock.key)
  if (existing?.token !== lock.token) {
    return { released: false, lost: true, error: null }
  }
  memoryLocks.delete(lock.key)
  return { released: true, lost: false, error: null }
}

export function resetAccountAccessLocksForTests() {
  memoryLocks.clear()
}
