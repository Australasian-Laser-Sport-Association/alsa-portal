import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'

export default async function handler(req, res) {
  const { id } = req.query

  // Single-user operations when ?id is present
  if (id) {
    if (req.method === 'GET') {
      const { error } = await verifyCommittee(req)
      if (error) return res.status(statusForAuthError(error)).json({ error })

      const [
        { data: registrations, error: e1 },
        { data: payments, error: e2 },
      ] = await Promise.all([
        supabaseAdmin.from('zltac_registrations').select('*, teams(name)').eq('user_id', id).order('year', { ascending: false }),
        supabaseAdmin.from('payments').select('*').eq('user_id', id).order('created_at', { ascending: false }),
      ])

      const errs = [e1, e2].filter(Boolean)
      if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })
      return res.json({ registrations, payments })
    }

    if (req.method === 'PATCH') {
      const { error } = await verifyCommittee(req)
      if (error) return res.status(statusForAuthError(error)).json({ error })

      const body = req.body ?? {}
      let update = {}
      if (Array.isArray(body.roles)) update = { roles: body.roles }
      else if (typeof body.suspended === 'boolean') update = { suspended: body.suspended }
      else return res.status(400).json({ error: 'roles or suspended is required' })

      const { error: patchErr } = await supabaseAdmin.from('profiles').update(update).eq('id', id)
      if (patchErr) return res.status(500).json({ error: patchErr.message })
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const { error } = await verifySuperAdmin(req)
      if (error) return res.status(statusForAuthError(error)).json({ error })

      const { error: delErr } = await supabaseAdmin.from('profiles').delete().eq('id', id)
      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Bulk GET — no ?id
  const { error } = await verifyCommittee(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

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
