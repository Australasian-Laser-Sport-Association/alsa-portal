import supabaseAdmin from './_lib/supabase.js'
import { verifyUser, getTeammateIds } from './_lib/auth.js'
import { COMMITTEE_ROLES } from '../src/lib/roles.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(401).json({ error: authErr })

  const { ids, teamId, eventYear, year } = req.body ?? {}

  // Team roster mode
  if (teamId || eventYear) {
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
      .select('id, first_name, last_name, alias, state, roles')
      .in('id', rosterIds)

    if (profsErr) return res.status(500).json({ error: profsErr.message })
    return res.json({ profiles: profiles ?? [] })
  }

  // ID lookup mode
  if (!Array.isArray(ids) || ids.length === 0) return res.json({ profiles: [] })

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles').select('roles').eq('id', user.id).maybeSingle()
  const isCommittee = (callerProfile?.roles ?? []).some(r => COMMITTEE_ROLES.includes(r))

  const dobAllowed = isCommittee
    ? new Set(ids)
    : await getTeammateIds(user.id, ids, year)
  // Caller can always see their own dob
  dobAllowed.add(user.id)

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, alias, state, dob, avatar_url, roles')
    .in('id', ids)

  if (error) return res.status(500).json({ error: error.message })

  const filtered = (data ?? []).map(row =>
    dobAllowed.has(row.id) ? row : { ...row, dob: null }
  )

  return res.json({ profiles: filtered })
}
