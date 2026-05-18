import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'

// Committee-gated CRUD for alsa_memberships.
//   GET    → all memberships grouped { active, recently_expired, long_expired }
//   POST   → grant a membership: { profile_id, period_id, payment_reference?, notes? }
//   DELETE → ?id=<membership_id> removes the row
export default async function handler(req, res) {
  const { user, error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('alsa_memberships')
      .select(`
        id, profile_id, period_id, payment_reference, notes, created_at, created_by,
        profiles:profile_id (id, first_name, last_name, alias, avatar_url),
        period:alsa_membership_periods!inner (id, label, starts_at, ends_at)
      `)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    const today = new Date().toISOString().slice(0, 10)
    const threeMoAgo = new Date()
    threeMoAgo.setMonth(threeMoAgo.getMonth() - 3)
    const cutoff = threeMoAgo.toISOString().slice(0, 10)

    const active = []
    const recently_expired = []
    const long_expired = []

    for (const row of (data ?? [])) {
      const startsAt = row.period?.starts_at
      const endsAt = row.period?.ends_at
      if (!startsAt || !endsAt) continue
      if (startsAt <= today && endsAt > today) active.push(row)
      else if (endsAt <= today && endsAt > cutoff) recently_expired.push(row)
      else if (endsAt <= cutoff) long_expired.push(row)
      // Periods starting in the future (startsAt > today) fall through —
      // they're not yet active, not expired. Not currently surfaced in any bucket.
    }

    return res.json({ active, recently_expired, long_expired })
  }

  if (req.method === 'POST') {
    const { profile_id, period_id, payment_reference, notes } = req.body ?? {}
    if (!profile_id || !period_id) {
      return res.status(400).json({ error: 'profile_id and period_id are required' })
    }

    const insertRow = {
      profile_id,
      period_id,
      payment_reference: typeof payment_reference === 'string' && payment_reference.trim() ? payment_reference.trim() : null,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      created_by: user.id,
    }

    const { data, error } = await supabaseAdmin
      .from('alsa_memberships')
      .insert(insertRow)
      .select(`
        id, profile_id, period_id, payment_reference, notes, created_at, created_by,
        profiles:profile_id (id, first_name, last_name, alias, avatar_url),
        period:alsa_membership_periods!inner (id, label, starts_at, ends_at)
      `)
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'This member already has a membership for that period.' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.json({ membership: data })
  }

  if (req.method === 'DELETE') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { error } = await supabaseAdmin.from('alsa_memberships').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
