import { describe, expect, it } from 'vitest'
import { captainTeamErrorResponse, isAllowedTeamLogoUrl } from './captainTeam.js'

describe('captain team creation boundary', () => {
  it('maps uniqueness conflicts to a stable user response', () => {
    expect(captainTeamErrorResponse({ code: '23505', message: 'duplicate' })).toEqual({
      status: 409,
      error: 'You already have a team for this event.',
    })
  })

  it('maps serialized cap failures to conflicts', () => {
    expect(captainTeamErrorResponse({ code: 'P0001', message: 'Maximum number of teams (12) reached.' }).status).toBe(409)
  })

  it('preserves authorization and not-found semantics', () => {
    expect(captainTeamErrorResponse({ code: 'P0001', message: 'Only the team captain can add players' }).status).toBe(403)
    expect(captainTeamErrorResponse({ code: 'P0002', message: 'Player registration not found' }).status).toBe(404)
  })

  it('only accepts public team-logo URLs from the configured Supabase origin', () => {
    const base = 'https://project.supabase.co'
    expect(isAllowedTeamLogoUrl(`${base}/storage/v1/object/public/team-logos/user/logo.png`, base)).toBe(true)
    expect(isAllowedTeamLogoUrl('https://attacker.example/logo.png', base)).toBe(false)
    expect(isAllowedTeamLogoUrl(`${base}/storage/v1/object/public/avatars/user/avatar.png`, base)).toBe(false)
  })
})
