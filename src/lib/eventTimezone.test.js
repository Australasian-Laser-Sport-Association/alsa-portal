import { describe, it, expect } from 'vitest'
import { toInputValue, parseFromEventTz, resolveEventTimestamp } from './eventTimezone'

const TZ = 'Australia/Melbourne'

describe('resolveEventTimestamp', () => {
  // Regression: a datetime-local input carries only minute precision, so a
  // stored timestamp with non-zero seconds could not survive the
  // toInputValue -> parseFromEventTz round trip. Re-sending the truncated value
  // made an untouched field look edited, which tripped the event immutability
  // guard and blocked every save on a closed event.
  it('keeps the stored value when the input still matches it to the minute', () => {
    const stored = '2026-07-16T03:43:33.794432+00:00'
    const input = toInputValue(stored, TZ)

    // The naive path loses the seconds, which is what caused the bug.
    expect(parseFromEventTz(input, TZ)).not.toBe(stored)
    expect(parseFromEventTz(input, TZ)).toBe('2026-07-16T03:43:00.000Z')

    expect(resolveEventTimestamp(input, stored, TZ)).toBe(stored)
  })

  it('returns a new timestamp when the field is genuinely edited', () => {
    const stored = '2026-07-16T03:43:33.794432+00:00'
    const edited = '2026-07-16T14:00'

    expect(resolveEventTimestamp(edited, stored, TZ)).toBe(parseFromEventTz(edited, TZ))
    expect(resolveEventTimestamp(edited, stored, TZ)).not.toBe(stored)
  })

  it('parses normally when there is no stored value to preserve', () => {
    expect(resolveEventTimestamp('2028-04-10T09:00', null, TZ))
      .toBe(parseFromEventTz('2028-04-10T09:00', TZ))
  })

  it('treats clearing a set value as a real change rather than preserving it', () => {
    const stored = '2026-07-16T03:43:33.794432+00:00'
    expect(resolveEventTimestamp('', stored, TZ)).toBeNull()
  })

  it('leaves an unset field null', () => {
    expect(resolveEventTimestamp('', null, TZ)).toBeNull()
  })

  it('re-parses when the timezone changes even though the input string has not', () => {
    const stored = '2026-07-16T03:43:33.794432+00:00'
    const input = toInputValue(stored, TZ)
    // Same wall-clock text, different zone: the admin means a different instant.
    const resolved = resolveEventTimestamp(input, stored, 'Australia/Perth')
    expect(resolved).toBe(parseFromEventTz(input, 'Australia/Perth'))
    expect(resolved).not.toBe(stored)
  })
})
