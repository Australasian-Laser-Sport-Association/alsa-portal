import supabaseAdmin from './_lib/supabase.js'
import { verifyUser, getTeammateIds } from './_lib/auth.js'
import { COMMITTEE_ROLES } from '../src/lib/roles.js'

// Fetch ALSA membership status for one profile. Returns
// { current, most_recent } in the same shape the dashboard previously
// got from the now-removed /api/me/membership endpoint.
async function fetchAlsaMembership(profileId) {
  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabaseAdmin
    .from('alsa_memberships')
    .select('id, period:alsa_membership_periods!inner(id, label, starts_at, ends_at)')
    .eq('profile_id', profileId)

  if (error) return { current: null, most_recent: null }

  const rows = (data ?? []).map(m => ({ membership_id: m.id, period: m.period }))
  const current = rows.find(r => r.period.starts_at <= today && r.period.ends_at > today) ?? null
  const expired = rows.filter(r => r.period.ends_at <= today)
  expired.sort((a, b) => b.period.ends_at.localeCompare(a.period.ends_at))
  const most_recent = expired[0] ?? null

  return { current, most_recent }
}

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

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles').select('roles').eq('id', user.id).maybeSingle()
    const isCommittee = (callerProfile?.roles ?? []).some(r => COMMITTEE_ROLES.includes(r))
    if (!isCommittee && !rosterIds.includes(user.id)) {
      return res.status(403).json({ error: 'Not authorized to view this team roster' })
    }

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

  // Attach alsa_membership only to the caller's own row, if present.
  const selfRequested = ids.includes(user.id)
  const alsa_membership = selfRequested ? await fetchAlsaMembership(user.id) : null

  const filtered = (data ?? []).map(row => {
    const base = dobAllowed.has(row.id) ? row : { ...row, dob: null }
    return row.id === user.id && alsa_membership
      ? { ...base, alsa_membership }
      : base
  })

  return res.json({ profiles: filtered })
}
