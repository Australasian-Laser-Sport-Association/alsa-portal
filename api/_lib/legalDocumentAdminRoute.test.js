import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const upload = vi.fn()
const remove = vi.fn()
const storageFrom = vi.fn(() => ({ upload, remove }))
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: {
    from,
    rpc,
    storage: { from: storageFrom },
  },
}))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin: vi.fn(),
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./serverTelemetry.js', () => ({ captureServerException: vi.fn() }))

const { default: handler } = await import('../admin/event.js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174021'
const DOCUMENT_ID = '123e4567-e89b-42d3-a456-426614174022'

function request(body = Buffer.from('%PDF-1.7\nroute test\n%%EOF', 'ascii')) {
  return {
    method: 'POST',
    query: { resource: 'required-documents', action: 'publish' },
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-content-type': 'application/pdf',
      'x-legal-document-type': 'media_release',
      'x-legal-original-filename': encodeURIComponent('Media Release.pdf'),
      'x-legal-effective-date': '2026-07-13',
      'x-legal-requires-reacceptance': 'true',
      'x-legal-notes': encodeURIComponent('Updated release'),
    },
    body,
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function publishedDocument(args, overrides = {}) {
  return {
    id: DOCUMENT_ID,
    document_type: args.p_document_type,
    version: 4,
    file_path: args.p_file_path,
    original_filename: args.p_original_filename,
    effective_date: args.p_effective_date,
    uploaded_by: args.p_uploaded_by,
    uploaded_at: '2026-07-13T00:00:00.000Z',
    is_active: true,
    requires_reacceptance: args.p_requires_reacceptance,
    notes: args.p_notes,
    content_sha256: args.p_content_sha256,
    object_size: args.p_object_size,
    published_at: '2026-07-13T00:00:00.000Z',
    ...overrides,
  }
}

function queueReconciliation(dataOrFactory = null, error = null) {
  rpc.mockImplementationOnce(async () => ({
    data: typeof dataOrFactory === 'function' ? dataOrFactory() : dataOrFactory,
    error,
  }))
}

describe('required-document admin API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    upload.mockResolvedValue({ data: { path: 'unused' }, error: null })
    remove.mockResolvedValue({ data: [], error: null })
  })

  it('validates, hashes, uploads and atomically publishes a PDF', async () => {
    const req = request()
    let committedDocument = null
    rpc.mockImplementationOnce(async (_name, args) => ({
      data: (committedDocument = publishedDocument(args)),
      error: null,
    }))
    queueReconciliation(() => committedDocument)

    const res = response()
    await handler(req, res)

    expect(res.statusCode).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.document.url).toMatch(
      /^\/documents\/legal\/media_release\/[0-9a-f-]{36}\.pdf$/,
    )
    expect(storageFrom).toHaveBeenCalledWith('legal-documents')
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^legal\/media_release\/[0-9a-f-]{36}\.pdf$/),
      req.body,
      { contentType: 'application/pdf', cacheControl: '3600', upsert: false },
    )
    expect(rpc).toHaveBeenCalledWith('publish_legal_document', expect.objectContaining({
      p_document_type: 'media_release',
      p_original_filename: 'Media Release.pdf',
      p_uploaded_by: USER_ID,
      p_content_sha256: createHash('sha256').update(req.body).digest('hex'),
      p_object_size: req.body.length,
    }))
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'reconcile_legal_document_publication',
      {
        p_document_type: committedDocument.document_type,
        p_file_path: committedDocument.file_path,
        p_content_sha256: committedDocument.content_sha256,
        p_object_size: committedDocument.object_size,
      },
    )
    expect(from).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('rejects spoofed non-PDF bytes before storage is touched', async () => {
    const res = response()
    await handler(request(Buffer.from('<script>alert(1)</script>')), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/valid PDF file/)
    expect(storageFrom).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('removes an uploaded object when the database transaction fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } })
    queueReconciliation(null)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(500)
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(/^legal\/media_release\/[0-9a-f-]{36}\.pdf$/),
    ])
    expect(rpc).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('treats a matching committed row as success after an RPC transport failure', async () => {
    let committedDocument = null
    rpc.mockImplementationOnce(async (_name, args) => {
      committedDocument = publishedDocument(args)
      throw new Error('connection closed after commit')
    })
    queueReconciliation(() => committedDocument)

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.document.id).toBe(DOCUMENT_ID)
    expect(remove).not.toHaveBeenCalled()
  })

  it('reloads a matching committed row when the RPC result is malformed', async () => {
    let committedDocument = null
    rpc.mockImplementationOnce(async (_name, args) => {
      committedDocument = publishedDocument(args)
      return { data: null, error: null }
    })
    queueReconciliation(() => committedDocument)

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.document.id).toBe(DOCUMENT_ID)
    expect(remove).not.toHaveBeenCalled()
  })

  it('never removes storage when reconciliation itself fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'RPC timeout' } })
    queueReconciliation(null, { message: 'reconciliation unavailable' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(500)
    expect(remove).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('never removes storage after a reported RPC success without a reloadable row', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    queueReconciliation(null)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = response()
    await handler(request(), res)

    expect(res.statusCode).toBe(500)
    expect(remove).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('lists committee history without using browser table access', async () => {
    const secondOrder = vi.fn().mockResolvedValue({
      data: [{
        id: DOCUMENT_ID,
        file_path: 'legal/media_release/123e4567-e89b-42d3-a456-426614174022.pdf',
        published_at: '2026-07-13T00:00:00.000Z',
        is_active: true,
      }],
      error: null,
    })
    const firstOrder = vi.fn(() => ({ order: secondOrder }))
    const select = vi.fn(() => ({ order: firstOrder }))
    from.mockReturnValueOnce({ select })

    const req = request()
    req.method = 'GET'
    req.query = { resource: 'required-documents' }
    req.body = undefined
    const res = response()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.documents[0].url).toBe(
      '/documents/legal/media_release/123e4567-e89b-42d3-a456-426614174022.pdf',
    )
    expect(from).toHaveBeenCalledWith('legal_documents')
  })
})
