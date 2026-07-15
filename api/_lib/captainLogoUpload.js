import { randomUUID } from 'node:crypto'
import { extensionForMime, RASTER_IMAGE_TYPES } from '../../src/lib/uploadPolicy.js'

export const TEAM_LOGO_MAX_BYTES = 2 * 1024 * 1024

function hasExpectedImageSignature(bytes, contentType) {
  if (contentType === 'image/png') {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff
  }
  if (contentType === 'image/webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}

export function inspectCaptainLogoUpload(input) {
  const contentType = typeof input?.contentType === 'string'
    ? input.contentType.trim().toLowerCase()
    : ''
  if (!RASTER_IMAGE_TYPES.includes(contentType)) {
    return { error: 'Logo must be a PNG, JPEG, or WebP image.' }
  }

  const sizeBytes = Number(input?.sizeBytes)
  if (!Number.isSafeInteger(sizeBytes)
      || sizeBytes < 1
      || sizeBytes > TEAM_LOGO_MAX_BYTES) {
    return { error: 'Logo must be between 1 byte and 2 MB.' }
  }

  const dataBase64 = typeof input?.dataBase64 === 'string'
    ? input.dataBase64
    : ''
  if (!dataBase64
      || dataBase64.length % 4 !== 0
      || dataBase64.length > Math.ceil(TEAM_LOGO_MAX_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
    return { error: 'Logo data is not valid base64.' }
  }

  const bytes = Buffer.from(dataBase64, 'base64')
  if (bytes.length !== sizeBytes || bytes.toString('base64') !== dataBase64) {
    return { error: 'Logo size does not match the uploaded data.' }
  }
  if (!hasExpectedImageSignature(bytes, contentType)) {
    return { error: 'Logo contents do not match the selected image type.' }
  }

  return {
    data: {
      bytes,
      contentType,
      sizeBytes,
      extension: extensionForMime(contentType),
    },
  }
}

export function captainLogoObjectPath({ teamId, extension, uploadId }) {
  return `${teamId}/${uploadId}.${extension}`
}

export function teamLogoPathFromUrl(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = new URL(value, 'https://portal.invalid')
    const pathname = decodeURIComponent(parsed.pathname)
    for (const prefix of [
      '/storage/v1/object/public/team-logos/',
      '/assets/team-logos/',
    ]) {
      if (pathname.startsWith(prefix)) {
        const path = pathname.slice(prefix.length)
        return path && !path.includes('..') && !path.includes('\\') ? path : null
      }
    }
    return null
  } catch {
    return null
  }
}

export async function storeCaptainLogo({ supabase, input, teamId }) {
  const inspection = inspectCaptainLogoUpload(input)
  if (inspection.error) return inspection

  const { bytes, contentType, sizeBytes, extension } = inspection.data
  const path = captainLogoObjectPath({
    teamId,
    extension,
    uploadId: randomUUID(),
  })
  const storage = supabase.storage.from('team-logos')

  let uploaded
  try {
    uploaded = await storage.upload(path, bytes, {
      upsert: false,
      contentType,
      cacheControl: '0',
    })
  } catch (error) {
    return { serviceError: error }
  }
  if (uploaded?.error) return { serviceError: uploaded.error }

  const uploadedPath = uploaded?.data?.path ?? path
  const publicUrl = storage.getPublicUrl(uploadedPath)?.data?.publicUrl
  if (!publicUrl) {
    return { serviceError: new Error('Storage did not return a public logo URL.') }
  }

  return {
    data: {
      bucket: 'team-logos',
      path: uploadedPath,
      url: publicUrl,
      contentType,
      sizeBytes,
    },
  }
}
