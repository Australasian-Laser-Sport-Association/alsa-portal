import { createClient } from '@supabase/supabase-js'
import { sendServerError } from './_lib/apiErrors.js'
import { verifyUser } from './_lib/auth.js'
import { eventPhase } from '../src/lib/eventPhase.js'
import { enforceRateLimit } from './_lib/rateLimit.js'

// Player-facing volunteer signup. One flat handler (Vercel function-count cap):
//   GET    ?registration_id=  → caller's signup (roles + status + notes) or 404
//   PUT    ?registration_id=  → upsert signup + sync roles ({ role_ids, notes })
//   DELETE ?registration_id=  → remove signup (cascade clears roles)
//
// Data ops run through an auth-scoped (RLS) client built from the caller's JWT,
// so ownership is enforced by the volunteer_signups_own / *_roles_own_* policies
// (defence-in-depth) on top of the explicit ownership check below. Lock-date and
// approval rules are enforced here in the app layer:
//   - past rego-close (event_starts_at) → always blocked.
//   - past rego-lock (reg_close_date) AND the signup predates the lock → blocked.
//     (A post-lock opt-in stays editable until rego-close.)
//   - PUT never touches decided (approved/declined) role-rows — Phase 4.
//   - DELETE is blocked while any role is approved (withdraw via committee).

const LOCKED_MSG = 'Volunteer details are locked. Contact the committee to make changes.'
const CLOSED_MSG = 'Volunteer applications for this event are closed.'
const APPROVED_MSG = 'Contact committee to withdraw — you have an approved role.'

function authClient(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
}

// Shape a volunteer_signups row (with embedded roles) for the client.
function shapeSignup(signup) {
  return {
    id: signup.id,
    notes: signup.notes ?? '',
    created_at: signup.created_at,
    roles: (signup.volunteer_signup_roles ?? []).map(r => ({
      role_id: r.role_id,
      status: r.status ?? 'pending',
      decided_at: r.decided_at ?? null,
    })),
  }
}

export default async function handler(req, res) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(401).json({ error: authErr })
  if ((req.method === 'PUT' || req.method === 'DELETE') && !await enforceRateLimit(req, res, {
    identifier: user.id,
    limit: 30,
    window: '1 m',
    prefix: 'volunteer-mutations',
    requireDistributed: true,
  })) return

  const registrationId = req.query.registration_id
  if (!registrationId) return res.status(400).json({ error: 'registration_id is required' })

  const db = authClient(req)

  // Ownership + event context. RLS already limits this to the caller's own
  // registration; the explicit check returns a clear 403/404 regardless.
  const { data: reg, error: regErr } = await db
    .from('zltac_registrations')
    .select('id, user_id, year')
    .eq('id', registrationId)
    .maybeSingle()
  if (regErr) return sendServerError(res, regErr, 'volunteer-signup:reg')
  if (!reg) return res.status(404).json({ error: 'Registration not found' })
  if (reg.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' })

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: signup, error } = await db
      .from('volunteer_signups')
      .select('id, notes, created_at, volunteer_signup_roles ( role_id, status, decided_at )')
      .eq('registration_id', registrationId)
      .maybeSingle()
    if (error) return sendServerError(res, error, 'volunteer-signup:error')
    if (!signup) return res.status(404).json({ error: 'No volunteer signup for this registration' })
    return res.json({ signup: shapeSignup(signup) })
  }

  if (req.method === 'PUT' || req.method === 'DELETE') {
    // Lock evaluation. Read the event's boundaries + any existing signup.
    const { data: ev, error: evErr } = await db
      .from('zltac_events')
      .select('reg_close_date, event_starts_at')
      .eq('year', reg.year)
      .maybeSingle()
    if (evErr) return sendServerError(res, evErr, 'volunteer-signup:ev')

    const phase = eventPhase(ev)
    const lockAt = ev?.reg_close_date ? new Date(ev.reg_close_date) : null

    const { data: existing, error: exErr } = await db
      .from('volunteer_signups')
      .select('id, created_at')
      .eq('registration_id', registrationId)
      .maybeSingle()
    if (exErr) return sendServerError(res, exErr, 'volunteer-signup:ex')

    const isPreLockSignup = !!(existing && lockAt && new Date(existing.created_at) < lockAt)

    if (phase === 'closed') return res.status(403).json({ error: CLOSED_MSG, phase })
    if (phase === 'locked' && isPreLockSignup) return res.status(403).json({ error: LOCKED_MSG, phase })

    // ── DELETE ──
    if (req.method === 'DELETE') {
      if (!existing) return res.json({ ok: true }) // idempotent no-op
      const { data: roleRows, error: rrErr } = await db
        .from('volunteer_signup_roles')
        .select('status')
        .eq('signup_id', existing.id)
      if (rrErr) return sendServerError(res, rrErr, 'volunteer-signup:rr')
      if ((roleRows ?? []).some(r => r.status === 'approved')) {
        return res.status(403).json({ error: APPROVED_MSG })
      }
      const { error: delErr } = await db.from('volunteer_signups').delete().eq('registration_id', registrationId)
      if (delErr) return sendServerError(res, delErr, 'volunteer-signup:del')
      return res.json({ ok: true })
    }

    // ── PUT ──
    const body = req.body ?? {}
    const roleIds = Array.isArray(body.role_ids) ? [...new Set(body.role_ids.filter(Boolean))] : []
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : ''
    if (roleIds.length === 0) return res.status(400).json({ error: 'Select at least one role.' })

    // Upsert the signup first (need its id to diff role-rows). created_at is
    // preserved on update, so the lock check above stays meaningful across edits.
    const { data: signup, error: upErr } = await db
      .from('volunteer_signups')
      .upsert({ registration_id: registrationId, notes: notes || null }, { onConflict: 'registration_id' })
      .select('id, created_at')
      .single()
    if (upErr) return sendServerError(res, upErr, 'volunteer-signup:up')

    const { data: currentRows, error: curErr } = await db
      .from('volunteer_signup_roles')
      .select('role_id, status')
      .eq('signup_id', signup.id)
    if (curErr) return sendServerError(res, curErr, 'volunteer-signup:cur')
    const currentByRole = new Map((currentRows ?? []).map(r => [r.role_id, r.status]))

    const toAdd = roleIds.filter(id => !currentByRole.has(id))
    // Only remove still-pending rows the player unticked. Decided rows stay put
    // (RLS also blocks the player from deleting non-pending rows).
    const toRemove = (currentRows ?? [])
      .filter(r => !roleIds.includes(r.role_id) && r.status === 'pending')
      .map(r => r.role_id)

    // Validate only newly-added roles are active — a previously-decided role that
    // later goes inactive shouldn't block the player editing the rest.
    if (toAdd.length) {
      const { data: validRoles, error: vrErr } = await db
        .from('volunteer_roles').select('id').in('id', toAdd).eq('is_active', true)
      if (vrErr) return sendServerError(res, vrErr, 'volunteer-signup:vr')
      const validIds = new Set((validRoles ?? []).map(r => r.id))
      if (toAdd.some(id => !validIds.has(id))) {
        return res.status(400).json({ error: 'One or more selected roles are invalid or inactive.' })
      }
    }

    if (toRemove.length) {
      const { error: rmErr } = await db
        .from('volunteer_signup_roles')
        .delete()
        .eq('signup_id', signup.id)
        .in('role_id', toRemove)
      if (rmErr) return sendServerError(res, rmErr, 'volunteer-signup:rm')
    }
    if (toAdd.length) {
      const { error: addErr } = await db
        .from('volunteer_signup_roles')
        .insert(toAdd.map(role_id => ({ signup_id: signup.id, role_id, status: 'pending' })))
      if (addErr) return sendServerError(res, addErr, 'volunteer-signup:add')
    }

    const { data: finalRows, error: fErr } = await db
      .from('volunteer_signup_roles')
      .select('role_id, status, decided_at')
      .eq('signup_id', signup.id)
    if (fErr) return sendServerError(res, fErr, 'volunteer-signup:f')

    return res.json({
      signup: {
        id: signup.id,
        notes,
        created_at: signup.created_at,
        roles: (finalRows ?? []).map(r => ({ role_id: r.role_id, status: r.status ?? 'pending', decided_at: r.decided_at ?? null })),
      },
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
