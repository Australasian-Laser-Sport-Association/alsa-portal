import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee } from '../_lib/auth.js'

export default async function handler(req, res) {
  const { error } = await verifyCommittee(req)
  if (error) return res.status(error === 'Unauthorized' ? 401 : 403).json({ error })

  if (req.method === 'GET') {
    const [
      { data: profiles, error: e1 },
      { data: registrations, error: e2 },
      { data: teams, error: e3 },
    ] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, alias, state, role, roles, suspended, created_at, home_arena')
        .order('created_at', { ascending: false }),
      supabaseAdmin.from('zltac_registrations').select('user_id, year'),
      supabaseAdmin.from('teams').select('id, name, captain_id'),
    ])

    const errs = [e1, e2, e3].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

    return res.json({ profiles, registrations, teams })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
