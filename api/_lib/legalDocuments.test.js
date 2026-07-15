import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_LEGAL_PDF_BYTES,
  brandedLegalDocumentPath,
  inspectLegalPdfRequest,
} from './legalDocuments.js'

function request(overrides = {}) {
  return {
    headers: {
      'content-type': 'application/octet-stream',
      'x-file-content-type': 'application/pdf',
      'x-legal-document-type': 'code_of_conduct',
      'x-legal-original-filename': encodeURIComponent('Code of Conduct.pdf'),
      'x-legal-effective-date': '2026-07-13',
      'x-legal-requires-reacceptance': 'true',
      'x-legal-notes': encodeURIComponent('Annual update'),
      ...(overrides.headers ?? {}),
    },
    body: overrides.body ?? Buffer.from('%PDF-1.7\nvalid test data\n%%EOF', 'ascii'),
  }
}

describe('legal PDF publication inspection', () => {
  it('validates binary PDF evidence and derives its digest and UUID path', () => {
    const req = request()
    const result = inspectLegalPdfRequest(req)

    expect(result.error).toBeUndefined()
    expect(result.value).toMatchObject({
      documentType: 'code_of_conduct',
      originalFilename: 'Code of Conduct.pdf',
      effectiveDate: '2026-07-13',
      requiresReacceptance: true,
      notes: 'Annual update',
      objectSize: req.body.length,
      contentSha256: createHash('sha256').update(req.body).digest('hex'),
    })
    expect(result.value.objectPath).toMatch(
      /^legal\/code_of_conduct\/[0-9a-f-]{36}\.pdf$/,
    )
  })

  it.each([
    ['wrong MIME', { headers: { 'x-file-content-type': 'text/html' } }, /MIME type/],
    ['wrong transport', { headers: { 'content-type': 'application/json' } }, /binary request/],
    ['wrong signature', { body: Buffer.from('<html>not pdf</html>') }, /PDF signature/],
    ['missing end marker', { body: Buffer.from('%PDF-1.7 unfinished') }, /truncated/],
    ['non-binary body', { body: '%PDF-1.7 string' }, /not binary/],
    ['invalid type', { headers: { 'x-legal-document-type': 'terms' } }, /valid legal document type/],
  ])('rejects %s', (_label, override, pattern) => {
    const req = request(override)
    expect(inspectLegalPdfRequest(req).error).toMatch(pattern)
  })

  it('rejects PDFs larger than the server request budget', () => {
    const body = Buffer.alloc(MAX_LEGAL_PDF_BYTES + 1, 0)
    body.write('%PDF-')
    expect(inspectLegalPdfRequest(request({ body })).error).toMatch(/4 MB limit/)
  })

  it('builds a branded URL without exposing the storage origin', () => {
    expect(brandedLegalDocumentPath('legal/media_release/file name.pdf')).toBe(
      '/documents/legal/media_release/file%20name.pdf',
    )
    expect(brandedLegalDocumentPath('../secret.pdf')).toBeNull()
  })
})
