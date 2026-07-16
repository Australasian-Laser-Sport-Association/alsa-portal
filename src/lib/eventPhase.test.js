import { describe, expect, it } from 'vitest'
import { eventPhase } from './eventPhase.js'

const NOW = new Date('2027-01-15T00:00:00Z')

describe('eventPhase', () => {
  it('fails closed when an event cannot be resolved', () => {
    expect(eventPhase(null, NOW)).toBe('closed')
  })

  it('never treats draft, closed, archived, or unknown states as open', () => {
    for (const status of ['draft', 'closed', 'archived', 'unexpected']) {
      const expected = status === 'draft' ? 'locked' : 'closed'
      expect(eventPhase({
        status,
        reg_close_date: '2028-01-01T00:00:00Z',
        event_starts_at: '2028-02-01T00:00:00Z',
      }, NOW)).toBe(expected)
    }
  })

  it('applies the date boundaries only to an open event', () => {
    expect(eventPhase({
      status: 'open',
      reg_open_date: '2027-02-01T00:00:00Z',
      reg_close_date: '2027-03-01T00:00:00Z',
      event_starts_at: '2027-04-01T00:00:00Z',
    }, NOW)).toBe('locked')

    expect(eventPhase({
      status: 'open',
      reg_open_date: '2027-01-01T00:00:00Z',
      reg_close_date: '2027-02-01T00:00:00Z',
      event_starts_at: '2027-03-01T00:00:00Z',
    }, NOW)).toBe('open')

    expect(eventPhase({
      status: 'open',
      reg_close_date: '2027-01-01T00:00:00Z',
      event_starts_at: '2027-03-01T00:00:00Z',
    }, NOW)).toBe('locked')

    expect(eventPhase({
      status: 'open',
      reg_close_date: '2027-01-01T00:00:00Z',
      event_starts_at: '2027-01-10T00:00:00Z',
    }, NOW)).toBe('closed')
  })

  it('retains the historical timestamp-only calculation for legacy callers', () => {
    expect(eventPhase({
      reg_close_date: '2027-02-01T00:00:00Z',
      event_starts_at: '2027-03-01T00:00:00Z',
    }, NOW)).toBe('open')
  })
})
