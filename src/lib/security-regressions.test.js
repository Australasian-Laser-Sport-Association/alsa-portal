import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { maskStorageUrl } from './assetUrl'
import { RASTER_IMAGE_TYPES, extensionForMime } from './uploadPolicy'

describe('storage-origin isolation', () => {
  it('does not rewrite public storage objects onto the application origin', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/team-logos/team/logo.svg'
    expect(maskStorageUrl(url)).toBe(url)
  })

  it('does not permit active SVG uploads as images', () => {
    expect(RASTER_IMAGE_TYPES).not.toContain('image/svg+xml')
    expect(extensionForMime('image/svg+xml')).toBeNull()
  })
})

describe('deployment security configuration', () => {
  it('does not expose a same-origin public-storage proxy', async () => {
    const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'))
    expect(config.rewrites.some(rewrite => rewrite.source.startsWith('/files'))).toBe(false)
  })

  it('sets the baseline response headers', async () => {
    const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'))
    const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]))
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })
})

describe('legal acceptance database boundary', () => {
  it('revokes browser writes and removes the re-attestation uniqueness constraint', async () => {
    const migration = await readFile(
      new URL('../../supabase/migrations/20260615000000_security_batch1.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.legal_acceptances FROM authenticated/i)
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_document_id_event_year_key/i)
  })
})
