import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'

// Returns the authenticated caller's ALSA membership status:
//   current     — membership for the period covering today, or null
//   most_recent — most recently ended membership (any time), or null
// Used by ProfileCard on PlayerDashboard to render the "ALSA Member …" line.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(401).json({ error: authErr })

  const today = new Date().toISOString().slice(0, 10)

  const { data: memberships, error } = await supabaseAdmin
    .from('alsa_memberships')
    .select('id, period:alsa_membership_periods!inner(id, label, starts_at, ends_at)')
    .eq('profile_id', user.id)

  if (error) return res.status(500).json({ error: error.message })

  const rows = (memberships ?? []).map(m => ({
    membership_id: m.id,
    period: m.period,
  }))

  const current = rows.find(r => r.period.starts_at <= today && r.period.ends_at > today) ?? null

  // most_recent: the row with the latest ends_at that has already ended (or current's prior, etc.)
  // Spec: "most recently ended membership". Excludes future periods.
  const expired = rows.filter(r => r.period.ends_at <= today)
  expired.sort((a, b) => b.period.ends_at.localeCompare(a.period.ends_at))
  const most_recent = expired[0] ?? null

  return res.json({ current, most_recent })
}
