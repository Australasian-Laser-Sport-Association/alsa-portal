import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'

export default async function handler(req, res) {
  const { error } = await verifyCommittee(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

  if (req.method === 'GET') {
    const year = parseInt(req.query.year)
    if (!year) return res.status(400).json({ error: 'year is required' })

    const [
      { data: registrations, error: e1 },
      { data: profiles, error: e2 },
      { data: teams, error: e3 },
      { data: coc_sigs, error: e4 },
      { data: ref_results, error: e5 },
      { data: media_releases, error: e6 },
      { data: payments, error: e7 },
      { data: doubles, error: e8 },
      { data: triples, error: e9 },
    ] = await Promise.all([
      supabaseAdmin.from('zltac_registrations').select('id, user_id, team_id, year, status, created_at, side_events, dinner_guests').eq('year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('id, first_name, last_name, alias, state'),
      supabaseAdmin.from('teams').select('id, name, state, status, captain_id, created_at'),
      supabaseAdmin.from('code_of_conduct_signatures').select('user_id, signed_at'),
      supabaseAdmin.from('referee_test_results').select('user_id, passed, score'),
      supabaseAdmin.from('media_release_submissions').select('user_id, submitted_at'),
      supabaseAdmin.from('payments').select('user_id, status, amount').eq('event_year', year),
      supabaseAdmin.from('doubles_pairs').select('*').eq('event_year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('triples_teams').select('*').eq('event_year', year).order('created_at', { ascending: false }),
    ])

    const errs = [e1, e2, e3, e4, e5, e6, e7, e8, e9].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

    return res.json({ registrations, profiles, teams, coc_sigs, ref_results, media_releases, payments, doubles, triples })
  }

  if (req.method === 'DELETE') {
    const { resource, id, userId, year } = req.body ?? {}

    if (resource === 'doubles') {
      if (!id) return res.status(400).json({ error: 'id is required' })
      const { error: delErr } = await supabaseAdmin.from('doubles_pairs').delete().eq('id', id)
      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.json({ ok: true })
    }

    if (resource === 'triples') {
      if (!id) return res.status(400).json({ error: 'id is required' })
      const { error: delErr } = await supabaseAdmin.from('triples_teams').delete().eq('id', id)
      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.json({ ok: true })
    }

    if (!userId || !year) return res.status(400).json({ error: 'userId and year are required' })

    const { error: delErr } = await supabaseAdmin
      .from('zltac_registrations')
      .delete()
      .eq('user_id', userId)
      .eq('year', year)

    if (delErr) return res.status(500).json({ error: delErr.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
