import { describe, expect, it, vi } from 'vitest'
import { clientIp, enforceRateLimit, memoryRateLimit } from './rateLimit.js'

describe('rate-limit identity', () => {
  it('uses the first trusted proxy address', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } })).toBe('203.0.113.5')
  })

  it('falls back to the socket address', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1')
  })
})

describe('in-memory rate-limit fallback', () => {
  it('allows requests up to the limit and rejects the next request', () => {
    const input = { identifier: 'user-a', limit: 2, window: '1 m', prefix: 'test-limit', now: 1_000_000 }
    expect(memoryRateLimit(input).success).toBe(true)
    expect(memoryRateLimit({ ...input, now: 1_000_001 }).success).toBe(true)
    expect(memoryRateLimit({ ...input, now: 1_000_002 }).success).toBe(false)
  })

  it('allows requests again after the window expires', () => {
    const input = { identifier: 'user-b', limit: 1, window: '10 m', prefix: 'test-reset', now: 2_000_000 }
    expect(memoryRateLimit(input).success).toBe(true)
    expect(memoryRateLimit({ ...input, now: 2_600_001 }).success).toBe(true)
  })

  it('keeps protected routes available when Redis is not configured', async () => {
    const previousUrl = process.env.UPSTASH_REDIS_REST_URL
    const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const headers = {}
    const res = {
      setHeader(name, value) { headers[name] = value },
      status() { throw new Error('request should not be rejected') },
    }

    try {
      await expect(enforceRateLimit({}, res, {
        identifier: 'user-c',
        limit: 2,
        window: '1 m',
        prefix: 'test-fallback',
      })).resolves.toBe(true)
      expect(headers['X-RateLimit-Limit']).toBe(2)
    } finally {
      warn.mockRestore()
      if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
      else process.env.UPSTASH_REDIS_REST_URL = previousUrl
      if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
      else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken
    }
  })

  it('fails closed in production when distributed rate limiting is required but Redis is not configured', async () => {
    const previousUrl = process.env.UPSTASH_REDIS_REST_URL
    const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN
    const previousVercelEnv = process.env.VERCEL_ENV
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.VERCEL_ENV = 'production'

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = {
      statusCode: null,
      body: null,
      setHeader() { throw new Error('rate-limit headers should not be set') },
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        this.body = payload
        return this
      },
    }

    try {
      await expect(enforceRateLimit({}, res, {
        identifier: 'user-d',
        limit: 2,
        window: '1 m',
        prefix: 'test-required',
        requireDistributed: true,
      })).resolves.toBe(false)
      expect(res.statusCode).toBe(503)
      expect(res.body).toEqual({ error: 'Service temporarily unavailable. Please try again later.' })
    } finally {
      error.mockRestore()
      if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
      else process.env.UPSTASH_REDIS_REST_URL = previousUrl
      if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
      else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken
      if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = previousVercelEnv
    }
  })

  it('keeps Vercel previews available even when NODE_ENV is production', async () => {
    const previousUrl = process.env.UPSTASH_REDIS_REST_URL
    const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN
    const previousVercelEnv = process.env.VERCEL_ENV
    const previousNodeEnv = process.env.NODE_ENV
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.VERCEL_ENV = 'preview'
    process.env.NODE_ENV = 'production'

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const headers = {}
    const res = {
      setHeader(name, value) { headers[name] = value },
      status() { throw new Error('preview request should not be rejected') },
    }

    try {
      await expect(enforceRateLimit({}, res, {
        identifier: 'user-e',
        limit: 2,
        window: '1 m',
        prefix: 'test-preview',
        requireDistributed: true,
      })).resolves.toBe(true)
      expect(headers['X-RateLimit-Limit']).toBe(2)
    } finally {
      warn.mockRestore()
      if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
      else process.env.UPSTASH_REDIS_REST_URL = previousUrl
      if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
      else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken
      if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = previousVercelEnv
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  })
})
