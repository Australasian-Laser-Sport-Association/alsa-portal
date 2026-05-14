import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'
import { COMMITTEE_ROLES } from '../../src/lib/roles.js'
import { computeAndWriteAmountOwing } from '../_lib/computeAmountOwing.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const { registrationId } = req.body ?? {}
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
