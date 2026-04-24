import supabaseAdmin from './_lib/supabase.js'
import { verifyUser } from './_lib/auth.js'

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
    return res.json({ data })
  }

  if (action === 'team-completions') {
    const { playerIds, eventYear } = body
    if (!Array.isArray(playerIds) || playerIds.length === 0 || !eventYear) {
      return res.json({ coc_sigs: [], payments: [], ref_results: [], u18_subs: [], media_subs: [] })
    }

    const [
      { data: coc_sigs, error: e1 },
      { data: payments, error: e2 },
      { data: ref_results, error: e3 },
      { data: u18_subs, error: e4 },
      { data: media_subs, error: e5 },
    ] = await Promise.all([
      supabaseAdmin.from('code_of_conduct_signatures').select('user_id').in('user_id', playerIds),
      supabaseAdmin.from('payments').select('user_id, status').in('user_id', playerIds).eq('event_year', eventYear),
      supabaseAdmin.from('referee_test_results').select('user_id, passed, score').in('user_id', playerIds),
      supabaseAdmin.from('under18_submissions').select('user_id').in('user_id', playerIds).eq('event_year', eventYear),
      supabaseAdmin.from('media_release_submissions').select('user_id').in('user_id', playerIds).eq('event_year', eventYear),
    ])

    const errs = [e1, e2, e3, e4, e5].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

    return res.json({
      coc_sigs: coc_sigs ?? [],
      payments: payments ?? [],
      ref_results: ref_results ?? [],
      u18_subs: u18_subs ?? [],
      media_subs: media_subs ?? [],
    })
  }

  return res.status(400).json({ error: 'Invalid action' })
}
