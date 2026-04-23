import supabaseAdmin from './_lib/supabase.js'
import { verifyUser } from './_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const { score, passed, taken_at } = req.body ?? {}
  if (typeof score !== 'number' || typeof passed !== 'boolean') {
    return res.status(400).json({ error: 'score and passed are required' })
  }

  const { data: existing } = await supabaseAdmin
    .from('referee_test_results')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  const payload = { score, passed, taken_at: taken_at ?? new Date().toISOString() }

  const { error: saveErr } = existing
    ? await supabaseAdmin.from('referee_test_results').update(payload).eq('user_id', user.id)
    : await supabaseAdmin.from('referee_test_results').insert({ user_id: user.id, ...payload })

  if (saveErr) return res.status(500).json({ error: saveErr.message })
  return res.json({ ok: true })
}
