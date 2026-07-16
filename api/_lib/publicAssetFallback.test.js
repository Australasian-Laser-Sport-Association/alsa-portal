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

  it('forwards a single byte range and preserves partial-content headers', async () => {
    const request = req()
    request.query = {
      resource: 'asset',
      bucket: 'referee-test-media',
      path: 'rules/demo.mp4',
    }
    request.headers.range = 'bytes=100-199'
    const fetch = vi.fn().mockResolvedValue(new Response('partial-video', {
      status: 206,
      headers: {
        'content-type': 'video/mp4',
        'content-range': 'bytes 100-199/1000',
        'accept-ranges': 'bytes',
      },
    }))
    vi.stubGlobal('fetch', fetch)

    const response = res()
    await handler(request, response)

    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Range: 'bytes=100-199' },
    }))
    expect(response.statusCode).toBe(206)
    expect(response.headers['content-range']).toBe('bytes 100-199/1000')
    expect(response.headers['accept-ranges']).toBe('bytes')
  })

  it('does not edge-cache mutable actor-owned logos', async () => {
    const request = req()
    request.query = {
      resource: 'asset',
      bucket: 'team-logos',
      path: 'team-id/logo.png',
    }
    getPublicUrl.mockReturnValue({
      data: {
        publicUrl: 'https://project.supabase.co/storage/v1/object/public/team-logos/team-id/logo.png',
      },
    })
    const fetch = vi.fn().mockResolvedValue(new Response('team-logo', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }))
    vi.stubGlobal('fetch', fetch)

    const response = res()
    await handler(request, response)

    expect(response.statusCode).toBe(200)
    expect(response.headers['Cache-Control']).toBe(
      'public, max-age=0, must-revalidate',
    )
  })

  it('propagates a validated mutable-asset revision to the upstream renderer', async () => {
    const request = req()
    request.query = {
      resource: 'asset',
      bucket: 'team-logos',
      path: 'team-id/upload-id.png',
      width: '160',
      format: 'webp',
      v: '1721048400000',
    }
    getPublicUrl.mockReturnValue({
      data: {
        publicUrl: 'https://project.supabase.co/storage/v1/object/public/team-logos/team-id/upload-id.png',
      },
    })
    const fetch = vi.fn().mockResolvedValue(new Response('team-logo', {
      status: 200,
      headers: { 'content-type': 'image/webp' },
    }))
    vi.stubGlobal('fetch', fetch)

    const response = res()
    await handler(request, response)

    expect(response.statusCode).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain(
      '/storage/v1/render/image/public/team-logos/team-id/upload-id.png',
    )
    expect(fetch.mock.calls[0][0]).toContain('v=1721048400000')
  })

  it('rejects an invalid mutable revision before contacting Storage', async () => {
    const request = req()
    request.query = {
      resource: 'asset',
      bucket: 'avatars',
      path: 'user-id/avatar.png',
      width: '128',
      v: 'unbounded revision',
    }
    getPublicUrl.mockReturnValue({
      data: {
        publicUrl: 'https://project.supabase.co/storage/v1/object/public/avatars/user-id/avatar.png',
      },
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const response = res()
    await handler(request, response)

    expect(response.statusCode).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not expose the raw actor upload when image rendering fails', async () => {
    const request = req()
    request.query = {
      resource: 'asset',
      bucket: 'team-logos',
      path: 'team-id/upload-id.png',
      width: '160',
      v: '1721048400000',
    }
    getPublicUrl.mockReturnValue({
      data: {
        publicUrl: 'https://project.supabase.co/storage/v1/object/public/team-logos/team-id/upload-id.png',
      },
    })
    const fetch = vi.fn().mockResolvedValue(new Response('renderer rejected image', {
      status: 502,
    }))
    vi.stubGlobal('fetch', fetch)

    const response = res()
    await handler(request, response)

    expect(response.statusCode).toBe(502)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('/storage/v1/render/image/public/')
  })
})
