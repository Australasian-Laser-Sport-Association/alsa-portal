import supabaseAdmin from '../_lib/supabase.js'
import { verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'

// Superadmin-only grants table for competition_managers. The
// manager-can-see-peers SELECT path comes in Phase 1c alongside the manager
// UI; this file is exclusively the admin grant/revoke surface.
//
// Response shape matches /api/admin/*: bare object, errors as
// { error: '<message>' }. Creation returns 201; revoke returns 200 with
// { deleted: true }; missing-grant DELETE returns 404.

function badRequest(res, message) {
  return res.status(400).json({ error: message })
}

export default async function handler(req, res) {
  const { user, error: authErr } = await verifySuperAdmin(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (req.method === 'GET') {
    const competitionId = req.query.competition_id
    if (!competitionId) return badRequest(res, 'competition_id query param is required')

    // Embed the manager's profile so the caller can render the list without a
    // second round-trip. Email lives on auth.users (not profiles), so we
    // fetch it separately and merge — same pattern other admin routes use.
    const { data: rows, error } = await supabaseAdmin
      .from('competition_managers')
      .select('user_id, granted_at, granted_by, profiles:user_id(alias, first_name, last_name)')
      .eq('competition_id', competitionId)
      .order('granted_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })

    // SECURITY NOTE: response includes email per manager. Caller (superadmin grant UI) needs it to disambiguate users. Do not surface this endpoint to non-superadmin contexts.
    // Pull emails for the granted users from auth.users via the admin API.
    // Cheap because manager grants per competition are a tiny set.
    const out = []
    for (const r of (rows ?? [])) {
      let email = null
      try {
        const { data: au } = await supabaseAdmin.auth.admin.getUserById(r.user_id)
        email = au?.user?.email ?? null
      } catch {
        // Placeholder profiles have no auth.users row — leave email null.
      }
      out.push({
        user_id: r.user_id,
        granted_at: r.granted_at,
        granted_by: r.granted_by,
        profile: {
          alias: r.profiles?.alias ?? null,
          first_name: r.profiles?.first_name ?? null,
          last_name: r.profiles?.last_name ?? null,
          email,
        },
      })
    }
    return res.json(out)
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const competitionId = body.competition_id
    const userId = body.user_id
    if (!competitionId || !userId) return badRequest(res, 'competition_id and user_id are required')

    // Validate both refs exist so the caller gets a clearer error than the raw
    // FK-violation surface from Postgres. Placeholders have no auth.users row
    // and therefore can't log in to act as a manager — reject explicitly so
    // the admin notices and waits for the user to claim their account.
    const [{ data: comp, error: cErr }, { data: prof, error: pErr }] = await Promise.all([
      supabaseAdmin.from('competitions').select('id').eq('id', competitionId).maybeSingle(),
      supabaseAdmin.from('profiles').select('id, is_placeholder').eq('id', userId).maybeSingle(),
    ])
    if (cErr) return res.status(500).json({ error: cErr.message })
    if (pErr) return res.status(500).json({ error: pErr.message })
    if (!comp) return res.status(404).json({ error: 'competition not found' })
    if (!prof) return res.status(404).json({ error: 'user not found' })
    if (prof.is_placeholder) {
      return res.status(400).json({
        error: 'Cannot grant manager access to a placeholder profile. The user must have claimed their account.',
      })
    }

    const { data, error } = await supabaseAdmin
      .from('competition_managers')
      .insert({
        competition_id: competitionId,
        user_id: userId,
        granted_by: user.id,
      })
      .select()
      .single()
    if (error) {
      // 23505 = unique_violation. The composite PK is the only realistic
      // collision (one grant per (competition, user)).
      if (error.code === '23505') {
        return res.status(409).json({ error: 'this user is already a manager of that competition' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.status(201).json(data)
  }

  if (req.method === 'DELETE') {
    const competitionId = req.query.competition_id ?? req.body?.competition_id
    const userId = req.query.user_id ?? req.body?.user_id
    if (!competitionId || !userId) return badRequest(res, 'competition_id and user_id are required')

    const { data, error } = await supabaseAdmin
      .from('competition_managers')
      .delete()
      .eq('competition_id', competitionId)
      .eq('user_id', userId)
      .select()
    if (error) return res.status(500).json({ error: error.message })
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'no such grant' })
    }
    return res.json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
