import { describe, expect, it } from 'vitest'
import {
  OpaqueProfileHandleError,
  PROFILE_HANDLE_PURPOSES,
  ProfileHandleConfigurationError,
  issueOpaqueProfileHandle,
  verifyOpaqueProfileHandle,
} from './opaqueProfileHandle.js'

const PROFILE_ID = '123e4567-e89b-42d3-a456-426614174000'
const ACTOR_ID = '223e4567-e89b-42d3-a456-426614174000'
const OTHER_ACTOR_ID = '323e4567-e89b-42d3-a456-426614174000'
const SECRET = 'test-only-existing-service-role-secret'
const NOW = Date.UTC(2026, 6, 14, 0, 0, 0)

function issue(overrides = {}) {
  return issueOpaqueProfileHandle({
    profileId: PROFILE_ID,
    actorId: ACTOR_ID,
    purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
    secret: SECRET,
    now: NOW,
    ...overrides,
  })
}

describe('opaque profile handles', () => {
  it('round-trips an encrypted, short-lived selector without exposing the UUID', () => {
    const handle = issue()

    expect(handle).toMatch(/^oph1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(handle).not.toContain(PROFILE_ID)
    for (const part of handle.split('.').slice(1)) {
      expect(Buffer.from(part, 'base64url').toString('utf8')).not.toContain(PROFILE_ID)
    }
    expect(verifyOpaqueProfileHandle({
      handle,
      actorId: ACTOR_ID,
      purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
      secret: SECRET,
      now: NOW + 299_000,
    })).toEqual({
      profileId: PROFILE_ID,
      expiresAt: '2026-07-14T00:05:00.000Z',
    })
  })

  it('rejects tampering, cross-purpose use, cross-actor use, and expiry identically', () => {
    const handle = issue()
    const parts = handle.split('.')
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`
    const tampered = parts.join('.')
    const attempts = [
      { handle: tampered, actorId: ACTOR_ID, purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE, now: NOW },
      { handle, actorId: ACTOR_ID, purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_MANAGER_GRANT, now: NOW },
      { handle, actorId: OTHER_ACTOR_ID, purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE, now: NOW },
      { handle, actorId: ACTOR_ID, purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE, now: NOW + 300_000 },
    ]

    for (const attempt of attempts) {
      expect(() => verifyOpaqueProfileHandle({ ...attempt, secret: SECRET }))
        .toThrow(new OpaqueProfileHandleError())
    }

    expect(() => verifyOpaqueProfileHandle({
      handle,
      actorId: ACTOR_ID,
      purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
      secret: 'a-browser-does-not-have-the-server-secret',
      now: NOW,
    })).toThrow(new OpaqueProfileHandleError())
  })

  it('fails closed when the existing server secret is unavailable', () => {
    const previous = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    try {
      expect(() => issueOpaqueProfileHandle({
        profileId: PROFILE_ID,
        actorId: ACTOR_ID,
        purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
        now: NOW,
      })).toThrow(ProfileHandleConfigurationError)
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previous
    }
  })

  it('binds ZLTAC partner handles to the exact event year and purpose', () => {
    const handle = issueOpaqueProfileHandle({
      profileId: PROFILE_ID,
      actorId: ACTOR_ID,
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER,
      scope: 'event-year:2027',
      secret: SECRET,
      now: NOW,
    })

    expect(verifyOpaqueProfileHandle({
      handle,
      actorId: ACTOR_ID,
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER,
      scope: 'event-year:2027',
      secret: SECRET,
      now: NOW,
    }).profileId).toBe(PROFILE_ID)

    for (const attempt of [
      { purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER, scope: 'event-year:2028' },
      { purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER, scope: 'event-year:2027' },
      { purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER, scope: undefined },
    ]) {
      expect(() => verifyOpaqueProfileHandle({
        handle,
        actorId: ACTOR_ID,
        secret: SECRET,
        now: NOW,
        ...attempt,
      })).toThrow(OpaqueProfileHandleError)
    }
  })

  it('binds captain roster handles to the captain and exact event year', () => {
    const handle = issueOpaqueProfileHandle({
      profileId: PROFILE_ID,
      actorId: ACTOR_ID,
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
      scope: 'event-year:2027',
      secret: SECRET,
      now: NOW,
    })

    expect(verifyOpaqueProfileHandle({
      handle,
      actorId: ACTOR_ID,
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
      scope: 'event-year:2027',
      secret: SECRET,
      now: NOW,
    }).profileId).toBe(PROFILE_ID)

    for (const attempt of [
      { actorId: OTHER_ACTOR_ID, scope: 'event-year:2027' },
      { actorId: ACTOR_ID, scope: 'event-year:2028' },
    ]) {
      expect(() => verifyOpaqueProfileHandle({
        handle,
        purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
        secret: SECRET,
        now: NOW,
        ...attempt,
      })).toThrow(OpaqueProfileHandleError)
    }
  })
})
