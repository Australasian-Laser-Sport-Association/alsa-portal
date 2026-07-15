const SUPABASE_OBJECT_PREFIX = '/storage/v1/object/public/'
const SUPABASE_RENDER_PREFIX = '/storage/v1/render/image/public/'
const MUTABLE_ACTOR_ASSET_BUCKETS = new Set(['avatars', 'team-logos'])

export const PUBLIC_ASSET_BUCKETS = Object.freeze({
  avatars: {
    route: 'assets',
    types: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    render: true,
  },
  'team-logos': {
    route: 'assets',
    types: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    render: true,
  },
  'event-logos': {
    route: 'assets',
    types: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    render: true,
  },
  'event-photos': {
    route: 'assets',
    types: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    render: true,
  },
  'event-covers': {
    route: 'assets',
    types: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    render: true,
  },
  'competition-banners': {
    route: 'assets',
    types: ['image/png', 'image/jpeg', 'image/webp'],
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    render: true,
  },
  'referee-test-media': {
    route: 'assets',
    types: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'],
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm'],
    render: true,
  },
  'legal-documents': {
    route: 'documents',
    types: ['application/pdf'],
    extensions: ['pdf'],
    render: false,
  },
})

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function normalizePathSegments(segments) {
  const decoded = []

  for (const segment of segments) {
    const value = safeDecode(segment)
    if (!value) return null
    decoded.push(value)
  }

  return decoded.join('/')
}

export function splitPublicStoragePath(pathname) {
  const prefix = pathname.startsWith(SUPABASE_OBJECT_PREFIX)
    ? SUPABASE_OBJECT_PREFIX
    : pathname.startsWith(SUPABASE_RENDER_PREFIX)
      ? SUPABASE_RENDER_PREFIX
      : null

  if (!prefix) return null

  const segments = pathname.slice(prefix.length).split('/')
  if (segments.length < 2) return null

  const bucket = safeDecode(segments[0])
  const objectPath = normalizePathSegments(segments.slice(1))
  if (!bucket || !objectPath) return null

  return { bucket, objectPath }
}

export function isValidPublicAssetPath(path) {
  return Boolean(
    path
      && typeof path === 'string'
      && path.length <= 1024
      && !path.startsWith('/')
      && !path.includes('\\')
      && !path.split('/').some(segment => !segment || segment === '.' || segment === '..')
      && ![...path].some(char => {
        const code = char.charCodeAt(0)
        return code <= 31 || code === 127
      }),
  )
}

export function extensionForPath(path) {
  const filename = path.split('/').pop() ?? ''
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

export function isAllowedPublicAsset(bucket, path) {
  const policy = PUBLIC_ASSET_BUCKETS[bucket]
  if (!policy || !isValidPublicAssetPath(path)) return false

  const extension = extensionForPath(path)
  return policy.extensions.includes(extension)
}

export function brandedAssetPath(bucket, objectPath, params = {}) {
  if (!isAllowedPublicAsset(bucket, objectPath)) return null

  const policy = PUBLIC_ASSET_BUCKETS[bucket]
  const path = encodePath(objectPath)
  const route = policy.route === 'documents'
    ? `/documents/${path}`
    : `/assets/${encodeURIComponent(bucket)}/${path}`
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') query.set(key, String(value))
  }

  const queryString = query.toString()
  return queryString ? `${route}?${queryString}` : route
}

export function brandedAssetUrlFromSupabase(url, params = {}) {
  if (!url) return url

  try {
    const parsed = new URL(url)
    const storagePath = splitPublicStoragePath(parsed.pathname)
    if (!storagePath) return url

    return brandedAssetPath(storagePath.bucket, storagePath.objectPath, params) ?? url
  } catch {
    return url
  }
}

export function normalizeQueryValue(value) {
  if (Array.isArray(value)) return value[0]
  return value
}

export function isMutableActorAssetBucket(bucket) {
  return MUTABLE_ACTOR_ASSET_BUCKETS.has(bucket)
}

export function validatedMutableAssetRevision(value) {
  const normalized = normalizeQueryValue(value)
  if (normalized == null || normalized === '') return null

  const revision = String(normalized)
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/.test(revision)
    ? revision
    : null
}

export function isAllowedContentType(bucket, contentType) {
  const policy = PUBLIC_ASSET_BUCKETS[bucket]
  const normalized = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  return Boolean(policy && policy.types.includes(normalized))
}

export function sanitizeFilename(path) {
  const filename = path.split('/').pop() || 'download'
  return filename.replace(/[^A-Za-z0-9._-]/g, '_')
}

export function validatedRenderParams(query) {
  const width = normalizeQueryValue(query.width)
  const quality = normalizeQueryValue(query.quality)
  const resize = normalizeQueryValue(query.resize)
  const format = normalizeQueryValue(query.format)
  const params = new URLSearchParams()

  if (width != null) {
    const parsed = Number.parseInt(width, 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2400) return null
    params.set('width', String(parsed))
  }

  if (quality != null) {
    const parsed = Number.parseInt(quality, 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 95) return null
    params.set('quality', String(parsed))
  }

  if (resize != null) {
    if (!['cover', 'contain', 'fill'].includes(resize)) return null
    params.set('resize', resize)
  }

  if (format != null) {
    if (!['webp', 'origin'].includes(format)) return null
    params.set('format', format)
  }

  return params
}

export function shouldUseImageRenderer(bucket, query) {
  const policy = PUBLIC_ASSET_BUCKETS[bucket]
  return Boolean(policy?.render && normalizeQueryValue(query.width))
}
