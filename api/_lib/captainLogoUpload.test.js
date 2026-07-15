import { describe, expect, it, vi } from 'vitest'
import {
  captainLogoObjectPath,
  inspectCaptainLogoUpload,
  storeCaptainLogo,
  teamLogoPathFromUrl,
} from './captainLogoUpload.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function input(overrides = {}) {
  return {
    contentType: 'image/png',
    sizeBytes: PNG.length,
    dataBase64: PNG.toString('base64'),
    ...overrides,
  }
}

describe('captain logo upload boundary', () => {
  it('accepts canonical raster bytes and rejects content spoofing', () => {
    expect(inspectCaptainLogoUpload(input()).data).toEqual(expect.objectContaining({
      contentType: 'image/png',
      sizeBytes: PNG.length,
      extension: 'png',
    }))
    expect(inspectCaptainLogoUpload(input({
      dataBase64: Buffer.from('<svg>').toString('base64'),
      sizeBytes: 5,
    })).error).toMatch(/contents do not match/i)
  })

  it('rejects malformed or size-mismatched base64', () => {
    expect(inspectCaptainLogoUpload(input({ dataBase64: 'not base64' })).error)
      .toMatch(/valid base64/i)
    expect(inspectCaptainLogoUpload(input({ sizeBytes: PNG.length + 1 })).error)
      .toMatch(/size does not match/i)
  })

  it('uses a unique, team-scoped path for the authorised image type', () => {
    expect(captainLogoObjectPath({
      teamId: 'team-id', extension: 'webp', uploadId: 'upload-id',
    })).toBe('team-id/upload-id.webp')
  })

  it('extracts only raw or branded team-logo object paths', () => {
    expect(teamLogoPathFromUrl(
      'https://project.supabase.co/storage/v1/object/public/team-logos/team-id/upload-id.png',
    )).toBe('team-id/upload-id.png')
    expect(teamLogoPathFromUrl('/assets/team-logos/team-id/upload-id.png'))
      .toBe('team-id/upload-id.png')
    expect(teamLogoPathFromUrl('/assets/avatars/team-id/upload-id.png')).toBeNull()
  })

  it('stores only a unique team-scoped path with no-cache metadata', async () => {
    const upload = vi.fn(path => Promise.resolve({ data: { path }, error: null }))
    const getPublicUrl = vi.fn(path => ({
      data: {
        publicUrl: `https://project.supabase.co/storage/v1/object/public/team-logos/${path}`,
      },
    }))
    const from = vi.fn(() => ({ upload, getPublicUrl }))

    const result = await storeCaptainLogo({
      supabase: { storage: { from } },
      input: input(),
      teamId: 'team-id',
    })

    expect(from).toHaveBeenCalledWith('team-logos')
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(
      /^team-id\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/,
    ), PNG, {
      upsert: false,
      contentType: 'image/png',
      cacheControl: '0',
    })
    expect(result.data.url).toContain(`/team-logos/${result.data.path}`)
  })
})
