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

  it('applies the configured asset subdomain to canonical relative asset paths', () => {
    vi.stubEnv('VITE_PUBLIC_ASSET_BASE_URL', 'https://media.lasersport.org.au/')
    expect(maskStorageUrl('/assets/event-photos/event/photo.jpg')).toBe(
      'https://media.lasersport.org.au/assets/event-photos/event/photo.jpg',
    )
    expect(storageImageUrl('/assets/event-covers/event/cover.png', { width: 1280 })).toBe(
      'https://media.lasersport.org.au/assets/event-covers/event/cover.png?width=1280&quality=75&resize=contain&format=webp',
    )
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
    expect(headers['Content-Security-Policy']).toContain("script-src 'self'")
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'")
    expect(headers['Content-Security-Policy']).toContain('report-uri /api/contact?resource=csp-report')
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined()
  })

  it('keeps disaster-recovery copies encrypted and outside GitHub artifacts', async () => {
    const workflow = await readFile(
      new URL('../../.github/workflows/disaster-recovery-backup.yml', import.meta.url),
      'utf8',
    )
    const jobEnvironment = workflow.match(
      /timeout-minutes: 60\n {4}env:\n([\s\S]*?)\n\n {4}steps:/,
    )?.[1]
    expect(workflow).toContain("vars.DR_BACKUPS_ENABLED == 'true' && github.ref == 'refs/heads/main'")
    expect(workflow).toContain('name: disaster-recovery')
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).toContain('permissions: {}')
    expect(workflow).toContain('DR_SOURCE_S3_REGION')
    expect(workflow).toContain('DR_DEST_S3_REGION')
    expect(workflow).toContain('AWS_DEFAULT_REGION="$SOURCE_S3_REGION"')
    expect(workflow).toContain('AWS_DEFAULT_REGION="$DEST_S3_REGION"')
    expect(jobEnvironment).not.toContain('secrets.')
    expect(workflow).toContain('postgres:17.10-alpine3.24@sha256:af194ccf3e2d7fe367012c7b88ce8b816c5c889b18a5b316799a1f0d7eac746a')
    expect(workflow.match(/docker run --rm --platform linux\/amd64/g)).toHaveLength(2)
    expect(workflow).toContain('pg_dump --dbname="$DATABASE_URL" --format=custom')
    expect(workflow).toContain('pg_restore --list /backup/database.dump')
    expect(workflow).toContain('tar -tzf "$work/plain/storage.tar.gz"')
    expect(workflow).toContain('aws s3api list-buckets')
    expect(workflow).toContain('age --recipient "$AGE_RECIPIENT"')
    expect(workflow).toContain('aws s3api head-object')
    expect(workflow).toContain('sha256sum database.dump.age storage.tar.gz.age manifest.json')
    expect(workflow).toContain('--query ContentLength')
    expect(workflow).toContain('cmp --silent "$work/output/SHA256SUMS" "$verify/SHA256SUMS"')
    expect(workflow).toContain('sha256sum -c SHA256SUMS')
    expect(workflow).toContain('Encrypted backup read-back hashes verified')
    expect(workflow).toContain('database_dump_completed_at')
    expect(workflow).toContain('storage_copy_completed_at')
    expect(workflow).not.toContain('actions/upload-artifact')
  })
})

describe('client authorization boundaries', () => {
  it('does not treat an ordinary session as password-recovery proof', async () => {
    const resetPage = await readFile(new URL('../pages/ResetPassword.jsx', import.meta.url), 'utf8')
    expect(resetPage).toContain("event === 'PASSWORD_RECOVERY'")
    expect(resetPage).not.toMatch(/auth\.getSession\(\)/)
  })

  it('wraps committee and manager pages in declarative route guards', async () => {
    const app = await readFile(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).toContain('<Route element={<CommitteeRoute />}>')
    expect(app).toContain("<CommitteeRoute allowedRoles={['superadmin']}")
    expect(app).toContain('<ManagerRoute><ManagerCompetitionDetail /></ManagerRoute>')
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
