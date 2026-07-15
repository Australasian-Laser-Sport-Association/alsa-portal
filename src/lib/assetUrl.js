const OBJECT_PREFIX = '/storage/v1/object/public/'

const PUBLIC_BUCKETS = new Set([
  'avatars',
  'team-logos',
  'event-logos',
  'event-photos',
  'event-covers',
  'competition-banners',
  'referee-test-media',
  'legal-documents',
])

const MEDIA_BUCKETS = new Set([
  'avatars',
  'team-logos',
  'event-logos',
  'event-photos',
  'event-covers',
  'competition-banners',
  'referee-test-media',
])

function decodePathSegments(segments) {
  try {
    return segments.map(segment => decodeURIComponent(segment))
  } catch {
    return null
  }
}

function parsePublicStorageUrl(url) {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname.startsWith(OBJECT_PREFIX)) return null

    const segments = parsed.pathname.slice(OBJECT_PREFIX.length).split('/')
    if (segments.length < 2) return null

    const decoded = decodePathSegments(segments)
    if (!decoded) return null

    const [bucket, ...pathSegments] = decoded
    const path = pathSegments.join('/')
    if (!PUBLIC_BUCKETS.has(bucket) || !path) return null

    return { bucket, path }
  } catch {
    return null
  }
}

function parseBrandedStorageUrl(url) {
  try {
    const pathname = url.startsWith('/')
      ? url.split(/[?#]/, 1)[0]
      : new URL(url).pathname
    const route = pathname.startsWith('/assets/')
      ? 'assets'
      : pathname.startsWith('/documents/')
        ? 'documents'
        : null
    if (!route) return null

    const segments = pathname.slice(route === 'assets' ? '/assets/'.length : '/documents/'.length).split('/')
    const bucket = route === 'assets' ? decodeURIComponent(segments.shift() ?? '') : 'legal-documents'
    const decoded = decodePathSegments(segments)
    if (!decoded) return null
    const path = decoded.join('/')
    if (!PUBLIC_BUCKETS.has(bucket)
        || !path
        || decoded.some(segment => !segment || segment === '.' || segment === '..')) {
      return null
    }
    return { bucket, path }
  } catch {
    return null
  }
}

function parseStorageReference(url) {
  return parsePublicStorageUrl(url) ?? parseBrandedStorageUrl(url)
}

function encodeStoragePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function assetBaseUrl() {
  return (import.meta.env.VITE_PUBLIC_ASSET_BASE_URL ?? '').replace(/\/+$/, '')
}

function brandedStoragePath(bucket, path, params = {}) {
  const encodedPath = encodeStoragePath(path)
  const route = bucket === 'legal-documents'
    ? `/documents/${encodedPath}`
    : `/assets/${encodeURIComponent(bucket)}/${encodedPath}`
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') query.set(key, String(value))
  }

  const queryString = query.toString()
  const brandedPath = queryString ? `${route}?${queryString}` : route
  return `${assetBaseUrl()}${brandedPath}`
}

export function maskStorageUrl(url) {
  const storagePath = parseStorageReference(url)
  if (!storagePath) return url
  return brandedStoragePath(storagePath.bucket, storagePath.path)
}

export function storageImageUrl(url, {
  width,
  quality = 75,
  resize = 'contain',
  format = 'webp',
} = {}) {
  if (!url) return url

  const storagePath = parseStorageReference(url)
  if (!storagePath || !MEDIA_BUCKETS.has(storagePath.bucket)) return url
  if (!width) return brandedStoragePath(storagePath.bucket, storagePath.path)

  return brandedStoragePath(storagePath.bucket, storagePath.path, {
    width,
    quality,
    resize,
    format,
  })
}

export function storageImageSrcSet(url, widths, options = {}) {
  if (!url || !Array.isArray(widths) || widths.length === 0) return undefined
  const entries = widths
    .map(width => {
      const imageUrl = storageImageUrl(url, { ...options, width })
      return imageUrl && imageUrl !== url ? `${imageUrl} ${width}w` : null
    })
    .filter(Boolean)
  return entries.length > 0 ? entries.join(', ') : undefined
}
