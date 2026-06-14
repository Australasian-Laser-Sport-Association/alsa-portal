import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const limiters = new Map()

function hasRedisConfig() {
  return !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN
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
  failClosed = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production',
}) {
  if (!hasRedisConfig()) {
    console.error(`[rate-limit:${prefix}] Redis configuration is missing`)
    if (!failClosed) return true
    res.status(503).json({ error: 'Request protection is temporarily unavailable. Please try again later.' })
    return false
  }

  try {
    const result = await getLimiter({ limit, window, prefix }).limit(identifier)
    res.setHeader('X-RateLimit-Limit', result.limit)
    res.setHeader('X-RateLimit-Remaining', result.remaining)
    res.setHeader('X-RateLimit-Reset', result.reset)
    if (result.success) return true
    res.status(429).json({ error: 'Too many requests. Please try again later.' })
    return false
  } catch (error) {
    console.error(`[rate-limit:${prefix}] unavailable:`, error)
    if (!failClosed) return true
    res.status(503).json({ error: 'Request protection is temporarily unavailable. Please try again later.' })
    return false
  }
}
