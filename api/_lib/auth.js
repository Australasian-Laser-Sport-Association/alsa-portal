import supabaseAdmin from './supabase.js'
import { COMMITTEE_ROLES } from '../../src/lib/roles.js'

export function statusForAuthError(error) {
  if (error === 'Unauthorized') return 401
  if (error === 'Forbidden' || error === 'Account suspended') return 403
  return 500
}

export async function verifyUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return { user: null, error: 'Unauthorized' }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return { user: null, error: 'Unauthorized' }
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('roles, suspended, access_revoked_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError || !profile) {
    return { user: null, profile: null, roles: null, error: 'Internal error' }
  }
  if (profile.suspended || profile.access_revoked_at) {
    return { user: null, profile: null, roles: null, error: 'Account suspended' }
  }
  return { user, profile, roles: profile.roles ?? [], error: null }
}

export async function verifyCommittee(req) {
  const { user, profile, roles, error } = await verifyUser(req)
  if (error) return { user: null, roles: null, error }
  if (!roles.some(r => COMMITTEE_ROLES.includes(r))) {
    return { user: null, roles: null, error: 'Forbidden' }
  }
  return { user, profile, roles, error: null }
}

export async function verifySuperAdmin(req) {
  const { user, roles, error } = await verifyCommittee(req)
  if (error) return { user: null, error }
  if (!roles.includes('superadmin')) return { user: null, error: 'Forbidden' }
  return { user, error: null }
}

// Returns the year of the active (status = 'open') event, or null if none.
export async function getActiveEventYear() {
  const { data, error } = await supabaseAdmin
    .from('zltac_events')
    .select('year')
    .eq('status', 'open')
    .maybeSingle()
  if (error || !data) return null
  return data.year
}

// Returns a Set of candidateIds that share at least one team with callerId
// within the given event year (matched via zltac_registrations.team_id).
// If year is omitted, falls back to the active event year; if there is no
// active event, returns an empty set (fail closed).
export async function getTeammateIds(callerId, candidateIds, year) {
  if (!callerId || !Array.isArray(candidateIds) || candidateIds.length === 0) {
    return new Set()
  }

  const scopedYear = year ?? await getActiveEventYear()
  if (!scopedYear) return new Set()

  const { data: callerRegs, error: callerErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('team_id')
    .eq('user_id', callerId)
    .eq('year', scopedYear)
    .not('team_id', 'is', null)
  if (callerErr) return new Set()

  const callerTeamIds = [...new Set((callerRegs ?? []).map(r => r.team_id))]
  if (callerTeamIds.length === 0) return new Set()

  const { data: shared, error: sharedErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('user_id')
    .eq('year', scopedYear)
    .in('team_id', callerTeamIds)
    .in('user_id', candidateIds)
  if (sharedErr) return new Set()

  return new Set((shared ?? []).map(r => r.user_id))
}
