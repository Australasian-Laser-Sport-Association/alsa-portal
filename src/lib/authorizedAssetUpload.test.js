import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
const from = vi.fn()

vi.mock('./apiFetch.js', () => ({ apiFetch }))
vi.mock('./supabase.js', () => ({ default: {}, supabase: { storage: { from } } }))

const { uploadAuthorizedAsset } = await import('./authorizedAssetUpload.js')

const endpoint = '/api/admin/event?resource=asset-upload'
const path = 'events/event-id/photos/11111111-1111-4111-8111-111111111111.jpg'
const authorization = {
  bucket: 'event-photos',
  path,
  token: 'single-object-token',
  url: `/assets/event-photos/${path}`,
}
const finalized = {
  bucket: 'event-photos',
  path,
  url: `/assets/event-photos/${path}`,
  contentType: 'image/jpeg',
  sizeBytes: 1234,
}

describe('authorised browser asset upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('issues a capability, uploads to its exact path, finalizes it, and returns the verified branded URL', async () => {
    apiFetch
      .mockResolvedValueOnce(authorization)
      .mockResolvedValueOnce(finalized)
    const uploadToSignedUrl = vi.fn().mockResolvedValue({
      data: { path },
      error: null,
    })
    from.mockReturnValue({ uploadToSignedUrl })
    const file = { type: 'image/jpeg', size: 1234 }

    await expect(uploadAuthorizedAsset({
      endpoint,
      purpose: 'event-photo',
      scopeId: 'event-id',
      file,
    })).resolves.toEqual({
      path,
      url: `/assets/event-photos/${path}`,
    })

    expect(apiFetch).toHaveBeenNthCalledWith(1, endpoint, {
      method: 'POST',
      body: JSON.stringify({
        action: 'issue',
        purpose: 'event-photo',
        scopeId: 'event-id',
        contentType: 'image/jpeg',
        sizeBytes: 1234,
      }),
    })
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      path,
      'single-object-token',
      file,
      { cacheControl: '3600', contentType: 'image/jpeg' },
    )
    expect(apiFetch).toHaveBeenNthCalledWith(2, endpoint, {
      method: 'POST',
      body: JSON.stringify({
        action: 'finalize',
        purpose: 'event-photo',
        scopeId: 'event-id',
        contentType: 'image/jpeg',
        sizeBytes: 1234,
        bucket: 'event-photos',
        path,
      }),
    })
  })

  it('fails closed on malformed authorisation and Storage errors without finalizing', async () => {
    apiFetch.mockResolvedValueOnce({ token: 'incomplete' })
    await expect(uploadAuthorizedAsset({
      endpoint,
      purpose: 'event-photo',
      file: { type: 'image/jpeg', size: 1 },
    })).rejects.toThrow(/authorisation response/i)
    expect(from).not.toHaveBeenCalled()

    vi.clearAllMocks()
    apiFetch.mockResolvedValueOnce(authorization)
    const uploadError = new Error('upload failed')
    from.mockReturnValue({
      uploadToSignedUrl: vi.fn().mockResolvedValue({ data: null, error: uploadError }),
    })
    await expect(uploadAuthorizedAsset({
      endpoint,
      purpose: 'event-photo',
      file: { type: 'image/jpeg', size: 1 },
    })).rejects.toBe(uploadError)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('propagates finalization failures and rejects a mismatched finalization response', async () => {
    const uploadToSignedUrl = vi.fn().mockResolvedValue({ data: { path }, error: null })
    from.mockReturnValue({ uploadToSignedUrl })
    const verificationError = new Error('server could not verify upload')
    apiFetch
      .mockResolvedValueOnce(authorization)
      .mockRejectedValueOnce(verificationError)

    await expect(uploadAuthorizedAsset({
      endpoint,
      purpose: 'event-photo',
      scopeId: 'event-id',
      file: { type: 'image/jpeg', size: 1234 },
    })).rejects.toBe(verificationError)

    vi.clearAllMocks()
    from.mockReturnValue({ uploadToSignedUrl })
    apiFetch
      .mockResolvedValueOnce(authorization)
      .mockResolvedValueOnce({ ...finalized, path: 'events/other/photos/forged.jpg' })

    await expect(uploadAuthorizedAsset({
      endpoint,
      purpose: 'event-photo',
      scopeId: 'event-id',
      file: { type: 'image/jpeg', size: 1234 },
    })).rejects.toThrow(/could not be verified/i)
  })
})
