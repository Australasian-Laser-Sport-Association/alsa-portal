import { createHash } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildBackupFiles,
  reconcileFailedBackupObjects,
} from './backupStorage.js'

describe('private backup manifest', () => {
  it('records counts and SHA-256 digests for each CSV', () => {
    const csvs = {
      registrationsCsv: 'id,name\n1,Ada\n',
      paymentsCsv: 'id,amount\n1,100\n',
      eventsCsv: 'id,year\n1,2026\n',
      assetUploadAuditCsv: 'id,purpose\n1,event-logo\n',
      registrationsCount: 1,
      paymentsCount: 1,
      eventsCount: 1,
      assetUploadAuditCount: 1,
    }
    const { manifest, files } = buildBackupFiles(csvs, '2026-06-15T00:00:00.000Z')

    expect(manifest).toMatchObject({
      version: 2,
      counts: {
        registrations: 1,
        payments: 1,
        events: 1,
        adminAssetUploadAudit: 1,
      },
    })
    expect(files.map(file => file.name)).toEqual([
      'registrations.csv',
      'payments.csv',
      'events.csv',
      'admin-asset-upload-audit.csv',
      'manifest.json',
    ])
    expect(manifest.files[0].sha256).toBe(
      createHash('sha256').update(csvs.registrationsCsv, 'utf8').digest('hex'),
    )
    expect(manifest.files[3].sha256).toBe(
      createHash('sha256').update(csvs.assetUploadAuditCsv, 'utf8').digest('hex'),
    )
  })

  it('clears failed-run paths only after private storage confirms removal', async () => {
    const query = {}
    query.eq = vi.fn(() => query)
    query.not = vi.fn(() => query)
    query.limit = vi.fn().mockResolvedValue({
      data: [
        { id: 'cleaned-run', object_paths: ['cleaned/file.csv'] },
        { id: 'pending-run', object_paths: ['pending/file.csv'] },
      ],
      error: null,
    })

    const clearedRuns = []
    const table = {
      select: vi.fn(() => query),
      update: vi.fn(() => {
        const filters = {}
        const updateQuery = {
          eq: vi.fn((column, value) => {
            filters[column] = value
            if (column === 'status') {
              clearedRuns.push(filters.id)
              return Promise.resolve({ error: null })
            }
            return updateQuery
          }),
        }
        return updateQuery
      }),
    }
    const remove = vi.fn(paths => Promise.resolve(
      paths[0].startsWith('pending/')
        ? { error: new Error('storage unavailable') }
        : { error: null },
    ))
    const onError = vi.fn()
    const supabase = {
      from: vi.fn(() => table),
      storage: { from: vi.fn(() => ({ remove })) },
    }

    const result = await reconcileFailedBackupObjects(supabase, { onError })

    expect(result).toEqual({ cleaned: 1, pending: 1, error: null })
    expect(remove).toHaveBeenCalledWith(['cleaned/file.csv'])
    expect(remove).toHaveBeenCalledWith(['pending/file.csv'])
    expect(clearedRuns).toEqual(['cleaned-run'])
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'remove', 'pending-run')
  })
})
