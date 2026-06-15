import { readdir, readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { maskStorageUrl, storageImageUrl } from './assetUrl'
import { RASTER_IMAGE_TYPES, extensionForMime } from './uploadPolicy'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('storage-origin isolation', () => {
  it('rewrites allowed public storage objects onto branded asset routes', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/team-logos/team/logo.png'
    expect(maskStorageUrl(url)).toBe('/assets/team-logos/team/logo.png')
  })

  it('rewrites public legal documents onto the branded documents route', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/legal-documents/media_release/v1/release.pdf'
    expect(maskStorageUrl(url)).toBe('/documents/media_release/v1/release.pdf')
  })

  it('uses the configured asset subdomain in production builds', () => {
    vi.stubEnv('VITE_PUBLIC_ASSET_BASE_URL', 'https://media.lasersport.org.au/')
    const url = 'https://project.supabase.co/storage/v1/object/public/legal-documents/media_release/v1/release.pdf'
    expect(maskStorageUrl(url)).toBe('https://media.lasersport.org.au/documents/media_release/v1/release.pdf')
  })

  it('uses the branded media route for optimized image rendering', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/event-covers/event/cover.png'
    expect(storageImageUrl(url, { width: 1280, quality: 70 })).toBe(
      '/assets/event-covers/event/cover.png?width=1280&quality=70&resize=contain&format=webp',
    )
  })

  it('leaves non-Supabase-storage image URLs unchanged', () => {
    const url = 'https://images.example.org/event-cover.jpg'
    expect(storageImageUrl(url, { width: 1280 })).toBe(url)
  })

  it('does not permit active SVG uploads as images', () => {
    expect(RASTER_IMAGE_TYPES).not.toContain('image/svg+xml')
    expect(extensionForMime('image/svg+xml')).toBeNull()
  })
})

describe('deployment security configuration', () => {
  it('does not expose the legacy broad same-origin public-storage proxy', async () => {
    const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'))
    expect(config.rewrites.some(rewrite => rewrite.source.startsWith('/files'))).toBe(false)
  })

  it('exposes only the branded public asset routes before the SPA fallback', async () => {
    const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'))
    expect(config.rewrites.slice(0, 2)).toEqual([
      { source: '/documents/:path*', destination: '/api/public?resource=asset&bucket=legal-documents&path=:path*' },
      { source: '/assets/:bucket/:path*', destination: '/api/public?resource=asset&bucket=:bucket&path=:path*' },
    ])
  })

  it('stays within the Vercel Hobby serverless function cap', async () => {
    const apiRoot = new URL('../../api/', import.meta.url)
    const entries = await readdir(apiRoot, { recursive: true, withFileTypes: true })
    const endpointCount = entries.filter(entry =>
      entry.isFile()
        && entry.name.endsWith('.js')
        && !entry.name.endsWith('.test.js')
        && !entry.parentPath.includes('\\_lib')
        && !entry.parentPath.includes('/_lib')
    ).length

    expect(endpointCount).toBeLessThanOrEqual(12)
  })

  it('allows the app origin to embed branded media-subdomain assets', async () => {
    const publicApi = await readFile(new URL('../../api/public.js', import.meta.url), 'utf8')
    expect(publicApi).toMatch(/Cross-Origin-Resource-Policy['"], ['"]cross-origin/)
    expect(publicApi).not.toMatch(/Cross-Origin-Resource-Policy['"], ['"]same-origin/)
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
      new URL('../../supabase/migrations/20260615060000_security_batch1.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.legal_acceptances FROM authenticated/i)
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_document_id_event_year_key/i)
  })
})
