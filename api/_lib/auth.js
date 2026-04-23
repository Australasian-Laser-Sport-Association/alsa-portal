import supabaseAdmin from './supabase.js'

const COMMITTEE_ROLES = ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']

export async function verifyUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return { user: null, error: 'Unauthorized' }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return { user: null, error: 'Unauthorized' }
  return { user, error: null }
}

export async function verifyCommittee(req) {
  const { user, error } = await verifyUser(req)
  if (error) return { user: null, roles: null, error }
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('roles')
    .eq('id', user.id)
    .single()
  const roles = profile?.roles ?? []
  if (!roles.some(r => COMMITTEE_ROLES.includes(r))) {
    return { user: null, roles: null, error: 'Forbidden' }
  }
  return { user, roles, error: null }
}

export async function verifySuperAdmin(req) {
  const { user, roles, error } = await verifyCommittee(req)
  if (error) return { user: null, error }
  if (!roles.includes('superadmin')) return { user: null, error: 'Forbidden' }
  return { user, error: null }
}
