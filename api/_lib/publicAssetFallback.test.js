import { beforeEach, describe, expect, it, vi } from 'vitest'

const enforceRateLimit = vi.fn()
const getPublicUrl = vi.fn()

vi.mock('./rateLimit.js', () => ({
  clientIp: vi.fn(() => '127.0.0.1'),
  enforceRateLimit,
}))

vi.mock('./supabase.js', () => ({
  default: {
    storage: {
      from: vi.fn(() => ({
        getPublicUrl,
      })),
    },
  },
}))

const { default: handler } = await import('../public.js')

function req() {
  return {
    method: 'GET',
    query: {
      resource: 'asset',
      bucket: 'event-covers',
      path: 'event-id/cover.png',
      width: '1280',
      quality: '72',
      resize: 'cover',
      format: 'webp',
    },
    headers: { host: 'preview.vercel.app' },
  }
}

function res() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    send(body) { this.body = body; return this },
    end() { return this },
  }
}

describe('public asset proxy renderer fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enforceRateLimit.mockResolvedValue(true)
    getPublicUrl.mockReturnValue({
      data: {
        publicUrl: 'https://project.supabase.co/storage/v1/object/public/event-covers/event-id/cover.png',
      },
    })
  })

  it('serves the original image when Supabase image rendering fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('renderer failed', { status: 502 }))
      .mockResolvedValueOnce(new Response('raw-image', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }))
    vi.stubGlobal('fetch', fetch)

    const response = res()
    await handler(req(), response)

    expect(response.statusCode).toBe(200)
    expect(Buffer.isBuffer(response.body)).toBe(true)
    expect(response.body.toString()).toBe('raw-image')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][0]).toContain('/storage/v1/render/image/public/event-covers/event-id/cover.png')
    expect(fetch.mock.calls[1][0]).toContain('/storage/v1/object/public/event-covers/event-id/cover.png')
  })
})
