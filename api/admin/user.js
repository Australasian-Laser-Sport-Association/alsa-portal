import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, verifySuperAdmin } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { error } = await verifyCommittee(req)
    if (error) return res.status(error === 'Unauthorized' ? 401 : 403).json({ error })

    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id is required' })

    const [
      { data: registrations, error: e1 },
      { data: payments, error: e2 },
    ] = await Promise.all([
      supabaseAdmin
        .from('zltac_registrations')
        .select('*, teams(name)')
        .eq('user_id', id)
        .order('year', { ascending: false }),
      supabaseAdmin
        .from('payments')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false }),
    ])

    const errs = [e1, e2].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

    return res.json({ registrations, payments })
  }

  if (req.method === 'PATCH') {
    const { error } = await verifyCommittee(req)
    if (error) return res.status(error === 'Unauthorized' ? 401 : 403).json({ error })

    const { id } = req.query
    const body = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })

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
    if (error) return res.status(error === 'Unauthorized' ? 401 : 403).json({ error })

    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { error: delErr } = await supabaseAdmin.from('profiles').delete().eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
