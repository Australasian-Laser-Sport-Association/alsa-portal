import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const { year } = req.body ?? {}
  if (!year) return res.status(400).json({ error: 'year is required' })

  // Look up the registration
  const { data: reg, error: regErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, team_id')
    .eq('user_id', user.id)
    .eq('year', year)
    .maybeSingle()
  if (regErr) return res.status(500).json({ error: regErr.message })
  if (!reg) return res.status(404).json({ error: 'No registration found for that year' })

  // If on a team, block cancellation when caller is the team captain
  if (reg.team_id) {
    const { data: team, error: teamErr } = await supabaseAdmin
      .from('teams')
      .select('captain_id')
      .eq('id', reg.team_id)
      .maybeSingle()
    if (teamErr) return res.status(500).json({ error: teamErr.message })
    if (team?.captain_id === user.id) {
      return res.status(409).json({
        error: 'You are the captain. Disband your team first.',
        teamId: reg.team_id,
        code: 'CAPTAIN_BLOCKED',
      })
    }

    // Phase B.3a dual-write: remove team_members row before deleting registration.
    try {
      const { error: memberErr } = await supabaseAdmin
        .from('team_members')
        .delete()
        .eq('team_id', reg.team_id)
        .eq('user_id', user.id)
      if (memberErr) console.error('[api/player/cancel-registration] dual-write team_members delete failed:', memberErr.message)
    } catch (err) {
      console.error('[api/player/cancel-registration] dual-write threw:', err)
    }
  }

  // Delete the registration
  const { error: delErr } = await supabaseAdmin
    .from('zltac_registrations')
    .delete()
    .eq('id', reg.id)
  if (delErr) return res.status(500).json({ error: delErr.message })

  return res.json({ ok: true })
}
