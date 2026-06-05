import supabaseAdmin from './_lib/supabase.js'
import { verifyUser, getActiveEventYear } from './_lib/auth.js'
import { computeAndWriteAmountOwing, computeAndWriteAmountOwingMany } from './_lib/computeAmountOwing.js'
import { requireOpenPhase } from './_lib/eventPhase.js'

async function denyIfLocked(res, year) {
  const guard = await requireOpenPhase(year)
  if (guard.ok) return false
  res.status(guard.status).json({ error: guard.error, phase: guard.phase })
  return true
}

// A ZLTAC team (event_id set) is locked for roster/identity changes once it has
// been submitted for approval (pending) or approved. The Batch-1 DB trigger
// enforces this against direct anon-client writes, but /api/captain runs as the
// service role and bypasses that trigger — so service-role mutations of the
// roster or the team must re-check it here. Competition teams (event_id null)
// are out of scope.
function isZltacLocked(team) {
  return !!team?.event_id && (team.status === 'pending' || team.status === 'approved')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const { action, ...body } = req.body ?? {}

  if (action === 'add-player') {
    const { playerId, teamId, year } = body
    if (!playerId || !teamId || !year) return res.status(400).json({ error: 'playerId, teamId and year are required' })
    if (await denyIfLocked(res, year)) return

    const { data: team, error: teamErr } = await supabaseAdmin.from('teams').select('captain_id, event_id, status').eq('id', teamId).maybeSingle()
    if (teamErr) return res.status(500).json({ error: teamErr.message })
    if (!team || team.captain_id !== user.id) {
      return res.status(403).json({ error: 'Only the team captain can add players' })
    }
    // Re-enforce the team lock (service role bypasses the DB trigger).
    if (isZltacLocked(team)) {
      return res.status(409).json({ error: 'This team is locked while it is under review or approved. Contact the committee to change the roster.' })
    }

    // Enforce per-event max_players_per_team. When the cap is null, no
    // limit applies. We treat re-assigning a player who's already on this
    // team as a no-op for cap purposes (idempotent add).
    const { data: eventForCap, error: eventForCapErr } = await supabaseAdmin
      .from('zltac_events')
      .select('max_players_per_team')
      .eq('year', year)
      .maybeSingle()
    if (eventForCapErr) return res.status(500).json({ error: eventForCapErr.message })

    const teamCap = eventForCap?.max_players_per_team
    if (teamCap) {
      const { data: currentReg, error: currentRegErr } = await supabaseAdmin
        .from('zltac_registrations')
        .select('team_id')
        .eq('user_id', playerId)
        .eq('year', year)
        .maybeSingle()
      if (currentRegErr) return res.status(500).json({ error: currentRegErr.message })

      if (currentReg?.team_id !== teamId) {
        const { count, error: countErr } = await supabaseAdmin
          .from('zltac_registrations')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .eq('year', year)
        if (countErr) return res.status(500).json({ error: countErr.message })

        if ((count ?? 0) >= teamCap) {
          return res.status(400).json({ error: `Team is full (${teamCap}/${teamCap}). Contact the committee.` })
        }
      }
    }

    const { data, error: updateErr } = await supabaseAdmin
      .from('zltac_registrations')
      .update({ team_id: teamId })
      .eq('user_id', playerId)
      .eq('year', year)
      .select()

    if (updateErr) return res.status(500).json({ error: updateErr.message })

    if (data?.[0]?.id) await computeAndWriteAmountOwing(data[0].id)

    // Phase B.3a dual-write: mirror membership into team_members.
    try {
      const { error: memberErr } = await supabaseAdmin.from('team_members').upsert({
        team_id: teamId,
        user_id: playerId,
        roles: ['player'],
        invite_status: 'accepted',
        responded_at: new Date().toISOString(),
      }, { onConflict: 'team_id,user_id' })
      if (memberErr) console.error('[api/captain add-player] dual-write team_members upsert failed:', memberErr.message)
    } catch (err) {
      console.error('[api/captain add-player] dual-write threw:', err)
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
    if (evErr) return res.status(500).json({ error: evErr.message })
    if (!ev) return res.status(404).json({ error: 'Event not found for year' })

    const cap = ev.max_teams
    if (!cap) return res.json({ ok: true })

    const { count, error: countErr } = await supabaseAdmin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id)
    if (countErr) return res.status(500).json({ error: countErr.message })

    if ((count ?? 0) >= cap) {
      return res.status(400).json({ error: `Maximum number of teams (${cap}) reached for this event.` })
    }
    return res.json({ ok: true })
  }

  if (action === 'disband-team') {
    const { teamId, year } = body
    if (!teamId || !year) return res.status(400).json({ error: 'teamId and year are required' })
    if (await denyIfLocked(res, year)) return

    // Validate caller is captain
    const { data: team, error: teamErr } = await supabaseAdmin.from('teams').select('captain_id, event_id, status').eq('id', teamId).maybeSingle()
    if (teamErr) return res.status(500).json({ error: teamErr.message })
    if (!team) return res.status(404).json({ error: 'Team not found' })
    if (team.captain_id !== user.id) return res.status(403).json({ error: 'Only the team captain can disband the team' })
    // Re-enforce the team lock (service role bypasses the DB trigger).
    if (isZltacLocked(team)) {
      return res.status(409).json({ error: 'This team is locked while it is under review or approved. Contact the committee to disband it.' })
    }

    // 1. Kick all members off the team but keep their registrations
    const { data: affected, error: regErr } = await supabaseAdmin
      .from('zltac_registrations')
      .update({ team_id: null })
      .eq('team_id', teamId)
      .eq('year', year)
      .select('id')
    if (regErr) return res.status(500).json({ error: regErr.message })

    if (affected?.length) await computeAndWriteAmountOwingMany(affected.map(r => r.id))

    // 2. Phase B.3a dual-write: clear team_members rows for this team
    try {
      const { error: memberErr } = await supabaseAdmin.from('team_members').delete().eq('team_id', teamId)
      if (memberErr) console.error('[api/captain disband-team] dual-write team_members delete failed:', memberErr.message)
    } catch (err) {
      console.error('[api/captain disband-team] dual-write threw:', err)
    }

    // 3. Delete the team itself
    const { error: delErr } = await supabaseAdmin.from('teams').delete().eq('id', teamId)
    if (delErr) return res.status(500).json({ error: delErr.message })

    return res.json({ ok: true })
  }

  if (action === 'team-completions') {
    const { playerIds, eventYear: bodyEventYear } = body
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.json({ coc_sigs: [], payments: [], ref_results: [], u18_subs: [], media_subs: [] })
    }

    const eventYear = bodyEventYear ?? await getActiveEventYear()
    if (!eventYear) return res.status(400).json({ error: 'eventYear is required (no active event)' })

    // Caller must captain a ZLTAC team. Filtering on event_id IS NOT NULL
    // scopes this to ZLTAC (the xor CHECK on teams excludes pre-nats rows).
    // Functionally the downstream zltac_registrations join already shields the
    // result, but scoping at the source removes a future-bug surface.
    const { data: captainedTeams, error: ctErr } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('captain_id', user.id)
      .not('event_id', 'is', null)
    if (ctErr) return res.status(500).json({ error: ctErr.message })

    const captainedTeamIds = (captainedTeams ?? []).map(t => t.id)
    if (captainedTeamIds.length === 0) {
      return res.status(403).json({ error: 'You do not captain any team' })
    }

    // Roster of those teams in the target event year.
    const { data: rosters, error: rosterErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', eventYear)
      .in('team_id', captainedTeamIds)
    if (rosterErr) return res.status(500).json({ error: rosterErr.message })

    const allowedPlayerIds = new Set((rosters ?? []).map(r => r.user_id))
    if (allowedPlayerIds.size === 0) {
      return res.status(403).json({ error: 'You do not captain a team in this event year' })
    }

    const outsideIds = playerIds.filter(id => !allowedPlayerIds.has(id))
    if (outsideIds.length > 0) {
      return res.status(403).json({
        error: 'One or more playerIds are not on your team',
        outsideIds,
      })
    }

    // Legal acceptances + under-18 approvals come from the unified Phase 1/2/3
    // tables. Acceptances are joined to legal_documents to filter by document_type.
    //
    // regs_status / doubles_pairs / triples_teams provide the raw data for the
    // CaptainHub team-readiness chips (side events, extras, payment). The
    // service-role client bypasses RLS so a plain captain (non-committee) can
    // see other roster members' data via this endpoint.
    const [
      { data: acceptances, error: e1 },
      { data: payments, error: e2 },
      { data: ref_results, error: e3 },
      { data: u18_approvals, error: e4 },
      { data: regs_status, error: e5 },
      { data: doubles_pairs, error: e6 },
      { data: triples_teams, error: e7 },
      { data: pay_records, error: e8 },
    ] = await Promise.all([
      supabaseAdmin
        .from('legal_acceptances')
        .select('user_id, document:legal_documents!document_id(document_type)')
        .in('user_id', playerIds)
        .eq('event_year', eventYear),
      supabaseAdmin.from('payments').select('user_id, status').in('user_id', playerIds).eq('event_year', eventYear),
      supabaseAdmin.from('referee_test_results').select('user_id, passed, score, safety_correct, safety_total, general_correct, general_total').in('user_id', playerIds),
      supabaseAdmin
        .from('under_18_approvals')
        .select('user_id, status')
        .in('user_id', playerIds)
        .eq('event_year', eventYear),
      supabaseAdmin
        .from('zltac_registrations')
        .select('user_id, side_events, has_confirmed_side_events, has_confirmed_extras, amount_owing, admin_override_coc, admin_override_coc_set_at, admin_override_coc_reason, admin_override_media, admin_override_media_set_at, admin_override_media_reason, admin_override_ref_test, admin_override_ref_test_set_at, admin_override_ref_test_reason, admin_override_u18, admin_override_u18_set_at, admin_override_u18_reason')
        .in('user_id', playerIds)
        .eq('year', eventYear),
      supabaseAdmin
        .from('doubles_pairs')
        .select('player1_id, player2_id, confirmed')
        .eq('event_year', eventYear)
        .or(`player1_id.in.(${playerIds.join(',')}),player2_id.in.(${playerIds.join(',')})`),
      supabaseAdmin
        .from('triples_teams')
        .select('player1_id, player2_id, player3_id, confirmed')
        .eq('event_year', eventYear)
        .or(`player1_id.in.(${playerIds.join(',')}),player2_id.in.(${playerIds.join(',')}),player3_id.in.(${playerIds.join(',')})`),
      // payment_records joined to registrations (year-scoped). Used to compute
      // per-player amount_paid so the captain hub Payment chip can derive
      // 'paid'/'partial'/'overpaid' instead of reading amount_owing alone.
      supabaseAdmin
        .from('payment_records')
        .select('amount, zltac_registrations!inner(user_id, year)')
        .eq('zltac_registrations.year', eventYear),
    ])

    const errs = [e1, e2, e3, e4, e5, e6, e7, e8].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

    // Sum payment_records per user, restricted to the requested playerIds.
    const playerIdSet = new Set(playerIds)
    const paid_cents_by_user = {}
    for (const rec of (pay_records ?? [])) {
      const uid = rec.zltac_registrations?.user_id
      if (uid && playerIdSet.has(uid)) {
        paid_cents_by_user[uid] = (paid_cents_by_user[uid] ?? 0) + (rec.amount ?? 0)
      }
    }

    // Preserve the response shape that CaptainHub.jsx already consumes:
    // each array is just rows of { user_id }, used to build a Set of completed users.
    const coc_sigs = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'code_of_conduct')
      .map(a => ({ user_id: a.user_id }))
    const media_subs = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'media_release')
      .map(a => ({ user_id: a.user_id }))
    // u18_subs: any approval row that isn't rejected counts as "submitted".
    const u18_subs = (u18_approvals ?? [])
      .filter(a => a.status !== 'rejected')
      .map(a => ({ user_id: a.user_id }))

    // Committee manual overrides per user, from the registration row. The
    // client ORs these into the completion map so a waived/offline-verified
    // concern reads as satisfied (CoC, Media, Ref Test, U18). Each override
    // carries its set_at + reason so the chip tooltip can surface the audit
    // metadata without a second round-trip.
    const overrides = Object.fromEntries((regs_status ?? []).map(r => [r.user_id, {
      coc:      r.admin_override_coc === true,
      coc_set_at: r.admin_override_coc_set_at ?? null,
      coc_reason: r.admin_override_coc_reason ?? null,
      media:    r.admin_override_media === true,
      media_set_at: r.admin_override_media_set_at ?? null,
      media_reason: r.admin_override_media_reason ?? null,
      ref_test: r.admin_override_ref_test === true,
      ref_test_set_at: r.admin_override_ref_test_set_at ?? null,
      ref_test_reason: r.admin_override_ref_test_reason ?? null,
      u18:      r.admin_override_u18 === true,
      u18_set_at: r.admin_override_u18_set_at ?? null,
      u18_reason: r.admin_override_u18_reason ?? null,
    }]))

    return res.json({
      coc_sigs,
      payments: payments ?? [],
      ref_results: ref_results ?? [],
      u18_subs,
      media_subs,
      regs_status: regs_status ?? [],
      doubles_pairs: doubles_pairs ?? [],
      triples_teams: triples_teams ?? [],
      paid_cents_by_user,
      overrides,
    })
  }

  if (action === 'submit-team') {
    // Captain submits a ZLTAC team draft for committee approval (draft|rejected
    // -> pending). Runs as the service role so it bypasses the Batch-1 status
    // trigger that blocks captain-driven status changes — but does its own auth
    // and re-validates every gate server-side. No client count is trusted.
    const { teamId } = body
    if (!teamId) return res.status(400).json({ error: 'teamId is required' })

    const { data: team, error: teamErr } = await supabaseAdmin
      .from('teams')
      .select('id, captain_id, event_id, status')
      .eq('id', teamId)
      .maybeSingle()
    if (teamErr) return res.status(500).json({ error: teamErr.message })
    if (!team) return res.status(404).json({ error: 'Team not found' })

    // Auth: caller must be this team's captain.
    if (team.captain_id !== user.id) {
      return res.status(403).json({ error: 'Only the team captain can submit the team for approval' })
    }

    // ZLTAC teams only (event_id set). Competition teams are out of scope.
    if (!team.event_id) {
      return res.status(400).json({ error: 'Only ZLTAC teams can be submitted for approval' })
    }

    // Submit is allowed from draft or rejected (re-submit after a reject).
    if (team.status !== 'draft' && team.status !== 'rejected') {
      return res.status(409).json({ error: `Team is already ${team.status} and cannot be submitted again.` })
    }

    // Canonical roster = zltac_registrations rows pointing at this team for the
    // event's year (captain included). Re-counted here; the client count is
    // never trusted.
    const { data: ev, error: evErr } = await supabaseAdmin
      .from('zltac_events')
      .select('year')
      .eq('id', team.event_id)
      .maybeSingle()
    if (evErr) return res.status(500).json({ error: evErr.message })
    if (!ev) return res.status(404).json({ error: 'Event not found for team' })

    const { count, error: countErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('year', ev.year)
    if (countErr) return res.status(500).json({ error: countErr.message })

    const rosterCount = count ?? 0
    const MIN_PLAYERS = 5
    if (rosterCount < MIN_PLAYERS) {
      return res.status(400).json({
        error: `A team needs at least ${MIN_PLAYERS} players to submit (currently ${rosterCount}).`,
        count: rosterCount,
      })
    }

    // Flip to pending; clear any prior rejection reason so a re-submit starts
    // clean. Service role bypasses the status trigger.
    const { error: updErr } = await supabaseAdmin
      .from('teams')
      .update({ status: 'pending', rejection_reason: null })
      .eq('id', teamId)
    if (updErr) return res.status(500).json({ error: updErr.message })

    return res.json({ ok: true, status: 'pending', count: rosterCount })
  }

  return res.status(400).json({ error: 'Invalid action' })
}
