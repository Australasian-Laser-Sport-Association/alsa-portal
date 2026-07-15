import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { isUuid } from './idValidation.js'

export const PROFILE_HANDLE_PURPOSES = Object.freeze({
  COMPETITION_MANAGER_GRANT: 'competition-manager-grant',
  COMPETITION_TEAM_INVITE: 'competition-team-invite',
  ZLTAC_CAPTAIN_ROSTER: 'zltac-captain-roster',
  ZLTAC_DOUBLES_PARTNER: 'zltac-doubles-partner',
  ZLTAC_TRIPLES_PARTNER: 'zltac-triples-partner',
})

const HANDLE_PREFIX = 'oph1'
const HANDLE_AAD = Buffer.from('alsa:opaque-profile-handle:v1', 'utf8')
const DEFAULT_TTL_SECONDS = 5 * 60
const MAX_TTL_SECONDS = 10 * 60
const MAX_HANDLE_LENGTH = 2048
const PURPOSE_SET = new Set(Object.values(PROFILE_HANDLE_PURPOSES))
const SCOPED_PURPOSES = new Set([
  PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
  PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER,
  PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER,
])

export class OpaqueProfileHandleError extends Error {
  constructor() {
    super('Invalid or expired profile handle')
    this.name = 'OpaqueProfileHandleError'
  }
}

export class ProfileHandleConfigurationError extends Error {
  constructor() {
    super('SUPABASE_SERVICE_ROLE_KEY is required to protect profile handles')
    this.name = 'ProfileHandleConfigurationError'
  }
}

function secretKey(explicitSecret) {
  const secret = explicitSecret ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new ProfileHandleConfigurationError()
  }

  // Key separation ensures the service-role value is never used as raw AES
  // key material and keeps this token format isolated from other HMAC or
  // encryption uses that may be added later.
  return createHash('sha256')
    .update('alsa:opaque-profile-handle:key:v1\0', 'utf8')
    .update(secret, 'utf8')
    .digest()
}

function requirePurpose(purpose) {
  if (!PURPOSE_SET.has(purpose)) throw new OpaqueProfileHandleError()
}

function normalizedScope(scope, purpose) {
  if (scope == null) {
    if (SCOPED_PURPOSES.has(purpose)) throw new OpaqueProfileHandleError()
    return null
  }
  if (typeof scope !== 'string' || scope.length < 1 || scope.length > 128) {
    throw new OpaqueProfileHandleError()
  }
  return scope
}

/**
 * Issues an authenticated, encrypted, actor-bound profile selector.
 *
 * The profile UUID is ciphertext, not a signed plaintext payload. A browser
 * can return this handle to the matching write endpoint but cannot recover or
 * alter the target UUID, purpose, actor, issue time, or expiry.
 */
export function issueOpaqueProfileHandle({
  profileId,
  purpose,
  actorId,
  scope,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = Date.now(),
  secret,
}) {
  if (!isUuid(profileId) || !isUuid(actorId)) throw new OpaqueProfileHandleError()
  requirePurpose(purpose)
  const boundScope = normalizedScope(scope, purpose)
  if (
    !Number.isFinite(now)
    || !Number.isInteger(ttlSeconds)
    || ttlSeconds < 1
    || ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new OpaqueProfileHandleError()
  }

  const issuedAt = Math.floor(now / 1000)
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    s: profileId,
    p: purpose,
    a: actorId,
    c: boundScope,
    i: issuedAt,
    e: issuedAt + ttlSeconds,
  }), 'utf8')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(secret), iv)
  cipher.setAAD(HANDLE_AAD)
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    HANDLE_PREFIX,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    authTag.toString('base64url'),
  ].join('.')
}

/**
 * Verifies and decrypts a profile selector for one actor and one operation.
 * All malformed, tampered, wrong-purpose, wrong-actor, and expired inputs use
 * one public error so callers do not gain an oracle over token contents.
 */
export function verifyOpaqueProfileHandle({
  handle,
  purpose,
  actorId,
  scope,
  now = Date.now(),
  secret,
}) {
  const key = secretKey(secret)

  try {
    requirePurpose(purpose)
    const expectedScope = normalizedScope(scope, purpose)
    if (
      !Number.isFinite(now)
      || !isUuid(actorId)
      || typeof handle !== 'string'
      || handle.length > MAX_HANDLE_LENGTH
    ) {
      throw new OpaqueProfileHandleError()
    }

    const parts = handle.split('.')
    if (parts.length !== 4 || parts[0] !== HANDLE_PREFIX) {
      throw new OpaqueProfileHandleError()
    }

    const iv = Buffer.from(parts[1], 'base64url')
    const ciphertext = Buffer.from(parts[2], 'base64url')
    const authTag = Buffer.from(parts[3], 'base64url')
    if (iv.length !== 12 || ciphertext.length === 0 || authTag.length !== 16) {
      throw new OpaqueProfileHandleError()
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(HANDLE_AAD)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const payload = JSON.parse(plaintext.toString('utf8'))
    const nowSeconds = Math.floor(now / 1000)

    if (
      payload?.v !== 1
      || !isUuid(payload.s)
      || payload.p !== purpose
      || payload.a !== actorId
      || (payload.c ?? null) !== expectedScope
      || !Number.isInteger(payload.i)
      || !Number.isInteger(payload.e)
      || payload.e <= payload.i
      || payload.e - payload.i > MAX_TTL_SECONDS
      || nowSeconds < payload.i
      || nowSeconds >= payload.e
    ) {
      throw new OpaqueProfileHandleError()
    }

    return {
      profileId: payload.s,
      expiresAt: new Date(payload.e * 1000).toISOString(),
    }
  } catch (error) {
    if (error instanceof ProfileHandleConfigurationError) throw error
    throw new OpaqueProfileHandleError()
  }
}
