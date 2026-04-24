import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'

export default async function handler(req, res) {
  const { error } = await verifyCommittee(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

  if (req.method === 'GET') {
    const { data, error: fetchErr } = await supabaseAdmin
      .from('rr_teams')
      .select('*')
      .order('seed_rank', { ascending: true })

    if (fetchErr) return res.status(500).json({ error: fetchErr.message })
    return res.json({ teams: data })
  }

  if (req.method === 'POST') {
    const { teams = [], deletedIds = [] } = req.body ?? {}

    if (deletedIds.length > 0) {
      const { error: delErr } = await supabaseAdmin.from('rr_teams').delete().in('id', deletedIds)
      if (delErr) return res.status(500).json({ error: delErr.message })
    }

    if (teams.length > 0) {
      const rows = teams.map((t, i) => ({
        id: t.id,
        name: t.name || '',
        seed_rank: i + 1,
        region: t.region || null,
        notes: t.notes || null,
        updated_at: new Date().toISOString(),
      }))
      const { error: upsertErr } = await supabaseAdmin.from('rr_teams').upsert(rows)
      if (upsertErr) return res.status(500).json({ error: upsertErr.message })
    }

    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
