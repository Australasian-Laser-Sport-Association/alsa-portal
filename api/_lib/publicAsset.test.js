import { describe, expect, it } from 'vitest'
import {
  brandedAssetUrlFromSupabase,
  isAllowedContentType,
  isAllowedPublicAsset,
  validatedRenderParams,
} from './publicAsset.js'

describe('public asset proxy policy', () => {
  it('allows branded paths for known public image buckets', () => {
    expect(isAllowedPublicAsset('event-covers', '2026/cover.webp')).toBe(true)
    expect(isAllowedPublicAsset('competition-banners', 'pre-nats/banner.jpg')).toBe(true)
  })

  it('allows legal PDFs under the documents route', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/legal-documents/media_release/v1/zltac.pdf'
    expect(brandedAssetUrlFromSupabase(url)).toBe('/documents/media_release/v1/zltac.pdf')
  })

  it('blocks unknown buckets, active extensions, and traversal paths', () => {
    expect(isAllowedPublicAsset('portal-backups', 'backup.sql')).toBe(false)
    expect(isAllowedPublicAsset('team-logos', 'logo.svg')).toBe(false)
    expect(isAllowedPublicAsset('event-covers', '../cover.png')).toBe(false)
  })

  it('checks upstream content types as well as file extensions', () => {
    expect(isAllowedContentType('legal-documents', 'application/pdf')).toBe(true)
    expect(isAllowedContentType('legal-documents', 'text/html')).toBe(false)
    expect(isAllowedContentType('event-covers', 'image/svg+xml')).toBe(false)
  })

  it('validates image transform params', () => {
    expect(validatedRenderParams({ width: '1280', quality: '70', resize: 'contain', format: 'webp' }).toString())
      .toBe('width=1280&quality=70&resize=contain&format=webp')
    expect(validatedRenderParams({ width: '99999' })).toBeNull()
    expect(validatedRenderParams({ width: '1280', format: 'svg' })).toBeNull()
  })
})

