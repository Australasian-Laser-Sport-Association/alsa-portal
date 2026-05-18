import supabaseAdmin from './_lib/supabase.js'

// Public endpoint — returns the current ALSA membership period and its members
// for the About page. No auth required. Only projects safe identity fields
// (no payment_reference, no notes, no email).
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const { data: period, error: periodErr } = await supabaseAdmin
    .from('alsa_membership_periods')
    .select('id, label, starts_at, ends_at')
    .lte('starts_at', today)
    .gt('ends_at', today)
    .maybeSingle()

  if (periodErr) return res.status(500).json({ error: periodErr.message })

  if (!period) return res.json({ current_period: null, members: [] })

  const { data: memberships, error: membershipsErr } = await supabaseAdmin
    .from('alsa_memberships')
    .select('profile_id, profiles:profile_id (id, first_name, last_name, alias, avatar_url)')
    .eq('period_id', period.id)

  if (membershipsErr) return res.status(500).json({ error: membershipsErr.message })

  const members = (memberships ?? [])
    .map(m => m.profiles)
    .filter(Boolean)
    .sort((a, b) => (a.alias ?? a.first_name ?? '').localeCompare(b.alias ?? b.first_name ?? ''))

  return res.json({ current_period: period, members })
}
