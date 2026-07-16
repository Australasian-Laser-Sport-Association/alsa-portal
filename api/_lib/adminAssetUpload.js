import { randomUUID } from 'node:crypto'
import {
  brandedAssetPath,
  brandedAssetUrlFromSupabase,
} from './publicAsset.js'
import { isUuid } from './idValidation.js'
import { extensionForMime, RASTER_IMAGE_TYPES } from '../../src/lib/uploadPolicy.js'

const IMAGE_TYPES = Object.freeze([...RASTER_IMAGE_TYPES])
const VIDEO_TYPES = Object.freeze(['video/mp4', 'video/webm'])

const PURPOSES = Object.freeze({
  'event-logo': {
    bucket: 'event-logos',
    types: IMAGE_TYPES,
    maxBytes: 2 * 1024 * 1024,
    scopeRequired: true,
    prefix: ({ scopeId }) => `events/${scopeId}/logos`,
  },
  'event-photo': {
    bucket: 'event-photos',
    types: IMAGE_TYPES,
    maxBytes: 5 * 1024 * 1024,
    scopeRequired: true,
    prefix: ({ scopeId }) => `events/${scopeId}/photos`,
  },
  'event-cover': {
    bucket: 'event-covers',
    types: IMAGE_TYPES,
    maxBytes: 5 * 1024 * 1024,
    scopeRequired: true,
    prefix: ({ scopeId }) => `${scopeId}/covers`,
  },
  'history-logo': {
    bucket: 'event-logos',
    types: IMAGE_TYPES,
    maxBytes: 2 * 1024 * 1024,
    scopeRequired: true,
    prefix: ({ scopeId }) => `history/${scopeId}/logos`,
  },
  'history-photo': {
    bucket: 'event-photos',
    types: IMAGE_TYPES,
    maxBytes: 5 * 1024 * 1024,
    scopeRequired: true,
    prefix: ({ scopeId }) => `history/${scopeId}/photos`,
  },
  'referee-image': {
    bucket: 'referee-test-media',
    types: IMAGE_TYPES,
    maxBytes: 25 * 1024 * 1024,
    scopeRequired: false,
    prefix: ({ scopeId, actorId }) => scopeId
      ? `questions/${scopeId}/images`
      : `questions/_drafts/${actorId}/images`,
  },
  'referee-video': {
    bucket: 'referee-test-media',
    types: VIDEO_TYPES,
    maxBytes: 25 * 1024 * 1024,
    scopeRequired: false,
    prefix: ({ scopeId, actorId }) => scopeId
      ? `questions/${scopeId}/videos`
      : `questions/_drafts/${actorId}/videos`,
  },
  'competition-banner': {
    bucket: 'competition-banners',
    types: IMAGE_TYPES,
    maxBytes: 5 * 1024 * 1024,
    scopeRequired: true,
    // Keep the competition UUID as the first segment so the rollback policy
    // remains compatible with objects created through the signed-token path.
    prefix: ({ scopeId }) => `${scopeId}/banners`,
  },
})

export const COMMITTEE_ASSET_PURPOSES = Object.freeze(new Set([
  'event-logo',
  'event-photo',
  'event-cover',
  'history-logo',
  'history-photo',
  'referee-image',
  'referee-video',
]))

export const COMPETITION_ASSET_PURPOSES = Object.freeze(new Set([
  'competition-banner',
]))

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function relativeBrandedPath(value) {
  if (value.startsWith('/assets/')) return value
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'https:' && parsed.pathname.startsWith('/assets/')) {
      return parsed.pathname
    }
  } catch {
    // A raw Supabase URL gets a second parsing attempt below.
  }
  const converted = brandedAssetUrlFromSupabase(value)
  return converted === value ? null : converted
}

export function canonicalAssetReference(value, { bucket, scopeId = null } = {}) {
  if (value == null || value === '') return { value: null }
  if (typeof value !== 'string' || !bucket) return { error: 'Asset reference is invalid.' }

  const branded = relativeBrandedPath(value.trim())
  if (!branded || !branded.startsWith(`/assets/${bucket}/`)) {
    return { error: `Asset must use the ${bucket} bucket.` }
  }

  const pathname = branded.split(/[?#]/, 1)[0]
  const encodedPath = pathname.slice(`/assets/${bucket}/`.length)
  let objectPath
  try {
    objectPath = encodedPath.split('/').map(decodeURIComponent).join('/')
  } catch {
    return { error: 'Asset path is invalid.' }
  }
  const canonical = brandedAssetPath(bucket, objectPath)
  if (!canonical) return { error: 'Asset path is invalid.' }
  if (scopeId && objectPath.split('/')[0] !== scopeId) {
    return { error: 'Asset does not belong to this record.' }
  }
  return { value: canonical, path: objectPath }
}

export function inspectAssetUploadRequest(input, { allowedPurposes, actorId }) {
  if (!isPlainObject(input)) return { error: 'A JSON object body is required.' }
  if (!(allowedPurposes instanceof Set)) return { error: 'Asset upload policy is unavailable.' }
  if (!isUuid(actorId)) return { error: 'Asset upload actor is invalid.' }

  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : ''
  const policy = PURPOSES[purpose]
  if (!policy || !allowedPurposes.has(purpose)) {
    return { error: 'Asset upload purpose is not allowed.' }
  }

  const contentType = typeof input.contentType === 'string'
    ? input.contentType.trim().toLowerCase()
    : ''
  if (!policy.types.includes(contentType)) {
    return { error: 'File type is not allowed for this upload.' }
  }

  const sizeBytes = Number(input.sizeBytes)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > policy.maxBytes) {
    return { error: `File size must be between 1 and ${policy.maxBytes} bytes.` }
  }

  const scopeId = input.scopeId == null || input.scopeId === ''
    ? null
    : String(input.scopeId).trim()
  if ((policy.scopeRequired || scopeId) && !isUuid(scopeId)) {
    return { error: 'A valid upload scope is required.' }
  }

  const extension = extensionForMime(contentType)
  if (!extension) return { error: 'File type is not supported.' }

  return {
    data: {
      purpose,
      scopeId,
      bucket: policy.bucket,
      contentType,
      sizeBytes,
      extension,
      prefix: policy.prefix({ scopeId, actorId }),
    },
  }
}

function isIssuedPath(path, { prefix, extension }) {
  if (typeof path !== 'string' || path.length > 1024) return false
  const expectedPrefix = `${prefix}/`
  if (!path.startsWith(expectedPrefix)) return false
  const filename = path.slice(expectedPrefix.length)
  if (filename.includes('/')) return false
  const suffix = `.${extension}`
  return filename.endsWith(suffix) && isUuid(filename.slice(0, -suffix.length))
}

export async function finalizeSignedAssetUpload({
  supabase,
  input,
  allowedPurposes,
  actorId,
}) {
  const inspection = inspectAssetUploadRequest(input, { allowedPurposes, actorId })
  if (inspection.error) return inspection

  const {
    purpose,
    scopeId,
    bucket,
    contentType,
    sizeBytes,
    extension,
    prefix,
  } = inspection.data
  const path = typeof input.path === 'string' ? input.path.trim() : ''
  if (input.bucket !== bucket || !isIssuedPath(path, { prefix, extension })) {
    return { error: 'Uploaded asset path does not match its authorisation.' }
  }

  let info
  try {
    info = await supabase.storage.from(bucket).info(path)
  } catch (error) {
    return { serviceError: error }
  }
  if (info?.error) return { serviceError: info.error }

  const actualSize = Number(info?.data?.size)
  const actualType = String(info?.data?.contentType ?? '').trim().toLowerCase()
  if (!Number.isSafeInteger(actualSize)
      || actualSize !== sizeBytes
      || actualType !== contentType
      || (info.data.bucketId && info.data.bucketId !== bucket)) {
    return { error: 'Uploaded asset metadata does not match its authorisation.' }
  }

  const audit = await supabase
    .from('admin_asset_upload_audit')
    .upsert({
      actor_id: actorId,
      purpose,
      scope_id: scopeId,
      bucket,
      object_path: path,
      object_size: actualSize,
      content_type: actualType,
    }, {
      onConflict: 'bucket,object_path',
      ignoreDuplicates: true,
    })
  if (audit?.error) return { serviceError: audit.error }

  return {
    data: {
      bucket,
      path,
      url: brandedAssetPath(bucket, path),
      contentType: actualType,
      sizeBytes: actualSize,
    },
  }
}

export async function issueSignedAssetUpload({
  supabase,
  input,
  allowedPurposes,
  actorId,
  idFactory = randomUUID,
}) {
  const inspection = inspectAssetUploadRequest(input, { allowedPurposes, actorId })
  if (inspection.error) return inspection

  const { bucket, contentType, extension, prefix } = inspection.data
  const path = `${prefix}/${idFactory()}.${extension}`
  const assetUrl = brandedAssetPath(bucket, path)
  if (!assetUrl) return { error: 'Could not create a safe public asset path.' }

  let result
  try {
    result = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false })
  } catch (error) {
    return { serviceError: error }
  }

  if (result?.error) return { serviceError: result.error }
  if (!result?.data?.token) {
    return { serviceError: new Error('Storage did not return a signed upload token.') }
  }

  return {
    data: {
      bucket,
      path,
      token: result.data.token,
      url: assetUrl,
      contentType,
    },
  }
}
