export const RASTER_IMAGE_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
])

const EXTENSION_BY_MIME = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
})

export function extensionForMime(mimeType) {
  return EXTENSION_BY_MIME[mimeType] ?? null
}

