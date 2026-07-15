import supabaseAdmin from './_lib/supabase.js'
import { sendServerError } from './_lib/apiErrors.js'
import { verifyUser, statusForAuthError } from './_lib/auth.js'
import { enforceRateLimit } from './_lib/rateLimit.js'
import { isUuid, validateUuidList } from './_lib/idValidation.js'

// Player-facing volunteer signup. Reads are explicitly owner-scoped; writes
// use a service-only transactional RPC that repeats ownership, active-account,
// lifecycle, role-validity, and approved-evidence checks under row locks.

function shapeSignup(signup) {
  return {
    id: signup.id,
    notes: signup.notes ?? '',
    created_at: signup.created_at,
    roles: (signup.volunteer_signup_roles ?? []).map(role => ({
      role_id: role.role_id,
      status: role.status ?? 'pending',
      decided_at: role.decided_at ?? null,
    })),
  }
}

function sendVolunteerMutationError(res, error, context) {
  if (error?.hint === 'VOLUNTEER_CLOSED') {
    return res.status(403).json({ error: 'Volunteer applications for this event are closed.' })
  }
  if (error?.hint === 'VOLUNTEER_LOCKED') {
    return res.status(403).json({ error: 'Volunteer details are locked. Contact the committee to make changes.' })
  }
  if (error?.hint === 'VOLUNTEER_APPROVED') {
    return res.status(403).json({ error: 'Contact committee to withdraw because you have an approved role.' })
  }
  if (error?.code === '42501') return res.status(403).json({ error: 'Forbidden' })
  if (error?.code === 'P0002') return res.status(404).json({ error: 'Registration not found' })
  if (error?.code === '22023') return res.status(400).json({ error: 'Invalid volunteer signup request.' })
  if (error?.code === '55000') {
    return res.status(409).json({ error: 'Volunteer signup is not available for this registration.' })
  }
  return sendServerError(res, error, context)
}

export default async function handler(req, res) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })
  if ((req.method === 'PUT' || req.method === 'DELETE') && !await enforceRateLimit(req, res, {
    identifier: user.id,
    limit: 30,
    window: '1 m',
    prefix: 'volunteer-mutations',
    requireDistributed: true,
  })) return

  const registrationId = req.query.registration_id
  if (!registrationId) return res.status(400).json({ error: 'registration_id is required' })
  if (!isUuid(registrationId)) {
    return res.status(400).json({ error: 'registration_id must be a valid UUID' })
  }

  // The owner precheck keeps GET narrow and gives all methods a stable 403/404.
  // The mutation RPC independently repeats this decision from a locked row.
  const { data: registration, error: registrationError } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, user_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (registrationError) return sendServerError(res, registrationError, 'volunteer-signup:registration')
  if (!registration) return res.status(404).json({ error: 'Registration not found' })
  if (registration.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' })

  if (req.method === 'GET') {
    const { data: signup, error } = await supabaseAdmin
      .from('volunteer_signups')
      .select('id, notes, created_at, volunteer_signup_roles ( role_id, status, decided_at )')
      .eq('registration_id', registrationId)
      .maybeSingle()
    if (error) return sendServerError(res, error, 'volunteer-signup:get')
    if (!signup) return res.status(404).json({ error: 'No volunteer signup for this registration' })
    return res.json({ signup: shapeSignup(signup) })
  }

  if (req.method === 'DELETE') {
    const { data, error } = await supabaseAdmin.rpc('mutate_own_volunteer_signup', {
      p_actor_id: user.id,
      p_registration_id: registrationId,
      p_action: 'delete',
      p_role_ids: null,
      p_notes: null,
    })
    if (error) return sendVolunteerMutationError(res, error, 'volunteer-signup:delete')
    return res.json(data ?? { ok: true })
  }

  if (req.method === 'PUT') {
    const body = req.body ?? {}
    const checkedRoles = validateUuidList(body.role_ids, { name: 'role_ids', max: 50 })
    if (checkedRoles.error) return res.status(400).json({ error: checkedRoles.error })
    const roleIds = [...new Set(checkedRoles.ids)]
    if (roleIds.length === 0) return res.status(400).json({ error: 'Select at least one role.' })
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : ''

    const { data, error } = await supabaseAdmin.rpc('mutate_own_volunteer_signup', {
      p_actor_id: user.id,
      p_registration_id: registrationId,
      p_action: 'upsert',
      p_role_ids: roleIds,
      p_notes: notes,
    })
    if (error) return sendVolunteerMutationError(res, error, 'volunteer-signup:upsert')
    return res.json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
