import { describe, expect, it, vi } from 'vitest'
import { stableActionRequestId } from './stableActionRequest.js'

describe('stableActionRequestId', () => {
  it('reuses the same key when a lost response is manually retried', () => {
    const ref = { current: null }
    const makeUuid = vi
      .fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const action = { registrationId: 'registration', amount: 2500, type: 'payment' }

    const firstAttempt = stableActionRequestId(ref, action, makeUuid)
    // Simulate an HTTP response being lost: the component deliberately does
    // not clear ref.current in its catch path before the user clicks again.
    const manualRetry = stableActionRequestId(ref, action, makeUuid)

    expect(manualRetry).toBe(firstAttempt)
    expect(makeUuid).toHaveBeenCalledTimes(1)
  })

  it('rotates the key when a material field changes or success clears it', () => {
    const ref = { current: null }
    const makeUuid = vi
      .fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValueOnce('33333333-3333-4333-8333-333333333333')

    expect(stableActionRequestId(ref, { amount: 2500 }, makeUuid)).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
    expect(stableActionRequestId(ref, { amount: 3000 }, makeUuid)).toBe(
      '22222222-2222-4222-8222-222222222222',
    )
    ref.current = null
    expect(stableActionRequestId(ref, { amount: 3000 }, makeUuid)).toBe(
      '33333333-3333-4333-8333-333333333333',
    )
  })
})
