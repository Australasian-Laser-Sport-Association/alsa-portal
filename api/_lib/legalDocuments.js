import { createHash, randomUUID } from 'node:crypto'

export const LEGAL_DOCUMENT_BUCKET = 'legal-documents'
export const MAX_LEGAL_PDF_BYTES = 4 * 1024 * 1024
export const LEGAL_DOCUMENT_TYPES = new Set([
  'code_of_conduct',
  'media_release',
  'under_18_form',
])

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : ''
}

function decodeHeader(headers, name, maxLength) {
  const value = headerValue(headers, name)
  if (!value) return ''
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length <= maxLength ? decoded : ''
  } catch {
    return ''
  }
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function requestBuffer(body) {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  return null
}

function unsafeFilename(value) {
  if (value.includes('/') || value.includes('\\')) return true
  return [...value].some(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

export function inspectLegalPdfRequest(req) {
  const documentType = headerValue(req.headers, 'x-legal-document-type').trim()
  const originalFilename = decodeHeader(req.headers, 'x-legal-original-filename', 255).trim()
  const effectiveDate = headerValue(req.headers, 'x-legal-effective-date').trim()
  const requiresReacceptanceHeader = headerValue(req.headers, 'x-legal-requires-reacceptance').trim()
  const notesValue = decodeHeader(req.headers, 'x-legal-notes', 2000).trim()
  const declaredMime = headerValue(req.headers, 'x-file-content-type')
    .split(';')[0]
    .trim()
    .toLowerCase()
  const transportMime = headerValue(req.headers, 'content-type')
    .split(';')[0]
    .trim()
    .toLowerCase()

  if (!LEGAL_DOCUMENT_TYPES.has(documentType)) {
    return { error: 'A valid policy or form type is required.' }
  }
  if (
    !originalFilename
    || originalFilename.length > 255
    || unsafeFilename(originalFilename)
    || !originalFilename.toLowerCase().endsWith('.pdf')
  ) {
    return { error: 'A valid PDF filename is required.' }
  }
  if (!validIsoDate(effectiveDate)) {
    return { error: 'A valid effective date is required.' }
  }
  if (!['true', 'false'].includes(requiresReacceptanceHeader)) {
    return { error: 'The re-acceptance setting is required.' }
  }
  if (declaredMime !== 'application/pdf') {
    return { error: 'The uploaded file must declare the PDF MIME type.' }
  }
  if (transportMime !== 'application/octet-stream') {
    return { error: 'The PDF must be uploaded as a binary request.' }
  }

  const bytes = requestBuffer(req.body)
  if (!bytes) return { error: 'The PDF request body was not binary.' }
  if (bytes.length < 8) return { error: 'The PDF is empty or truncated.' }
  if (bytes.length > MAX_LEGAL_PDF_BYTES) {
    return { error: `The PDF exceeds the ${MAX_LEGAL_PDF_BYTES / 1024 / 1024} MB limit.` }
  }
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    return { error: 'The uploaded file does not appear to be a valid PDF file.' }
  }
  if (!bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from('%%EOF', 'ascii'))) {
    return { error: 'The uploaded PDF appears to be truncated.' }
  }

  const digest = createHash('sha256').update(bytes).digest('hex')
  const objectPath = `legal/${documentType}/${randomUUID()}.pdf`

  return {
    value: {
      bytes,
      documentType,
      originalFilename,
      effectiveDate,
      requiresReacceptance: requiresReacceptanceHeader === 'true',
      notes: notesValue || null,
      contentSha256: digest,
      objectSize: bytes.length,
      objectPath,
    },
  }
}

export function brandedLegalDocumentPath(objectPath) {
  if (typeof objectPath !== 'string' || !objectPath) return null
  const segments = objectPath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  return `/documents/${segments.map(encodeURIComponent).join('/')}`
}
