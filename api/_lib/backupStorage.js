import { createHash } from 'crypto'

export function buildBackupFiles(csvs, createdAt = new Date().toISOString()) {
  const files = [
    { name: 'registrations.csv', content: csvs.registrationsCsv, contentType: 'text/csv' },
    { name: 'payments.csv', content: csvs.paymentsCsv, contentType: 'text/csv' },
    { name: 'events.csv', content: csvs.eventsCsv, contentType: 'text/csv' },
  ]
  const sha256 = content => createHash('sha256').update(content, 'utf8').digest('hex')
  const manifest = {
    version: 1,
    createdAt,
    timezone: 'Australia/Sydney',
    counts: {
      registrations: csvs.registrationsCount,
      payments: csvs.paymentsCount,
      events: csvs.eventsCount,
    },
    files: files.map(file => ({ name: file.name, sha256: sha256(file.content) })),
  }

  return {
    manifest,
    files: [...files, {
      name: 'manifest.json',
      content: JSON.stringify(manifest, null, 2),
      contentType: 'application/json',
    }],
  }
}
