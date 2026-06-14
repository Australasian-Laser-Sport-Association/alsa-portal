import { describe, expect, it } from 'vitest'
import { clientIp } from './rateLimit.js'

describe('rate-limit identity', () => {
  it('uses the first trusted proxy address', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } })).toBe('203.0.113.5')
  })

  it('falls back to the socket address', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1')
  })
})
