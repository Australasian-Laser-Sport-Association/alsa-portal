import supabaseAdmin from './_lib/supabase.js'

// Public profile lookup by IDs — no auth required.
// Returns only non-sensitive display fields (name, alias, state, dob, avatar_url).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { ids } = req.body ?? {}
  if (!Array.isArray(ids) || ids.length === 0) return res.json({ profiles: [] })

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, alias, state, dob, avatar_url')
    .in('id', ids)

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ profiles: data ?? [] })
}
