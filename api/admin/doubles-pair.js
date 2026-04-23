import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee } from '../_lib/auth.js'

export default async function handler(req, res) {
  const { error } = await verifyCommittee(req)
  if (error) return res.status(error === 'Unauthorized' ? 401 : 403).json({ error })

  if (req.method === 'DELETE') {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { error: delErr } = await supabaseAdmin.from('doubles_pairs').delete().eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
