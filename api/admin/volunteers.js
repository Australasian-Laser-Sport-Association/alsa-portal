import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'

// Committee-gated volunteer admin. Dispatches by ?resource=:
//   ?resource=roles    → volunteer_roles CRUD (GET / POST / PATCH&id / DELETE&id)
//   ?resource=settings → event_volunteer_settings (GET&eventId / PUT&eventId)
//   ?resource=signups  → signups list + decisions + manual create
//
// Consolidated from api/admin/volunteer-roles.js + event-volunteer-settings.js
// + volunteer-signups.js to stay under the Vercel Hobby function cap. All three
// use the same verifyCommittee + service-role (ADR-0002) strategy.

const CODE_RE = /^[A-Z0-9]{1,5}$/
const VALID_STATUS = new Set(['pending', 'approved', 'declined'])
const DEFAULT_CAVEAT = 'Note: Not all volunteers will be utilised. Selection is based on the operational capacity of the ZLTAC event.'
const VOLUNTEER_ROLE_COLUMNS = 'id, code, name, short_description, target_count, min_count, requires_experience, experience_notes, is_default, sort_order, is_active, created_at, updated_at'
const EVENT_VOLUNTEER_SETTINGS_COLUMNS = 'id, event_id, required_per_team, count_per_team, enforcement, caveat_message, created_at, updated_at'

// ── roles helpers ─────────────────────────────────────────────────────────────
function parseCount(v) {
  if (v === '' || v === null || v === undefined) return { value: null }
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) return { error: true }
  return { value: n }
}

function validateAndBuild(body, { partial }) {
  const out = {}
  const present = k => Object.prototype.hasOwnProperty.call(body, k)

  if (!partial || present('code')) {
    const code = (body.code ?? '').toString().trim().toUpperCase()
    if (!code) return { error: 'Code is required.', field: 'code' }
    if (!CODE_RE.test(code)) return { error: 'Code must be 1–5 uppercase letters or numbers.', field: 'code' }
    out.code = code
  }
  if (!partial || present('name')) {
    const name = (body.name ?? '').toString().trim()
    if (!name) return { error: 'Name is required.', field: 'name' }
    out.name = name
  }
  if (!partial || present('short_description')) {
    const sd = (body.short_description ?? '').toString().trim()
    if (!sd) return { error: 'Short description is required.', field: 'short_description' }
    out.short_description = sd
  }
  for (const key of ['target_count', 'min_count']) {
    if (!partial || present(key)) {
      const r = parseCount(body[key])
      if (r.error) return { error: `${key === 'target_count' ? 'Target' : 'Min'} count must be a non-negative whole number.`, field: key }
      out[key] = r.value
    }
  }
  if (!partial || present('sort_order')) {
    const r = parseCount(body.sort_order)
    if (r.error) return { error: 'Sort order must be a non-negative whole number.', field: 'sort_order' }
    out.sort_order = r.value ?? 0
  }
  if (!partial || present('requires_experience')) out.requires_experience = !!body.requires_experience
  if (!partial || present('experience_notes')) {
    out.experience_notes = body.experience_notes ? body.experience_notes.toString().trim() || null : null
  }
  if (!partial || present('is_default')) out.is_default = !!body.is_default
  if (!partial || present('is_active')) out.is_active = !!body.is_active

  if (out.requires_experience === false && present('requires_experience')) out.experience_notes = null

  return { payload: out }
}

async function handleRoles(req, res) {
  const { id } = req.query

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('volunteer_roles')
      .select(VOLUNTEER_ROLE_COLUMNS)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ roles: data ?? [] })
  }

  if (req.method === 'POST') {
    const { payload, error: vErr, field } = validateAndBuild(req.body ?? {}, { partial: false })
    if (vErr) return res.status(400).json({ error: vErr, field })

    const { data, error } = await supabaseAdmin.from('volunteer_roles').insert(payload).select(VOLUNTEER_ROLE_COLUMNS).single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A role with this code already exists.', field: 'code' })
      return res.status(500).json({ error: error.message })
    }
    if (payload.is_default) {
      const { error: clrErr } = await supabaseAdmin.from('volunteer_roles').update({ is_default: false }).neq('id', data.id)
      if (clrErr) return res.status(500).json({ error: clrErr.message })
    }
    return res.json({ role: data })
  }

  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'id is required' })
    const { payload, error: vErr, field } = validateAndBuild(req.body ?? {}, { partial: true })
    if (vErr) return res.status(400).json({ error: vErr, field })
    if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'No fields to update' })

    const { data, error } = await supabaseAdmin.from('volunteer_roles').update(payload).eq('id', id).select(VOLUNTEER_ROLE_COLUMNS).single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A role with this code already exists.', field: 'code' })
      return res.status(500).json({ error: error.message })
    }
    if (payload.is_default === true) {
      const { error: clrErr } = await supabaseAdmin.from('volunteer_roles').update({ is_default: false }).neq('id', id)
      if (clrErr) return res.status(500).json({ error: clrErr.message })
    }
    return res.json({ role: data })
  }

  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { count, error: cntErr } = await supabaseAdmin
      .from('volunteer_signup_roles')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', id)
    if (cntErr) return res.status(500).json({ error: cntErr.message })
    if ((count ?? 0) > 0) {
      return res.status(409).json({
        error: `This role is referenced by ${count} volunteer signup${count === 1 ? '' : 's'} and can't be hard-deleted.`,
        referenceCount: count,
      })
    }

    const { error: delErr } = await supabaseAdmin.from('volunteer_roles').delete().eq('id', id)
    if (delErr) {
      if (delErr.code === '23503') {
        return res.status(409).json({ error: "This role is now in use and can't be hard-deleted.", referenceCount: null })
      }
      return res.status(500).json({ error: delErr.message })
    }
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── settings ──────────────────────────────────────────────────────────────────
async function handleSettings(req, res) {
  const { eventId } = req.query
  if (!eventId) return res.status(400).json({ error: 'eventId is required' })

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('event_volunteer_settings')
      .select(EVENT_VOLUNTEER_SETTINGS_COLUMNS)
      .eq('event_id', eventId)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'No volunteer settings for this event' })
    return res.json({ settings: data })
  }

  if (req.method === 'PUT') {
    const body = req.body ?? {}
    const enforcement = body.enforcement === 'hard' ? 'hard' : 'soft'

    let count_per_team = null
    if (body.required_per_team) {
      const raw = body.count_per_team
      if (raw === '' || raw === null || raw === undefined) {
        count_per_team = null
      } else {
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 0) {
          return res.status(400).json({ error: 'Count per team must be a non-negative whole number.', field: 'count_per_team' })
        }
        count_per_team = n
      }
    }

    const caveat = (body.caveat_message ?? '').toString().trim() || DEFAULT_CAVEAT

    const payload = {
      event_id: eventId,
      required_per_team: !!body.required_per_team,
      count_per_team,
      enforcement,
      caveat_message: caveat,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabaseAdmin
      .from('event_volunteer_settings')
      .upsert(payload, { onConflict: 'event_id' })
      .select(EVENT_VOLUNTEER_SETTINGS_COLUMNS)
      .single()
    if (error) {
      if (error.code === '23503') return res.status(400).json({ error: 'Unknown event.' })
      return res.status(500).json({ error: error.message })
    }
    return res.json({ settings: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── signups helpers ───────────────────────────────────────────────────────────
async function fetchEnrichedSignups({ signupId = null, year = null } = {}) {
  let query = supabaseAdmin
    .from('volunteer_signups')
    .select('id, notes, created_at, registration_id, zltac_registrations!inner ( user_id, team_id, year ), volunteer_signup_roles ( role_id, status, decided_at, volunteer_roles ( id, code, name ) )')
    .order('created_at', { ascending: false })
  if (signupId) query = query.eq('id', signupId)
  if (year != null) query = query.eq('zltac_registrations.year', year)

  const { data: rows, error } = await query
  if (error) return { error }

  const signups = (rows ?? []).map(r => {
    const reg = r.zltac_registrations ?? {}
    const roles = (r.volunteer_signup_roles ?? [])
      .filter(sr => sr.volunteer_roles)
      .map(sr => ({
        id: sr.volunteer_roles.id,
        code: sr.volunteer_roles.code,
        name: sr.volunteer_roles.name,
        status: sr.status ?? 'pending',
        decided_at: sr.decided_at ?? null,
      }))
    return {
      id: r.id,
      notes: r.notes ?? '',
      created_at: r.created_at,
      user_id: reg.user_id ?? null,
      team_id: reg.team_id ?? null,
      year: reg.year ?? null,
      roles,
    }
  })

  const userIds = [...new Set(signups.map(s => s.user_id).filter(Boolean))]
  const teamIds = [...new Set(signups.map(s => s.team_id).filter(Boolean))]
  const years   = [...new Set(signups.map(s => s.year).filter(v => v != null))]

  const [{ data: profiles }, { data: teams }, { data: events }] = await Promise.all([
    userIds.length ? supabaseAdmin.from('profiles').select('id, first_name, last_name, alias, phone, email').in('id', userIds) : Promise.resolve({ data: [] }),
    teamIds.length ? supabaseAdmin.from('teams').select('id, name').in('id', teamIds) : Promise.resolve({ data: [] }),
    years.length ? supabaseAdmin.from('zltac_events').select('year, name').in('year', years) : Promise.resolve({ data: [] }),
  ])

  const profMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
  const teamMap = Object.fromEntries((teams ?? []).map(t => [t.id, t.name]))
  const eventMap = Object.fromEntries((events ?? []).map(e => [e.year, e.name]))

  // email comes from the profiles.email mirror (synced from auth.users), so a
  // placeholder profile (no auth row) surfaces email: null — same as the old
  // getUserById fan-out, without the per-row Auth Admin calls.
  const enriched = signups.map(s => {
    const p = profMap[s.user_id] ?? {}
    return {
      id: s.id,
      notes: s.notes,
      created_at: s.created_at,
      user_id: s.user_id,
      roles: s.roles,
      full_name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      alias: p.alias ?? null,
      phone: p.phone ?? null,
      email: p.email ?? null,
      team_name: s.team_id ? (teamMap[s.team_id] ?? null) : null,
      event_year: s.year,
      event_name: s.year != null ? (eventMap[s.year] ?? `ZLTAC ${s.year}`) : null,
    }
  })

  return { signups: enriched }
}

async function handleSignups(req, res, user) {
  // ── GET — filterable list ──
  if (req.method === 'GET') {
    const { event_id, role_id, has_notes } = req.query
    const roleFilter = role_id ? String(role_id).split(',').map(s => s.trim()).filter(Boolean) : []
    const notesOnly = has_notes === 'true' || has_notes === '1'

    let year = null
    if (event_id) {
      const { data: ev, error: evErr } = await supabaseAdmin
        .from('zltac_events').select('year').eq('id', event_id).maybeSingle()
      if (evErr) return res.status(500).json({ error: evErr.message })
      if (!ev) return res.json({ signups: [] })
      year = ev.year
    }

    const { signups, error } = await fetchEnrichedSignups({ year })
    if (error) return res.status(500).json({ error: error.message })

    let result = signups
    if (roleFilter.length) {
      const want = new Set(roleFilter)
      result = result.filter(s => s.roles.some(r => want.has(r.id)))
    }
    if (notesOnly) result = result.filter(s => s.notes.trim().length > 0)

    return res.json({ signups: result })
  }

  // ── PATCH ?signup_id= — upsert per-role decisions ──
  if (req.method === 'PATCH') {
    const signupId = req.query.signup_id
    if (!signupId) return res.status(400).json({ error: 'signup_id is required' })

    const decisions = Array.isArray(req.body?.role_decisions) ? req.body.role_decisions : []
    if (decisions.length === 0) return res.status(400).json({ error: 'role_decisions is required' })
    for (const d of decisions) {
      if (!d || !d.role_id || !VALID_STATUS.has(d.status)) {
        return res.status(400).json({ error: 'Each decision needs a role_id and a valid status.' })
      }
    }

    const { data: signup, error: sErr } = await supabaseAdmin
      .from('volunteer_signups').select('id').eq('id', signupId).maybeSingle()
    if (sErr) return res.status(500).json({ error: sErr.message })
    if (!signup) return res.status(404).json({ error: 'Signup not found' })

    const { data: existingRows, error: erErr } = await supabaseAdmin
      .from('volunteer_signup_roles').select('id, role_id').eq('signup_id', signupId)
    if (erErr) return res.status(500).json({ error: erErr.message })
    const rowIdByRole = Object.fromEntries((existingRows ?? []).map(r => [r.role_id, r.id]))

    const nowIso = new Date().toISOString()
    const uniq = Object.values(Object.fromEntries(decisions.map(d => [d.role_id, d])))

    const inserts = []
    for (const d of uniq) {
      const decided = d.status !== 'pending'
      const fields = { status: d.status, decided_by: decided ? user.id : null, decided_at: decided ? nowIso : null }
      if (rowIdByRole[d.role_id]) {
        const { error } = await supabaseAdmin
          .from('volunteer_signup_roles').update(fields).eq('id', rowIdByRole[d.role_id])
        if (error) return res.status(500).json({ error: error.message })
      } else {
        inserts.push({ signup_id: signupId, role_id: d.role_id, ...fields })
      }
    }
    if (inserts.length) {
      const { error } = await supabaseAdmin.from('volunteer_signup_roles').insert(inserts)
      if (error) return res.status(500).json({ error: error.message })
    }

    const { signups, error: fErr } = await fetchEnrichedSignups({ signupId })
    if (fErr) return res.status(500).json({ error: fErr.message })
    return res.json({ signup: signups[0] ?? null })
  }

  // ── POST — manual signup (all roles approved) ──
  if (req.method === 'POST') {
    const { registration_id, role_ids, notes } = req.body ?? {}
    if (!registration_id) return res.status(400).json({ error: 'registration_id is required' })
    const roleIds = Array.isArray(role_ids) ? [...new Set(role_ids.filter(Boolean))] : []
    if (roleIds.length === 0) return res.status(400).json({ error: 'Select at least one role.' })

    const { data: reg, error: regErr } = await supabaseAdmin
      .from('zltac_registrations').select('id').eq('id', registration_id).maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) return res.status(404).json({ error: 'Registration not found' })

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('volunteer_signups').select('id').eq('registration_id', registration_id).maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (existing) {
      return res.status(409).json({ error: 'This player already has a volunteer signup.', existing_signup_id: existing.id })
    }

    const { data: validRoles, error: vrErr } = await supabaseAdmin
      .from('volunteer_roles').select('id').in('id', roleIds).eq('is_active', true)
    if (vrErr) return res.status(500).json({ error: vrErr.message })
    const validIds = new Set((validRoles ?? []).map(r => r.id))
    if (roleIds.some(id => !validIds.has(id))) {
      return res.status(400).json({ error: 'One or more selected roles are invalid or inactive.' })
    }

    const cleanNotes = typeof notes === 'string' ? notes.slice(0, 1000).trim() : ''
    const { data: created, error: insErr } = await supabaseAdmin
      .from('volunteer_signups').insert({ registration_id, notes: cleanNotes || null }).select('id').single()
    if (insErr) return res.status(500).json({ error: insErr.message })

    const nowIso = new Date().toISOString()
    const { error: rolesErr } = await supabaseAdmin.from('volunteer_signup_roles').insert(
      roleIds.map(role_id => ({ signup_id: created.id, role_id, status: 'approved', decided_by: user.id, decided_at: nowIso }))
    )
    if (rolesErr) return res.status(500).json({ error: rolesErr.message })

    const { signups, error: fErr } = await fetchEnrichedSignups({ signupId: created.id })
    if (fErr) return res.status(500).json({ error: fErr.message })
    return res.status(201).json({ signup: signups[0] ?? null })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { user, error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const resource = req.query.resource
  if (resource === 'roles')    return handleRoles(req, res)
  if (resource === 'settings') return handleSettings(req, res)
  if (resource === 'signups')  return handleSignups(req, res, user)
  return res.status(400).json({ error: 'resource query param must be "roles", "settings", or "signups"' })
}
