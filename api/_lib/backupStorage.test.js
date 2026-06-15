import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { buildBackupFiles } from './backupStorage.js'

describe('private backup manifest', () => {
  it('records counts and SHA-256 digests for each CSV', () => {
    const csvs = {
      registrationsCsv: 'id,name\n1,Ada\n',
      paymentsCsv: 'id,amount\n1,100\n',
      eventsCsv: 'id,year\n1,2026\n',
      registrationsCount: 1,
      paymentsCount: 1,
      eventsCount: 1,
    }
    const { manifest, files } = buildBackupFiles(csvs, '2026-06-15T00:00:00.000Z')

    expect(manifest.counts).toEqual({ registrations: 1, payments: 1, events: 1 })
    expect(files.map(file => file.name)).toEqual([
      'registrations.csv', 'payments.csv', 'events.csv', 'manifest.json',
    ])
    expect(manifest.files[0].sha256).toBe(
      createHash('sha256').update(csvs.registrationsCsv, 'utf8').digest('hex'),
    )
  })
})
