import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const { playerId, teamId, year } = req.body ?? {}
  if (!playerId || !teamId || !year) return res.status(400).json({ error: 'playerId, teamId and year are required' })

  // Verify the caller is the captain of the team
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('captain_id')
    .eq('id', teamId)
    .single()

  if (!team || team.captain_id !== user.id) {
    return res.status(403).json({ error: 'Only the team captain can add players' })
  }

  const { data, error: updateErr } = await supabaseAdmin
    .from('zltac_registrations')
    .update({ team_id: teamId })
    .eq('user_id', playerId)
    .eq('year', year)
    .select()

  if (updateErr) return res.status(500).json({ error: updateErr.message })
  return res.json({ data })
}
