import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const enforceRateLimit = vi.fn()
const from = vi.fn()
const createSignedUrl = vi.fn()
const getPublicUrl = vi.fn()
const storageFrom = vi.fn(() => ({ createSignedUrl, getPublicUrl }))

vi.mock('./rateLimit.js', () => ({
  clientIp: vi.fn(() => '127.0.0.1'),
  enforceRateLimit,
}))

vi.mock('./supabase.js', () => ({
  default: {
    from,
    storage: { from: storageFrom },
  },
}))

const { default: handler } = await import('../public.js')

const PATH = 'legal/code_of_conduct/123e4567-e89b-42d3-a456-426614174031.pdf'

function response() {
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

function legalLookup(data) {
  const query = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.not = vi.fn(() => query)
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  return query
}

describe('public required-document delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enforceRateLimit.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves an active publication through a short-lived private-storage URL', async () => {
    const query = legalLookup({ id: 'document-1', original_filename: 'Code of Conduct.pdf' })
    from.mockReturnValueOnce(query)
    createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://storage.example/private/signed-token' },
      error: null,
    })
    const fetch = vi.fn().mockResolvedValue(new Response('%PDF-1.7', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }))
    vi.stubGlobal('fetch', fetch)

    const res = response()
    await handler({
      method: 'GET',
      query: { resource: 'asset', bucket: 'legal-documents', path: PATH },
      headers: { host: 'portal.example' },
    }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.toString()).toBe('%PDF-1.7')
    expect(query.eq).toHaveBeenCalledWith('is_active', true)
    expect(query.not).toHaveBeenCalledWith('published_at', 'is', null)
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, 60)
    expect(fetch).toHaveBeenCalledWith(
      'https://storage.example/private/signed-token',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(res.headers['Content-Disposition']).toBe(
      'inline; filename="Code_of_Conduct.pdf"',
    )
    expect(res.headers['Cache-Control']).toBe('private, no-store, max-age=0')
  })

  it('does not sign or fetch an inactive or unknown legal object', async () => {
    from.mockReturnValueOnce(legalLookup(null))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const res = response()
    await handler({
      method: 'GET',
      query: { resource: 'asset', bucket: 'legal-documents', path: PATH },
      headers: { host: 'portal.example' },
    }, res)

    expect(res.statusCode).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists only safe metadata and branded URLs', async () => {
    const document = {
      id: 'document-1',
      document_type: 'code_of_conduct',
      version: 2,
      file_path: PATH,
      original_filename: 'Code of Conduct.pdf',
      effective_date: '2026-07-13',
      requires_reacceptance: true,
      content_sha256: 'a'.repeat(64),
      object_size: 1024,
      published_at: '2026-07-13T00:00:00.000Z',
      uploaded_by: 'must-not-leak',
      notes: 'must-not-leak',
    }
    const query = {}
    query.select = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.not = vi.fn(() => query)
    query.order = vi.fn().mockResolvedValue({ data: [document], error: null })
    from.mockReturnValueOnce(query)

    const res = response()
    await handler({
      method: 'GET',
      query: { resource: 'required-documents' },
      headers: {},
    }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.documents).toEqual([expect.objectContaining({
      id: 'document-1',
      url: `/documents/${PATH}`,
      content_sha256: 'a'.repeat(64),
    })])
    expect(res.body.documents[0]).not.toHaveProperty('file_path')
    expect(res.body.documents[0]).not.toHaveProperty('uploaded_by')
    expect(res.body.documents[0]).not.toHaveProperty('notes')
  })
})
