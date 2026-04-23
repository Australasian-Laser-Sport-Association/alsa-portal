import supabaseAdmin from './_lib/supabase.js'
import { verifyUser } from './_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { ids, teamId, eventYear } = req.body ?? {}

  // Team roster mode — auth required
  if (teamId || eventYear) {
    const { error } = await verifyUser(req)
    if (error) return res.status(401).json({ error })

    if (!teamId || !eventYear) return res.status(400).json({ error: 'teamId and eventYear are required' })

    const { data: regs, error: regsErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', eventYear)
      .eq('team_id', teamId)

    if (regsErr) return res.status(500).json({ error: regsErr.message })

    const rosterIds = (regs ?? []).map(r => r.user_id).filter(Boolean)
    if (rosterIds.length === 0) return res.json({ profiles: [] })

    const { data: profiles, error: profsErr } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, alias, state')
      .in('id', rosterIds)

    if (profsErr) return res.status(500).json({ error: profsErr.message })
    return res.json({ profiles: profiles ?? [] })
  }

  // ID lookup mode — no auth required
  if (!Array.isArray(ids) || ids.length === 0) return res.json({ profiles: [] })

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, alias, state, dob, avatar_url')
    .in('id', ids)

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ profiles: data ?? [] })
}
