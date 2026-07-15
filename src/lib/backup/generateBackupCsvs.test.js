import { describe, expect, it, vi } from 'vitest'
import { generateBackupCsvs } from './generateBackupCsvs.js'

const SINGLE_READ_TABLES = new Set([
  'zltac_events',
  'teams',
  'doubles_pairs',
  'triples_teams',
])

function backupClient({ assetUploadAudit = [], assetUploadAuditError = null } = {}) {
  const orders = []
  const from = vi.fn(table => ({
    select: vi.fn(() => {
      if (SINGLE_READ_TABLES.has(table)) {
        return Promise.resolve({ data: [], error: null })
      }

      const query = {
        order: vi.fn((column, options) => {
          orders.push({ table, column, options })
          return query
        }),
        range: vi.fn((start) => {
          if (table !== 'admin_asset_upload_audit' || start > 0) {
            return Promise.resolve({ data: [], error: null })
          }
          if (assetUploadAuditError) {
            return Promise.resolve({ data: null, error: assetUploadAuditError })
          }
          return Promise.resolve({ data: assetUploadAudit, error: null })
        }),
      }
      return query
    }),
  }))

  return {
    client: {
      from,
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        },
      },
    },
    from,
    orders,
  }
}

describe('portal backup CSV generation', () => {
  it('exports every privileged asset-upload finalisation in a stable CSV', async () => {
    const { client, from, orders } = backupClient({
      assetUploadAudit: [
        {
          id: 2,
          actor_id: '00000000-0000-4000-8000-000000000002',
          purpose: 'competition-banner',
          scope_id: '10000000-0000-4000-8000-000000000002',
          bucket: 'competition-banners',
          object_path: 'competitions/10000000-0000-4000-8000-000000000002/banner.png',
          object_size: 2048,
          content_type: 'image/png',
          occurred_at: '2026-07-14T01:00:00.000Z',
        },
        {
          id: 1,
          actor_id: '00000000-0000-4000-8000-000000000001',
          purpose: 'event-logo',
          scope_id: null,
          bucket: 'event-logos',
          object_path: 'events/2026/logo.png',
          object_size: 1024,
          content_type: 'image/png',
          occurred_at: '2026-07-14T00:00:00.000Z',
        },
      ],
    })

    const result = await generateBackupCsvs(client)
    const lines = result.assetUploadAuditCsv.replace(/^\uFEFF/, '').split('\r\n')

    expect(from).toHaveBeenCalledWith('admin_asset_upload_audit')
    expect(orders).toContainEqual({
      table: 'admin_asset_upload_audit',
      column: 'id',
      options: { ascending: true },
    })
    expect([...new Set(orders.map(({ table }) => table))].sort()).toEqual([
      'admin_asset_upload_audit',
      'payment_records',
      'profiles',
      'zltac_registrations',
    ])
    expect(result.assetUploadAuditCount).toBe(2)
    expect(lines[0]).toBe(
      'id,actor_id,purpose,scope_id,bucket,object_path,object_size,content_type,occurred_at',
    )
    expect(lines[1]).toContain('1,00000000-0000-4000-8000-000000000001,event-logo,,event-logos')
    expect(lines[2]).toContain('2,00000000-0000-4000-8000-000000000002,competition-banner')
  })

  it('fails the whole backup when the upload-audit query fails', async () => {
    const { client } = backupClient({
      assetUploadAuditError: new Error('audit unavailable'),
    })

    await expect(generateBackupCsvs(client)).rejects.toThrow(
      'Backup query failed (admin_asset_upload_audit): audit unavailable',
    )
  })
})
