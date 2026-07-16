import { describe, expect, it } from 'vitest'
import { backupScheduleHealth } from './backupHealth.js'

const NOW = new Date('2026-07-13T12:00:00.000Z')

describe('backup schedule health', () => {
  it('does not alert when backups are intentionally disabled', () => {
    expect(backupScheduleHealth({ frequency: 'off' }, NOW)).toEqual({
      status: 'disabled', stale: false, maxAgeHours: null,
    })
  })

  it('flags a configured schedule that has never completed', () => {
    expect(backupScheduleHealth({ frequency: 'daily', last_backup_at: null }, NOW))
      .toMatchObject({ status: 'never_completed', stale: true, maxAgeHours: 36 })
  })

  it('flags a recent failed attempt even when its timestamp is fresh', () => {
    expect(backupScheduleHealth({
      frequency: 'daily',
      last_backup_at: '2026-07-13T11:00:00.000Z',
      last_backup_status: 'Failed: storage unavailable',
    }, NOW)).toMatchObject({ status: 'failed', stale: true })
  })

  it('allows weekly schedules eight days before becoming stale', () => {
    expect(backupScheduleHealth({
      frequency: 'weekly',
      last_backup_at: '2026-07-06T12:00:00.000Z',
      last_backup_status: 'Stored privately',
    }, NOW)).toMatchObject({ status: 'healthy', stale: false, maxAgeHours: 192 })
  })

  it('flags overdue daily schedules', () => {
    expect(backupScheduleHealth({
      frequency: 'daily',
      last_backup_at: '2026-07-11T12:00:00.000Z',
      last_backup_status: 'Stored privately',
    }, NOW)).toMatchObject({ status: 'stale', stale: true })
  })
})
