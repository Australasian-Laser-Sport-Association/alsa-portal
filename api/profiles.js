import supabaseAdmin from './_lib/supabase.js'
import { sendServerError } from './_lib/apiErrors.js'
import { statusForAuthError, verifyUser } from './_lib/auth.js'
import { COMMITTEE_ROLES } from '../src/lib/roles.js'
import { enforceRateLimit } from './_lib/rateLimit.js'
import { isUuid } from './_lib/idValidation.js'

const MAX_PROFILE_IDS = 50
const FULL_PROFILE_COLUMNS = 'id, first_name, last_name, alias, state, dob, avatar_url, roles'

function validYear(value) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null
}

async function fetchAlsaMembership(profileId) {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('alsa_memberships')
    .select('id, period:alsa_membership_periods!inner(id, label, starts_at, ends_at)')
    .eq('profile_id', profileId)

  if (error) throw error
  const rows = (data ?? []).map(membership => ({
    membership_id: membership.id,
    period: membership.period,
  }))
  const current = rows.find(row => (
    row.period.starts_at <= today && row.period.ends_at > today
  )) ?? null
  const expired = rows
    .filter(row => row.period.ends_at <= today)
    .sort((a, b) => b.period.ends_at.localeCompare(a.period.ends_at))
  return { current, most_recent: expired[0] ?? null }
}

async function relatedProfileIds(callerId, candidateIds, year) {
  const allowed = new Set()
  const candidates = new Set(candidateIds)

  const { data: callerRegistration, error: callerError } = await supabaseAdmin
    .from('zltac_registrations')
    .select('team_id, status')
    .eq('user_id', callerId)
    .eq('year', year)
    .maybeSingle()
  if (callerError) throw callerError
  if (!callerRegistration || callerRegistration.status === 'cancelled') return allowed

  if (callerRegistration.team_id) {
    const { data: teammates, error: teammatesError } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', year)
      .eq('team_id', callerRegistration.team_id)
      .neq('status', 'cancelled')
      .in('user_id', candidateIds)
    if (teammatesError) throw teammatesError
    for (const row of (teammates ?? [])) {
      if (candidates.has(row.user_id)) allowed.add(row.user_id)
    }
  }

  const [{ data: doubles, error: doublesError }, { data: triples, error: triplesError }] = await Promise.all([
    supabaseAdmin
      .from('doubles_pairs')
      .select('player1_id, player2_id')
      .eq('event_year', year)
      .or(`player1_id.eq.${callerId},player2_id.eq.${callerId}`),
    supabaseAdmin
      .from('triples_teams')
      .select('player1_id, player2_id, player3_id')
      .eq('event_year', year)
      .or(`player1_id.eq.${callerId},player2_id.eq.${callerId},player3_id.eq.${callerId}`),
  ])
  if (doublesError) throw doublesError
  if (triplesError) throw triplesError

  for (const row of (doubles ?? [])) {
    for (const id of [row.player1_id, row.player2_id]) {
      if (id !== callerId && candidates.has(id)) allowed.add(id)
    }
  }
  for (const row of (triples ?? [])) {
    for (const id of [row.player1_id, row.player2_id, row.player3_id]) {
      if (id !== callerId && candidates.has(id)) allowed.add(id)
    }
  }
  return allowed
}

async function handleTeamRoster(res, { user, isCommittee, teamId, eventYear }) {
  const year = validYear(eventYear)
  if (!isUuid(teamId) || !year) {
    return res.status(400).json({ error: 'A valid teamId and eventYear are required' })
  }

  const { data: registrations, error: registrationsError } = await supabaseAdmin
    .from('zltac_registrations')
    .select('user_id')
    .eq('year', year)
    .eq('team_id', teamId)
    .neq('status', 'cancelled')
  if (registrationsError) return sendServerError(res, registrationsError, 'profiles:team-roster')

  const rosterIds = [...new Set((registrations ?? []).map(row => row.user_id).filter(Boolean))]
  if (!isCommittee && !rosterIds.includes(user.id)) {
    return res.status(403).json({ error: 'Not authorized to view this team roster' })
  }
  if (rosterIds.length === 0) return res.json({ profiles: [] })

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('captain_id, manager_id')
    .eq('id', teamId)
    .maybeSingle()
  if (teamError) return sendServerError(res, teamError, 'profiles:team')
  if (!team) return res.status(404).json({ error: 'Team not found' })

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select(isCommittee ? FULL_PROFILE_COLUMNS : 'id, alias')
    .in('id', rosterIds)
  if (profilesError) return sendServerError(res, profilesError, 'profiles:team-profiles')

  return res.json({
    profiles: (profiles ?? []).map(profile => ({
      ...(isCommittee ? profile : { id: profile.id, alias: profile.alias }),
      team_role: profile.id === team.captain_id
        ? 'captain'
        : profile.id === team.manager_id
          ? 'manager'
          : 'player',
    })),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, roles, error: authError } = await verifyUser(req)
  if (authError) return res.status(statusForAuthError(authError)).json({ error: authError })
  if (!await enforceRateLimit(req, res, {
    identifier: user.id,
    limit: 60,
    window: '1 m',
    prefix: 'profile-lookup',
    requireDistributed: true,
  })) return

  const isCommittee = (roles ?? []).some(role => COMMITTEE_ROLES.includes(role))
  const { ids, teamId, eventYear } = req.body ?? {}

  if (teamId != null || eventYear != null && ids == null) {
    return handleTeamRoster(res, { user, isCommittee, teamId, eventYear })
  }

  if (!Array.isArray(ids) || ids.length === 0) return res.json({ profiles: [] })
  if (ids.length > MAX_PROFILE_IDS) {
    return res.status(400).json({ error: `Too many ids (max ${MAX_PROFILE_IDS})` })
  }
  if (ids.some(id => !isUuid(id))) {
    return res.status(400).json({ error: 'Every id must be a valid UUID' })
  }

  const requestedIds = [...new Set(ids)]
  let visibleIds
  if (isCommittee) {
    visibleIds = new Set(requestedIds)
  } else {
    visibleIds = new Set(requestedIds.filter(id => id === user.id))
    const nonSelf = requestedIds.filter(id => id !== user.id)
    if (nonSelf.length > 0) {
      const year = validYear(req.body?.year)
      if (!year) return res.status(400).json({ error: 'A valid year is required for related profiles' })
      try {
        const related = await relatedProfileIds(user.id, nonSelf, year)
        for (const id of related) visibleIds.add(id)
      } catch (error) {
        return sendServerError(res, error, 'profiles:relationships')
      }
    }
  }

  const visible = requestedIds.filter(id => visibleIds.has(id))
  if (visible.length === 0) return res.json({ profiles: [] })

  const selfRequested = visible.includes(user.id)
  const relatedIds = isCommittee ? [] : visible.filter(id => id !== user.id)
  const [fullResult, relatedResult] = await Promise.all([
    (isCommittee || selfRequested)
      ? supabaseAdmin
          .from('profiles')
          .select(FULL_PROFILE_COLUMNS)
          .in('id', isCommittee ? visible : [user.id])
      : Promise.resolve({ data: [], error: null }),
    relatedIds.length > 0
      ? supabaseAdmin.from('profiles').select('id, alias').in('id', relatedIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (fullResult.error) return sendServerError(res, fullResult.error, 'profiles:full')
  if (relatedResult.error) return sendServerError(res, relatedResult.error, 'profiles:related')

  let membership = null
  if (selfRequested) {
    try {
      membership = await fetchAlsaMembership(user.id)
    } catch (error) {
      return sendServerError(res, error, 'profiles:membership')
    }
  }

  const rows = [
    ...(fullResult.data ?? []),
    ...(relatedResult.data ?? []).map(profile => ({ id: profile.id, alias: profile.alias })),
  ]
  const byId = new Map(rows.map(row => [row.id, row]))
  return res.json({
    profiles: visible
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(profile => profile.id === user.id && membership
        ? { ...profile, alsa_membership: membership }
        : profile),
  })
}
