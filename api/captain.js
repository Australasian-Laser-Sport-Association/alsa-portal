import supabaseAdmin from './_lib/supabase.js'
import { verifyUser, getActiveEventYear } from './_lib/auth.js'
import { computeAndWriteAmountOwing, computeAndWriteAmountOwingMany } from './_lib/computeAmountOwing.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const { action, ...body } = req.body ?? {}

  if (action === 'add-player') {
    const { playerId, teamId, year } = body
    if (!playerId || !teamId || !year) return res.status(400).json({ error: 'playerId, teamId and year are required' })

    const { data: team, error: teamErr } = await supabaseAdmin.from('teams').select('captain_id').eq('id', teamId).maybeSingle()
    if (teamErr) return res.status(500).json({ error: teamErr.message })
    if (!team || team.captain_id !== user.id) {
      return res.status(403).json({ error: 'Only the team captain can add players' })
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

  if (action === 'disband-team') {
    const { teamId, year } = body
    if (!teamId || !year) return res.status(400).json({ error: 'teamId and year are required' })

    // Validate caller is captain
    const { data: team, error: teamErr } = await supabaseAdmin.from('teams').select('captain_id').eq('id', teamId).maybeSingle()
    if (teamErr) return res.status(500).json({ error: teamErr.message })
    if (!team) return res.status(404).json({ error: 'Team not found' })
    if (team.captain_id !== user.id) return res.status(403).json({ error: 'Only the team captain can disband the team' })

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

    // Caller must captain a team. Get all teams they captain.
    const { data: captainedTeams, error: ctErr } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('captain_id', user.id)
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
    const [
      { data: acceptances, error: e1 },
      { data: payments, error: e2 },
      { data: ref_results, error: e3 },
      { data: u18_approvals, error: e4 },
    ] = await Promise.all([
      supabaseAdmin
        .from('legal_acceptances')
        .select('user_id, document:legal_documents!document_id(document_type)')
        .in('user_id', playerIds)
        .eq('event_year', eventYear),
      supabaseAdmin.from('payments').select('user_id, status').in('user_id', playerIds).eq('event_year', eventYear),
      supabaseAdmin.from('referee_test_results').select('user_id, passed, score').in('user_id', playerIds),
      supabaseAdmin
        .from('under_18_approvals')
        .select('user_id, status')
        .in('user_id', playerIds)
        .eq('event_year', eventYear),
    ])

    const errs = [e1, e2, e3, e4].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

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

    return res.json({
      coc_sigs,
      payments: payments ?? [],
      ref_results: ref_results ?? [],
      u18_subs,
      media_subs,
    })
  }

  return res.status(400).json({ error: 'Invalid action' })
}
