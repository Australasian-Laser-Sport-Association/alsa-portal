import supabaseAdmin from '../_lib/supabase.js'
import { verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'

// Superadmin-only CRUD over public.competitions. Manager-facing edits (a
// manager updating their own competition) land in Phase 1c alongside the
// manager UI — keep this route strictly superadmin so role boundaries don't
// drift before then.
//
// Response shape mirrors /api/admin/*: bare object, no envelope, errors as
// { error: '<message>' }. Creation responses use 201; everything else 200.

const SLUG_RE = /^[a-z0-9-]+$/

// Whitelist of fields the PATCH endpoint will accept. slug is intentionally
// omitted (URLs may already exist by the time anyone tries to rename), and
// created_by / created_at are immutable.
const PATCH_FIELDS = [
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
// validation failure. Called by both POST (full body) and PATCH (subset).
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

export default async function handler(req, res) {
  const { user, error: authErr } = await verifySuperAdmin(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

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
    for (const k of PATCH_FIELDS) {
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
