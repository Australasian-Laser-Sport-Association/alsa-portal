import { describe, expect, it, vi } from 'vitest'
import {
  canonicalAssetReference,
  COMMITTEE_ASSET_PURPOSES,
  COMPETITION_ASSET_PURPOSES,
  finalizeSignedAssetUpload,
  inspectAssetUploadRequest,
  issueSignedAssetUpload,
} from './adminAssetUpload.js'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const FILE_ID = '33333333-3333-4333-8333-333333333333'

describe('privileged asset upload capabilities', () => {
  it('accepts only an allowlisted purpose, MIME, bounded size, and UUID scope', () => {
    expect(inspectAssetUploadRequest({
      purpose: 'event-cover',
      scopeId: EVENT_ID,
      contentType: 'image/webp',
      sizeBytes: 1024,
    }, {
      allowedPurposes: COMMITTEE_ASSET_PURPOSES,
      actorId: ACTOR_ID,
    })).toMatchObject({
      data: {
        bucket: 'event-covers',
        extension: 'webp',
        prefix: `${EVENT_ID}/covers`,
      },
    })

    for (const body of [
      { purpose: 'competition-banner', scopeId: EVENT_ID, contentType: 'image/png', sizeBytes: 10 },
      { purpose: 'event-cover', scopeId: 'not-a-uuid', contentType: 'image/png', sizeBytes: 10 },
      { purpose: 'event-cover', scopeId: EVENT_ID, contentType: 'image/svg+xml', sizeBytes: 10 },
      { purpose: 'event-cover', scopeId: EVENT_ID, contentType: 'image/png', sizeBytes: 6 * 1024 * 1024 },
    ]) {
      expect(inspectAssetUploadRequest(body, {
        allowedPurposes: COMMITTEE_ASSET_PURPOSES,
        actorId: ACTOR_ID,
      }).error).toBeTruthy()
    }
  })

  it('creates a random exact-path non-upsert token and returns only a branded asset path', async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { token: 'single-object-token', signedUrl: 'https://storage.invalid/private-token' },
      error: null,
    })
    const from = vi.fn(() => ({ createSignedUploadUrl }))
    const result = await issueSignedAssetUpload({
      supabase: { storage: { from } },
      input: {
        purpose: 'competition-banner',
        scopeId: EVENT_ID,
        contentType: 'image/jpeg',
        sizeBytes: 4096,
      },
      allowedPurposes: COMPETITION_ASSET_PURPOSES,
      actorId: ACTOR_ID,
      idFactory: () => FILE_ID,
    })

    const expectedPath = `${EVENT_ID}/banners/${FILE_ID}.jpg`
    expect(from).toHaveBeenCalledWith('competition-banners')
    expect(createSignedUploadUrl).toHaveBeenCalledWith(expectedPath, { upsert: false })
    expect(result).toEqual({
      data: {
        bucket: 'competition-banners',
        path: expectedPath,
        token: 'single-object-token',
        url: `/assets/competition-banners/${expectedPath}`,
        contentType: 'image/jpeg',
      },
    })
    expect(JSON.stringify(result)).not.toContain('signedUrl')
  })

  it('fails closed when Storage signing fails or omits the token', async () => {
    const signingError = new Error('storage unavailable')
    const failed = await issueSignedAssetUpload({
      supabase: {
        storage: { from: () => ({ createSignedUploadUrl: vi.fn().mockResolvedValue({ error: signingError }) }) },
      },
      input: { purpose: 'event-logo', scopeId: EVENT_ID, contentType: 'image/png', sizeBytes: 10 },
      allowedPurposes: COMMITTEE_ASSET_PURPOSES,
      actorId: ACTOR_ID,
    })
    expect(failed.serviceError).toBe(signingError)

    const malformed = await issueSignedAssetUpload({
      supabase: {
        storage: { from: () => ({ createSignedUploadUrl: vi.fn().mockResolvedValue({ data: {} }) }) },
      },
      input: { purpose: 'event-logo', scopeId: EVENT_ID, contentType: 'image/png', sizeBytes: 10 },
      allowedPurposes: COMMITTEE_ASSET_PURPOSES,
      actorId: ACTOR_ID,
    })
    expect(malformed.serviceError).toBeInstanceOf(Error)
  })

  it('finalizes only the exact issued path after verifying real Storage metadata', async () => {
    const info = vi.fn().mockResolvedValue({
      data: {
        bucketId: 'event-covers',
        size: 1024,
        contentType: 'image/webp',
      },
      error: null,
    })
    const storageFrom = vi.fn(() => ({ info }))
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const databaseFrom = vi.fn(() => ({ upsert }))
    const path = `${EVENT_ID}/covers/${FILE_ID}.webp`

    const result = await finalizeSignedAssetUpload({
      supabase: { storage: { from: storageFrom }, from: databaseFrom },
      input: {
        action: 'finalize',
        purpose: 'event-cover',
        scopeId: EVENT_ID,
        contentType: 'image/webp',
        sizeBytes: 1024,
        bucket: 'event-covers',
        path,
      },
      allowedPurposes: COMMITTEE_ASSET_PURPOSES,
      actorId: ACTOR_ID,
    })

    expect(info).toHaveBeenCalledWith(path)
    expect(databaseFrom).toHaveBeenCalledWith('admin_asset_upload_audit')
    expect(upsert).toHaveBeenCalledWith({
      actor_id: ACTOR_ID,
      purpose: 'event-cover',
      scope_id: EVENT_ID,
      bucket: 'event-covers',
      object_path: path,
      object_size: 1024,
      content_type: 'image/webp',
    }, {
      onConflict: 'bucket,object_path',
      ignoreDuplicates: true,
    })
    expect(result.data).toMatchObject({ path, url: `/assets/event-covers/${path}` })
  })

  it('rejects forged finalization paths and metadata without writing audit evidence', async () => {
    const upsert = vi.fn()
    const supabase = {
      storage: {
        from: () => ({
          info: vi.fn().mockResolvedValue({
            data: { bucketId: 'event-covers', size: 999, contentType: 'image/webp' },
            error: null,
          }),
        }),
      },
      from: () => ({ upsert }),
    }
    const base = {
      action: 'finalize',
      purpose: 'event-cover',
      scopeId: EVENT_ID,
      contentType: 'image/webp',
      sizeBytes: 1024,
      bucket: 'event-covers',
    }

    const forged = await finalizeSignedAssetUpload({
      supabase,
      input: { ...base, path: `${EVENT_ID}/covers/not-issued.webp` },
      allowedPurposes: COMMITTEE_ASSET_PURPOSES,
      actorId: ACTOR_ID,
    })
    expect(forged.error).toMatch(/path/i)

    const mismatch = await finalizeSignedAssetUpload({
      supabase,
      input: { ...base, path: `${EVENT_ID}/covers/${FILE_ID}.webp` },
      allowedPurposes: COMMITTEE_ASSET_PURPOSES,
      actorId: ACTOR_ID,
    })
    expect(mismatch.error).toMatch(/metadata/i)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('canonicalizes legacy public Storage URLs and enforces record ownership', () => {
    const raw = `https://project.supabase.co/storage/v1/object/public/competition-banners/${EVENT_ID}/old.webp`
    expect(canonicalAssetReference(raw, {
      bucket: 'competition-banners',
      scopeId: EVENT_ID,
    })).toEqual({
      value: `/assets/competition-banners/${EVENT_ID}/old.webp`,
      path: `${EVENT_ID}/old.webp`,
    })
    expect(canonicalAssetReference(raw, {
      bucket: 'competition-banners',
      scopeId: ACTOR_ID,
    }).error).toMatch(/belong/i)
    expect(canonicalAssetReference('https://example.org/banner.png', {
      bucket: 'competition-banners',
    }).error).toBeTruthy()
  })
})
