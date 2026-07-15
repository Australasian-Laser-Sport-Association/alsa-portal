import supabaseAdmin from './_lib/supabase.js'
import { sendServerError } from './_lib/apiErrors.js'
import { statusForAuthError, verifyUser } from './_lib/auth.js'
import { requireOpenPhase } from './_lib/eventPhase.js'
import { captainTeamErrorResponse, isAllowedTeamLogoUrl } from './_lib/captainTeam.js'
import { enforceRateLimit } from './_lib/rateLimit.js'
import { isUuid } from './_lib/idValidation.js'
import { getCaptainCurrentTeamReadiness } from './_lib/zltacReadinessData.js'
import {
  OpaqueProfileHandleError,
  PROFILE_HANDLE_PURPOSES,
  ProfileHandleConfigurationError,
  issueOpaqueProfileHandle,
  verifyOpaqueProfileHandle,
} from './_lib/opaqueProfileHandle.js'

const TEAM_STATES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ'])
const TEAM_ENTRY_TYPES = new Set(['state_association', 'direct_entry'])
const TEAM_PRESENTATION_FIELDS = new Set(['action', 'teamId', 'eventId', 'name', 'state', 'homeVenue', 'colour', 'logoUrl'])

function captainRosterScope(eventYear) {
  return `event-year:${eventYear}`
}

function sendCaptainMutationError(res, error, context) {
  const mapped = captainTeamErrorResponse(error)
  if (mapped.status === 500) return sendServerError(res, error, context)
  return res.status(mapped.status).json({ error: mapped.error })
}

async function denyIfLocked(res, year) {
  const guard = await requireOpenPhase(year)
  if (guard.ok) return false
  res.status(guard.status).json({ error: guard.error, phase: guard.phase })
  return true
}

async function getOwnedCurrentTeamScope(captainId, teamId, eventId) {
  const { data: event, error: eventError } = await supabaseAdmin
    .from('zltac_events')
    .select('id, year, status')
    .eq('id', eventId)
    .eq('status', 'open')
    .maybeSingle()
  if (eventError) throw eventError
  if (!event) return null

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, captain_id, event_id, status')
    .eq('id', teamId)
    .eq('event_id', event.id)
    .eq('captain_id', captainId)
    .maybeSingle()
  if (teamError) throw teamError
  if (!team) return null

  return { event, team }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

  if (!await enforceRateLimit(req, res, {
    identifier: user.id,
    limit: 60,
    window: '1 m',
    prefix: 'captain-mutations',
    requireDistributed: true,
  })) return

  const { action, ...body } = req.body ?? {}

  if (action === 'create-team') {
    const year = Number.parseInt(body.year, 10)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const entryType = typeof body.entryType === 'string' ? body.entryType.trim() : ''
    const state = typeof body.state === 'string' ? body.state.trim() : ''
    const homeVenue = typeof body.homeVenue === 'string' ? body.homeVenue.trim() : ''
    const colour = typeof body.colour === 'string' ? body.colour.trim() : ''
    const logoUrl = typeof body.logoUrl === 'string' ? body.logoUrl.trim() : ''

    if (!Number.isInteger(year)) return res.status(400).json({ error: 'year is required' })
    if (await denyIfLocked(res, year)) return
    if (!name || name.length > 80) return res.status(400).json({ error: 'Team name is required and must be 80 characters or fewer.' })
    if (!TEAM_ENTRY_TYPES.has(entryType)) return res.status(400).json({ error: 'Select State Association Team or Direct Entry Team.' })
    if (!TEAM_STATES.has(state)) return res.status(400).json({ error: 'A valid team state is required.' })
    if (homeVenue.length > 120) return res.status(400).json({ error: 'Home venue must be 120 characters or fewer.' })
    if (colour && !/^#[0-9a-f]{6}$/i.test(colour)) return res.status(400).json({ error: 'Invalid team colour.' })
    if (!isAllowedTeamLogoUrl(logoUrl, process.env.VITE_SUPABASE_URL, user.id)) {
      return res.status(400).json({ error: 'Invalid team logo URL.' })
    }

    const { data, error: createErr } = await supabaseAdmin.rpc('create_zltac_captain_team', {
      p_user_id: user.id,
      p_year: year,
      p_name: name,
      p_entry_type: entryType,
      p_state: state,
      p_home_venue: homeVenue || null,
      p_colour: colour || null,
      p_logo_url: logoUrl || null,
    })
    if (createErr) {
      return sendCaptainMutationError(res, createErr, 'captain:create-team')
    }
    return res.json(data)
  }

  if (action === 'update-team-settings') {
    const unexpected = Object.keys(body).filter(key => !TEAM_PRESENTATION_FIELDS.has(key))
    if (unexpected.length > 0) {
      return res.status(400).json({ error: `Unsupported field(s): ${unexpected.join(', ')}` })
    }

    const { teamId, eventId } = body
    if (!isUuid(teamId) || !isUuid(eventId)) {
      return res.status(400).json({ error: 'teamId and eventId must be valid UUIDs' })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const state = typeof body.state === 'string' ? body.state.trim() : ''
    const homeVenue = typeof body.homeVenue === 'string' ? body.homeVenue.trim() : ''
    const colour = typeof body.colour === 'string' ? body.colour.trim() : ''
    const logoUrl = typeof body.logoUrl === 'string' ? body.logoUrl.trim() : ''

    if (!name || name.length > 80) {
      return res.status(400).json({ error: 'Team name is required and must be 80 characters or fewer.' })
    }
    if (!TEAM_STATES.has(state)) return res.status(400).json({ error: 'A valid team state is required.' })
    if (homeVenue.length > 120) return res.status(400).json({ error: 'Home venue must be 120 characters or fewer.' })
    if (colour && !/^#[0-9a-f]{6}$/i.test(colour)) return res.status(400).json({ error: 'Invalid team colour.' })
    // Initial team creation happens before the team UUID is known, so that
    // upload lives under the captain UUID. Subsequent uploads live under the
    // team UUID. Both folders are RLS-owned by this captain/team.
    if (!isAllowedTeamLogoUrl(
      logoUrl,
      process.env.VITE_SUPABASE_URL,
      [teamId, user.id],
    )) {
      return res.status(400).json({ error: 'Invalid team logo URL.' })
    }

    const { data, error: updateErr } = await supabaseAdmin.rpc('captain_mutate_zltac_team', {
      p_actor_id: user.id,
      p_team_id: teamId,
      p_event_id: eventId,
      p_action: 'settings',
      p_changes: {
        name,
        state,
        home_venue: homeVenue || null,
        colour: colour || null,
        logo_url: logoUrl || null,
      },
    })
    if (updateErr) {
      return sendCaptainMutationError(res, updateErr, 'captain:update-team-settings')
    }
    return res.json(data)
  }

  if (action === 'add-player') {
    const { playerHandle, teamId, eventId } = body
    if (body.playerId != null) {
      return res.status(400).json({ error: 'Use the player selection returned by search.' })
    }
    if (typeof playerHandle !== 'string' || !isUuid(teamId) || !isUuid(eventId)) {
      return res.status(400).json({ error: 'playerHandle and valid teamId/eventId values are required' })
    }
    let scope
    try {
      scope = await getOwnedCurrentTeamScope(user.id, teamId, eventId)
    } catch (scopeError) {
      return sendServerError(res, scopeError, 'captain:add-player-scope')
    }
    if (!scope) return res.status(404).json({ error: 'Current team not found' })
    if (await denyIfLocked(res, scope.event.year)) return

    let playerId
    try {
      playerId = verifyOpaqueProfileHandle({
        handle: playerHandle,
        purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
        actorId: user.id,
        scope: captainRosterScope(scope.event.year),
      }).profileId
    } catch (handleError) {
      if (handleError instanceof ProfileHandleConfigurationError) {
        return sendServerError(res, handleError, 'captain:add-player-handle-config')
      }
      if (handleError instanceof OpaqueProfileHandleError) {
        return res.status(400).json({ error: 'Invalid or expired player selection.' })
      }
      return sendServerError(res, handleError, 'captain:add-player-handle')
    }

    const { data, error: addErr } = await supabaseAdmin.rpc('add_zltac_team_player', {
      p_captain_id: user.id,
      p_player_id: playerId,
      p_team_id: teamId,
      p_year: scope.event.year,
    })
    if (addErr) {
      return sendCaptainMutationError(res, addErr, 'captain:add-player')
    }
    return res.json({ data })
  }

  if (action === 'remove-player') {
    const { playerId, teamId, eventId } = body
    if (!isUuid(playerId) || !isUuid(teamId) || !isUuid(eventId)) {
      return res.status(400).json({ error: 'playerId, teamId and eventId must be valid UUIDs' })
    }
    let scope
    try {
      scope = await getOwnedCurrentTeamScope(user.id, teamId, eventId)
    } catch (scopeError) {
      return sendServerError(res, scopeError, 'captain:remove-player-scope')
    }
    if (!scope) return res.status(404).json({ error: 'Current team not found' })
    if (await denyIfLocked(res, scope.event.year)) return
    const { data, error: removeErr } = await supabaseAdmin.rpc('remove_zltac_team_player', {
      p_captain_id: user.id,
      p_player_id: playerId,
      p_team_id: teamId,
      p_year: scope.event.year,
    })
    if (removeErr) {
      return sendCaptainMutationError(res, removeErr, 'captain:remove-player')
    }
    return res.json({ data })
  }

  if (action === 'precheck-create-team') {
    // Cap-check used by CaptainRegister before inserting a new team row.
    // Returns 400 with a user-facing message when the event would exceed
    // max_teams. Null cap = no limit. Race: the count is taken before the
    // client insert, so a concurrent submission could still slip past;
    // acceptable for a soft admin-imposed cap.
    const { year } = body
    if (!year) return res.status(400).json({ error: 'year is required' })
    // Block new team creation once the event locks. RLS also blocks the
    // client-direct insert; this returns a clean message before the attempt.
    if (await denyIfLocked(res, year)) return

    const { data: ev, error: evErr } = await supabaseAdmin
      .from('zltac_events')
      .select('id, max_teams')
      .eq('year', year)
      .maybeSingle()
    if (evErr) return sendServerError(res, evErr, 'captain:ev')
    if (!ev) return res.status(404).json({ error: 'Event not found for year' })

    const cap = ev.max_teams
    if (!cap) return res.json({ ok: true })

    const { count, error: countErr } = await supabaseAdmin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id)
    if (countErr) return sendServerError(res, countErr, 'captain:count')

    if ((count ?? 0) >= cap) {
      return res.status(400).json({ error: `Maximum number of teams (${cap}) reached for this event.` })
    }
    return res.json({ ok: true })
  }

  if (action === 'disband-team') {
    const { teamId, eventId } = body
    if (!isUuid(teamId) || !isUuid(eventId)) {
      return res.status(400).json({ error: 'teamId and eventId must be valid UUIDs' })
    }
    let scope
    try {
      scope = await getOwnedCurrentTeamScope(user.id, teamId, eventId)
    } catch (scopeError) {
      return sendServerError(res, scopeError, 'captain:disband-team-scope')
    }
    if (!scope) return res.status(404).json({ error: 'Current team not found' })
    if (await denyIfLocked(res, scope.event.year)) return
    const { data, error: disbandErr } = await supabaseAdmin.rpc('disband_zltac_team', {
      p_captain_id: user.id,
      p_team_id: teamId,
      p_year: scope.event.year,
    })
    if (disbandErr) {
      return sendCaptainMutationError(res, disbandErr, 'captain:disband-team')
    }
    return res.json({ ok: true, ...data })
  }

  if (action === 'team-readiness') {
    const { teamId, eventId } = body
    if (!isUuid(teamId) || !isUuid(eventId)) {
      return res.status(400).json({ error: 'teamId and eventId must be valid UUIDs' })
    }

    try {
      const result = await getCaptainCurrentTeamReadiness({
        captainId: user.id,
        teamId,
        eventId,
      })
      if (!result) return res.status(404).json({ error: 'Current team not found' })
      const userIds = result.registrations.map(row => row.user_id).filter(Boolean)
      let profiles = []
      if (userIds.length > 0) {
        const { data, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('id, first_name, last_name, alias, state, avatar_url, roles')
          .in('id', userIds)
        if (profileError) return sendServerError(res, profileError, 'captain:team-readiness-profiles')
        profiles = data ?? []
      }
      return res.json({ ...result, profiles })
    } catch (readinessError) {
      return sendServerError(res, readinessError, 'captain:team-readiness')
    }
  }

  if (action === 'search-players') {
    const { teamId, eventId } = body
    const term = typeof body.term === 'string' ? body.term.trim() : ''
    if (!isUuid(teamId) || !isUuid(eventId)) {
      return res.status(400).json({ error: 'teamId and eventId must be valid UUIDs' })
    }
    if (term.length < 3 || term.length > 100) {
      return res.status(400).json({ error: 'Search term must be between 3 and 100 characters' })
    }

    let scope
    try {
      scope = await getOwnedCurrentTeamScope(user.id, teamId, eventId)
    } catch (scopeError) {
      return sendServerError(res, scopeError, 'captain:search-player-scope')
    }
    if (!scope) return res.status(404).json({ error: 'Current team not found' })
    if (await denyIfLocked(res, scope.event.year)) return

    const { data: unassigned, error: registrationError } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', scope.event.year)
      .is('team_id', null)
      .neq('status', 'cancelled')
      .neq('user_id', user.id)
    if (registrationError) return sendServerError(res, registrationError, 'captain:search-player-registrations')

    const userIds = (unassigned ?? []).map(row => row.user_id).filter(Boolean)
    if (userIds.length === 0) return res.json({ profiles: [] })
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, alias')
      .eq('is_placeholder', false)
      .eq('suspended', false)
      .in('id', userIds)
      .ilike('alias', `%${term.replace(/[\\%_]/g, match => `\\${match}`)}%`)
      .limit(10)
    if (profileError) return sendServerError(res, profileError, 'captain:search-player-profiles')

    try {
      return res.json({
        profiles: (profiles ?? []).map(profile => ({
          alias: profile.alias,
          handle: issueOpaqueProfileHandle({
            profileId: profile.id,
            purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_CAPTAIN_ROSTER,
            actorId: user.id,
            scope: captainRosterScope(scope.event.year),
          }),
        })),
      })
    } catch (handleError) {
      return sendServerError(res, handleError, 'captain:search-player-handles')
    }
  }

  if (action === 'submit-team') {
    // The event-first RPC locks ownership, lifecycle, roster eligibility,
    // membership parity, minimum size, and the draft/rejected -> pending move.
    const { teamId, eventId } = body
    if (!isUuid(teamId) || !isUuid(eventId)) {
      return res.status(400).json({ error: 'teamId and eventId must be valid UUIDs' })
    }

    const { data, error: submitErr } = await supabaseAdmin.rpc('captain_mutate_zltac_team', {
      p_actor_id: user.id,
      p_team_id: teamId,
      p_event_id: eventId,
      p_action: 'submit',
      p_changes: {},
    })
    if (submitErr) {
      return sendCaptainMutationError(res, submitErr, 'captain:submit-team')
    }
    return res.json({ ok: true, ...data })
  }

  return res.status(400).json({ error: 'Invalid action' })
}
