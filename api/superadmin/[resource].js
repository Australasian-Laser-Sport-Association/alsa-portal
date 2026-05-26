import supabaseAdmin from '../_lib/supabase.js'
import { verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'

// Catch-all dispatcher for superadmin-only endpoints, consolidated into one
// Vercel function to stay under the Hobby plan's 12-function ceiling.
//
// URL surface preserved exactly so existing callers/tests don't need changes:
//   /api/superadmin/competitions         → POST, GET, PATCH
//   /api/superadmin/competition-managers → POST, GET, DELETE
//
// Vercel maps [resource].js to req.query.resource. Auth runs once at the top
// (every branch needs superadmin); method routing and validation inside each
// branch are unchanged from the original per-resource files.
//
// Response shape mirrors /api/admin/*: bare object, no envelope, errors as
// { error: '<message>' }. Creation responses use 201; everything else 200.

const SLUG_RE = /^[a-z0-9-]+$/

// Whitelist of fields the competitions PATCH endpoint will accept. slug is
// intentionally omitted (URLs may already exist by the time anyone tries to
// rename), and created_by / created_at are immutable.
const COMPETITION_PATCH_FIELDS = [
  'name',
  'start_date',
  'end_date',
  'registration_open_at',
  'registration_close_at',
  'price_per_player',
  'bank_account_name',
  'bank_bsb',
  'bank_account_number',
  'payment_info_visible',
  'archived_at',
]

function badRequest(res, message) {
  return res.status(400).json({ error: message })
}

// Returns null on success, or a string error message describing the first
// validation failure. Called by both POST (full body) and PATCH (subset) on
// the competitions branch.
function validateDates({ start_date, end_date, registration_open_at, registration_close_at }) {
  if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
    return 'end_date must be on or after start_date'
  }
  if (registration_open_at && registration_close_at
      && new Date(registration_close_at) < new Date(registration_open_at)) {
    return 'registration_close_at must be on or after registration_open_at'
  }
  return null
}


// ── competitions ──────────────────────────────────────────────────────────────
async function handleCompetitions(req, res, user) {
  if (req.method === 'GET') {
    const includeArchived = req.query.include_archived === '1'
    let q = supabaseAdmin.from('competitions').select('*').order('start_date', { ascending: false })
    if (!includeArchived) q = q.is('archived_at', null)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data ?? [])
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const slug = (body.slug ?? '').trim()
    const name = (body.name ?? '').trim()
    const { start_date, end_date } = body
    if (!slug) return badRequest(res, 'slug is required')
    if (!SLUG_RE.test(slug)) return badRequest(res, 'slug must match ^[a-z0-9-]+$')
    if (!name) return badRequest(res, 'name is required')
    if (!start_date || !end_date) return badRequest(res, 'start_date and end_date are required')
    const dateErr = validateDates(body)
    if (dateErr) return badRequest(res, dateErr)

    const insertRow = {
      slug,
      name,
      start_date,
      end_date,
      registration_open_at: body.registration_open_at ?? null,
      registration_close_at: body.registration_close_at ?? null,
      price_per_player: body.price_per_player ?? null,
      bank_account_name: body.bank_account_name ?? null,
      bank_bsb: body.bank_bsb ?? null,
      bank_account_number: body.bank_account_number ?? null,
      created_by: user.id,
    }
    const { data, error } = await supabaseAdmin
      .from('competitions')
      .insert(insertRow)
      .select()
      .single()
    if (error) {
      // 23505 = unique_violation. The slug UNIQUE index is the only realistic
      // collision on this endpoint, so surface it as 409 with a clear message.
      if (error.code === '23505') {
        return res.status(409).json({ error: `slug "${slug}" is already in use` })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.status(201).json(data)
  }

  if (req.method === 'PATCH') {
    const id = req.query.id ?? req.body?.id
    if (!id) return badRequest(res, 'competition id is required (?id= or body.id)')

    const body = req.body ?? {}
    const updates = {}
    for (const k of COMPETITION_PATCH_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, k)) updates[k] = body[k]
    }
    if (Object.keys(updates).length === 0) {
      return badRequest(res, 'no editable fields supplied')
    }

    // Re-validate dates against the merged view: pull the current row, layer
    // the patch on top, and run the same validator the POST path uses. This
    // catches "lower end_date below the existing start_date" without needing
    // to ask the caller to send both.
    const { data: existing, error: getErr } = await supabaseAdmin
      .from('competitions')
      .select('start_date, end_date, registration_open_at, registration_close_at')
      .eq('id', id)
      .maybeSingle()
    if (getErr) return res.status(500).json({ error: getErr.message })
    if (!existing) return res.status(404).json({ error: 'competition not found' })

    const merged = { ...existing, ...updates }
    const dateErr = validateDates(merged)
    if (dateErr) return badRequest(res, dateErr)

    const { data, error } = await supabaseAdmin
      .from('competitions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  if (req.method === 'DELETE') {
    // Hard delete is intentionally blocked — archive via PATCH { archived_at }.
    return res.status(405).json({ error: 'Use PATCH { archived_at } to archive a competition. Hard delete is not supported.' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-managers ──────────────────────────────────────────────────────
async function handleCompetitionManagers(req, res, user) {
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


// ── Dispatch ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { user, error: authErr } = await verifySuperAdmin(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const resource = req.query.resource
  if (resource === 'competitions')         return handleCompetitions(req, res, user)
  if (resource === 'competition-managers') return handleCompetitionManagers(req, res, user)
  return res.status(404).json({ error: 'unknown resource' })
}
