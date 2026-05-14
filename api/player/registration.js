import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'
import { COMMITTEE_ROLES } from '../../src/lib/roles.js'
import { computeAndWriteAmountOwing } from '../_lib/computeAmountOwing.js'

// Player operations on the caller's own zltac_registrations row.
//   action: 'cancel'          — delete the registration (body: { year })
//   action: 'recompute-owing' — recompute amount_owing (body: { registrationId })

async function cancelRegistration(user, body, res) {
  const { year } = body
  if (!year) return res.status(400).json({ error: 'year is required' })

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
      if (memberErr) console.error('[api/player/registration cancel] dual-write team_members delete failed:', memberErr.message)
    } catch (err) {
      console.error('[api/player/registration cancel] dual-write threw:', err)
    }
  }

  const { error: delErr } = await supabaseAdmin
    .from('zltac_registrations')
    .delete()
    .eq('id', reg.id)
  if (delErr) return res.status(500).json({ error: delErr.message })

  return res.json({ ok: true })
}

async function recomputeOwing(user, body, res) {
  const { registrationId } = body
  if (!registrationId) return res.status(400).json({ error: 'registrationId is required' })

  const { data: reg, error: regErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('user_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (regErr) return res.status(500).json({ error: regErr.message })
  if (!reg) return res.status(404).json({ error: 'Registration not found' })

  if (reg.user_id !== user.id) {
    const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle()
    const roles = profile?.roles ?? []
    if (!roles.some(r => COMMITTEE_ROLES.includes(r))) return res.status(403).json({ error: 'Forbidden' })
  }

  const result = await computeAndWriteAmountOwing(registrationId)
  if (result.error) return res.status(500).json({ error: result.error })

  return res.json({ amountOwing: result.amountOwing })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const body = req.body ?? {}
  const { action } = body

  if (action === 'cancel') return cancelRegistration(user, body, res)
  if (action === 'recompute-owing') return recomputeOwing(user, body, res)

  return res.status(400).json({ error: `Unknown action: ${action}` })
}
