import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()

vi.mock('./apiFetch.js', () => ({ apiFetch }))

const { encodeFileBase64, uploadCaptainLogo } = await import('./captainLogoUpload.js')

describe('captain logo client upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('encodes binary data without text conversion loss', async () => {
    const bytes = Uint8Array.from([0, 127, 128, 255])
    await expect(encodeFileBase64({
      arrayBuffer: async () => bytes.buffer,
    })).resolves.toBe('AH+A/w==')
  })

  it('sends the bytes through the authenticated, rate-limited captain API', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    apiFetch.mockResolvedValue({ url: 'https://storage.example/team-id/logo.png' })

    const result = await uploadCaptainLogo({
      file: {
        type: 'image/png',
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer,
      },
      eventId: 'event-id',
      teamId: 'team-id',
    })

    expect(result).toEqual({ url: 'https://storage.example/team-id/logo.png' })
    const request = apiFetch.mock.calls[0]
    expect(request[0]).toBe('/api/captain')
    expect(JSON.parse(request[1].body)).toEqual({
      action: 'upload-team-logo',
      eventId: 'event-id',
      teamId: 'team-id',
      contentType: 'image/png',
      sizeBytes: bytes.length,
      dataBase64: 'iVBORw==',
    })
  })
})
