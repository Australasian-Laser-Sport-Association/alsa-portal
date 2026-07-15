import { describe, expect, it } from 'vitest'
import {
  isValidDateOfBirth,
  registrationDateOfBirth,
  under18Requirement,
} from './dateOfBirth.js'

describe('date of birth safety helpers', () => {
  it('rejects missing, impossible, and future dates of birth', () => {
    const now = new Date('2026-07-13T00:00:00Z')
    expect(isValidDateOfBirth('', now)).toBe(false)
    expect(isValidDateOfBirth('2001-02-29', now)).toBe(false)
    expect(isValidDateOfBirth('1899-12-31', now)).toBe(false)
    expect(isValidDateOfBirth('2027-01-01', now)).toBe(false)
    expect(isValidDateOfBirth('2000-02-29', now)).toBe(true)
  })

  it('uses the immutable registration snapshot before the editable profile', () => {
    expect(registrationDateOfBirth(
      { dob_at_registration: '2010-04-05' },
      { dob: '1990-01-01' },
    )).toBe('2010-04-05')
    expect(registrationDateOfBirth({ dob_at_registration: null }, { dob: '1990-01-01' })).toBeNull()
    expect(registrationDateOfBirth(null, { dob: '1990-01-01' })).toBe('1990-01-01')
  })

  it('treats missing or invalid DOB as blocking, never as adult', () => {
    const event = { startDate: '2027-07-01' }
    expect(under18Requirement({ ...event, dob: null }).status).toBe('blocked')
    expect(under18Requirement({ ...event, dob: 'not-a-date' }).status).toBe('blocked')
    expect(under18Requirement({ ...event, dob: '2028-01-01' }).status).toBe('blocked')
  })

  it('uses the event date and handles the exact eighteenth birthday', () => {
    expect(under18Requirement({ dob: '2009-07-02', startDate: '2027-07-01' }).status).toBe('required')
    expect(under18Requirement({ dob: '2009-07-01', startDate: '2027-07-01' }).status).toBe('not_required')
  })

  it('reads a timestamp in the configured event timezone', () => {
    expect(under18Requirement({
      dob: '2009-07-02',
      eventStartsAt: '2027-07-01T15:00:00.000Z',
      timezone: 'Australia/Sydney',
    }).status).toBe('not_required')
  })

  it('fails closed when a timestamp cannot be localized safely', () => {
    const event = {
      dob: '2009-07-02',
      eventStartsAt: '2027-07-01T15:00:00.000Z',
    }
    expect(under18Requirement(event).status).toBe('blocked')
    expect(under18Requirement({ ...event, timezone: 'Not/A-Timezone' }).status).toBe('blocked')
  })
})
