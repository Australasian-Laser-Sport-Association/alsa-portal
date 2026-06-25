import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const limiters = new Map()
const memoryBuckets = new Map()

function hasRedisConfig() {
  return !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN
}

function isProductionRuntime() {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === 'production'
  return process.env.NODE_ENV === 'production'
}

function rejectRateLimitUnavailable(res, prefix) {
  console.error(`[rate-limit:${prefix}] Distributed rate limiter is required in production`)
  res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' })
  return false
}

function getLimiter({ limit, window, prefix }) {
  const cacheKey = `${prefix}:${limit}:${window}`
  if (!limiters.has(cacheKey)) {
    limiters.set(cacheKey, new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `ratelimit:${prefix}`,
      analytics: true,
    }))
  }
  return limiters.get(cacheKey)
}

function windowMilliseconds(window) {
  const match = /^(\d+)\s*([smhd])$/.exec(window.trim())
  if (!match) throw new Error(`Unsupported rate-limit window: ${window}`)
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return Number(match[1]) * unitMs[match[2]]
}

export function memoryRateLimit({ identifier, limit, window, prefix, now = Date.now() }) {
  const duration = windowMilliseconds(window)
  const key = `${prefix}:${identifier}`
  const cutoff = now - duration
  const timestamps = (memoryBuckets.get(key) ?? []).filter(timestamp => timestamp > cutoff)
  const success = timestamps.length < limit
  if (success) timestamps.push(now)
  memoryBuckets.set(key, timestamps)

  return {
    success,
    limit,
    remaining: Math.max(0, limit - timestamps.length),
    reset: timestamps.length > 0 ? timestamps[0] + duration : now + duration,
  }
}

export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for']
  return (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null)
    ?? req.socket?.remoteAddress
    ?? 'unknown'
}

export async function enforceRateLimit(req, res, {
  identifier,
  limit,
  window,
  prefix,
  requireDistributed = false,
}) {
  let result
  if (hasRedisConfig()) {
    try {
      result = await getLimiter({ limit, window, prefix }).limit(identifier)
    } catch (error) {
      if (requireDistributed && isProductionRuntime()) {
        console.error(`[rate-limit:${prefix}] Redis unavailable:`, error)
        return rejectRateLimitUnavailable(res, prefix)
      }
      console.error(`[rate-limit:${prefix}] Redis unavailable; using in-memory fallback:`, error)
    }
  } else {
    if (requireDistributed && isProductionRuntime()) {
      return rejectRateLimitUnavailable(res, prefix)
    }
    console.warn(`[rate-limit:${prefix}] Redis configuration is missing; using in-memory fallback`)
  }

  result ??= memoryRateLimit({ identifier, limit, window, prefix })
  res.setHeader('X-RateLimit-Limit', result.limit)
  res.setHeader('X-RateLimit-Remaining', result.remaining)
  res.setHeader('X-RateLimit-Reset', result.reset)
  if (result.success) return true
  res.status(429).json({ error: 'Too many requests. Please try again later.' })
  return false
}
