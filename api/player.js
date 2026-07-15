import { sendServerError } from './_lib/apiErrors.js'
import { enforceRateLimit } from './_lib/rateLimit.js'
import supabaseAdmin from './_lib/supabase.js'
import { statusForAuthError, verifyUser } from './_lib/auth.js'
import { requireOpenPhase } from './_lib/eventPhase.js'
import { under18Requirement } from '../src/lib/dateOfBirth.js'
import { getPlayerCurrentZltacReadiness } from './_lib/zltacReadinessData.js'
import { arePaymentsOpen } from '../src/lib/payments.js'
import {
  OpaqueProfileHandleError,
  PROFILE_HANDLE_PURPOSES,
  ProfileHandleConfigurationError,
  issueOpaqueProfileHandle,
  verifyOpaqueProfileHandle,
} from './_lib/opaqueProfileHandle.js'

const UNDER_18_APPROVAL_COLUMNS = 'id, user_id, event_year, status, submitted_at, approved_at, approved_by, notes, document_id'
const REGISTRATION_ACTION_FIELDS = {
  register: new Set(['action', 'year', 'dob', 'emergency_contact_name', 'emergency_contact_phone']),
  'confirm-side-events': new Set(['action', 'year', 'side_events']),
  'confirm-extras': new Set(['action', 'year', 'dinner_guests']),
  'submit-under-18': new Set(['action', 'year']),
  'sign-legal': new Set(['action', 'documentId', 'eventYear']),
}
const DOUBLES_ACTION_FIELDS = {
  create: new Set(['action', 'eventYear', 'partnerHandle']),
  confirm: new Set(['action', 'id']),
  delete: new Set(['action', 'id']),
}
const TRIPLES_ACTION_FIELDS = {
  create: new Set(['action', 'eventYear', 'slot', 'partnerHandle']),
  'add-slot': new Set(['action', 'id', 'eventYear', 'slot', 'partnerHandle']),
  confirm: new Set(['action', 'id', 'mySlot']),
  'clear-slot': new Set(['action', 'id', 'slot']),
  disband: new Set(['action', 'id']),
}

const SAFE_REGISTRATION_FIELDS = Object.freeze([
  'id',
  'user_id',
  'team_id',
  'year',
  'side_events',
  'dinner_guests',
  'emergency_contact_name',
  'emergency_contact_phone',
  'status',
  'has_confirmed_side_events',
  'has_confirmed_extras',
  'created_at',
  'payment_reference',
  'amount_owing',
  'dob_at_registration',
])

function safeRegistration(row) {
  if (!row || typeof row !== 'object') return row ?? null
  return Object.fromEntries(
    SAFE_REGISTRATION_FIELDS
      .filter(field => Object.hasOwn(row, field))
      .map(field => [field, row[field]]),
  )
}

function safePlayerReadiness(readiness) {
  if (!readiness?.checks) return readiness ?? null
  return {
    ...readiness,
    checks: Object.fromEntries(Object.entries(readiness.checks).map(([key, check]) => [
      key,
      check?.source === 'committee_override'
        ? { status: check.status, source: check.source }
        : check,
    ])),
  }
}

function partnerScope(eventYear) {
  return `event-year:${eventYear}`
}

function resolvePartnerHandle({ handle, purpose, actorId, eventYear }) {
  return verifyOpaqueProfileHandle({
    handle,
    purpose,
    actorId,
    scope: partnerScope(eventYear),
  }).profileId
}

async function searchPartners(req, res, user, { purpose, sideEvent, rosterTable, rosterColumns }) {
  const body = req.body ?? {}
  const eventYear = validEventYear(body.eventYear)
  const safeTerm = typeof body.term === 'string' ? body.term.trim() : ''
  if (!eventYear || safeTerm.length < 2) {
    return res.status(400).json({ error: 'A valid eventYear and search term are required' })
  }
  if (safeTerm.length > 64 || /[%,_()*.:\\]/.test(safeTerm)) {
    return res.status(400).json({ error: 'Search term contains invalid characters' })
  }

  const phase = await requireOpenPhase(eventYear)
  if (!phase.ok) return res.status(phase.status).json({ error: phase.error, phase: phase.phase })

  const { data: registrations, error: registrationError } = await supabaseAdmin
    .from('zltac_registrations')
    .select('user_id')
    .eq('year', eventYear)
    .neq('status', 'cancelled')
    .neq('user_id', user.id)
    .contains('side_events', [sideEvent])
    .limit(1000)
  if (registrationError) {
    return sendServerError(res, registrationError, 'player:partner-search-registrations')
  }

  const eligibleIds = [...new Set((registrations ?? []).map(row => row.user_id).filter(Boolean))]
  if (eligibleIds.length === 0) return res.json({ results: [] })

  const { data: rosters, error: rosterError } = await supabaseAdmin
    .from(rosterTable)
    .select(rosterColumns)
    .eq('event_year', eventYear)
  if (rosterError) return sendServerError(res, rosterError, 'player:partner-search-rosters')

  const taken = new Set()
  for (const roster of (rosters ?? [])) {
    for (const field of rosterColumns.split(',').map(value => value.trim())) {
      if (roster[field]) taken.add(roster[field])
    }
  }

  const availableIds = eligibleIds.filter(id => !taken.has(id))
  if (availableIds.length === 0) return res.json({ results: [] })

  const { data: aliases, error: aliasesError } = await supabaseAdmin
    .from('profiles')
    .select('id, alias')
    .eq('is_placeholder', false)
    .eq('suspended', false)
    .in('id', availableIds)
    .ilike('alias', `%${safeTerm}%`)
    .limit(20)
  if (aliasesError) return sendServerError(res, aliasesError, 'player:partner-search-profiles')
  if (!aliases?.length) return res.json({ results: [] })

  try {
    return res.json({
      results: aliases.map(profile => ({
        alias: profile.alias,
        handle: issueOpaqueProfileHandle({
          profileId: profile.id,
          purpose,
          actorId: user.id,
          scope: partnerScope(eventYear),
        }),
      })),
    })
  } catch (error) {
    return sendServerError(res, error, 'player:partner-search-handles')
  }
}

function rejectUnexpectedFields(res, body, allowed) {
  const unexpected = Object.keys(body).filter(key => !allowed.has(key))
  if (unexpected.length === 0) return false
  res.status(400).json({ error: `Unsupported field(s): ${unexpected.join(', ')}` })
  return true
}

function validDob(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  if (date.getTime() > todayUtc || year < 1900) return null
  return value
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function verifiedAuthEmail(user) {
  if (!user?.email_confirmed_at) return null
  return normalizedEmail(user.email) || null
}

function validEventYear(value) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null
}

function sendSideEventRpcError(res, error, context) {
  const expected = {
    '22023': [400, 'Invalid side-event request.'],
    '22P02': [400, 'Invalid side-event request.'],
    '23503': [400, 'Every player must have an eligible registration for this event.'],
    '23514': [409, 'The side-event roster conflicts with the event or player registrations.'],
    '23505': [409, 'One or more players are already assigned to another side-event roster.'],
    '40001': [409, 'The roster changed at the same time. Please try again.'],
    '40P01': [409, 'The roster changed at the same time. Please try again.'],
    '42501': [403, 'You are not allowed to change this side-event roster.'],
    '55000': [409, 'This side-event roster can no longer be changed.'],
    'P0002': [404, 'Side-event roster not found.'],
  }
  const mapped = expected[error?.code]
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] })
  return sendServerError(res, error, context)
}

function sendLegalLifecycleRpcError(res, error, context) {
  const expected = {
    '22023': [400, 'Invalid acknowledgement or form request.'],
    '22P02': [400, 'Invalid acknowledgement or form request.'],
    '23503': [400, 'An eligible registration and active published document are required.'],
    '23514': [409, 'The acknowledgement or form state changed. Please review it and try again.'],
    '23505': [409, 'This acknowledgement or form action has already been recorded.'],
    '40001': [409, 'The acknowledgement or form state changed at the same time. Please try again.'],
    '40P01': [409, 'The acknowledgement or form state changed at the same time. Please try again.'],
    '42501': [403, 'This account is not allowed to complete that acknowledgement or form action.'],
    '55000': [409, 'This event cannot accept acknowledgement or form changes.'],
    'P0002': [404, 'The event or required-document record was not found.'],
  }
  const mapped = expected[error?.code]
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] })
  return sendServerError(res, error, context)
}

function sendRegistrationMutationError(res, error, context) {
  if (error?.hint === 'DOB_LOCKED') {
    return res.status(409).json({
      error: 'Date of birth is locked after event registration. Contact the committee to correct it.',
      code: 'DOB_LOCKED',
    })
  }
  if (error?.hint === 'REGISTRATION_CAP_REACHED') {
    return res.status(400).json({ error: error.message })
  }
  if (error?.code === 'P0002') return res.status(404).json({ error: error.message })
  if (error?.code === '42501') {
    return res.status(403).json({ error: 'This account cannot register for the event.' })
  }
  if (['22001', '22023'].includes(error?.code)) {
    return res.status(400).json({ error: error.message })
  }
  if (error?.code === '23505') {
    return res.status(409).json({
      error: 'This registration conflicts with an existing record. Check your Player Hub for a registration linked to your verified email, or contact the committee.',
    })
  }
  if (error?.code === '23514') return res.status(409).json({ error: error.message })
  if (error?.code === '55000') {
    return res.status(409).json({ error: 'Registration changes are not open for this event.' })
  }
  if (['40001', '40P01'].includes(error?.code)) {
    return res.status(409).json({ error: 'The registration changed at the same time. Please try again.' })
  }
  return sendServerError(res, error, context)
}

function rpcRecord(data) {
  return Array.isArray(data) ? (data[0] ?? null) : data
}

async function mutateDoubles(res, args, deleted = false) {
  const { data, error } = await supabaseAdmin.rpc('mutate_zltac_doubles_roster', args)
  if (error) return sendSideEventRpcError(res, error, 'player:doubles-rpc')
  return deleted ? res.json({ ok: true }) : res.json({ record: rpcRecord(data) })
}

async function mutateTriples(res, args, deleted = false) {
  const { data, error } = await supabaseAdmin.rpc('mutate_zltac_triples_roster', args)
  if (error) return sendSideEventRpcError(res, error, 'player:triples-rpc')
  return deleted ? res.json({ ok: true }) : res.json({ record: rpcRecord(data) })
}

// Returns true and writes the lifecycle error when a non-RPC registration
// mutation is attempted after the event locks. Side-event roster RPCs enforce
// the equivalent gate while holding the event row lock.
async function denyIfLocked(res, year) {
  const guard = await requireOpenPhase(year)
  if (guard.ok) return false
  res.status(guard.status).json({ error: guard.error, phase: guard.phase })
  return true
}

// Consolidated player-action endpoint. Dispatches by ?resource=:
//   ?resource=doubles      → doubles partner flow (POST + action)
//   ?resource=triples      → triples team flow    (POST + action)
//   ?resource=registration → own-registration ops (POST + action)
//
// All resources are POST, all require an authenticated user, and all
// use an `action` field on the JSON body to choose the operation —
// matching the pre-consolidation API surface exactly.

// ── doubles ─────────────────────────────────────────────────────────────────

async function handleDoubles(req, res, user) {
  const body = req.body ?? {}
  const { action } = body

  if (action === 'search') {
    return searchPartners(req, res, user, {
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER,
      sideEvent: 'doubles',
      rosterTable: 'doubles_pairs',
      rosterColumns: 'player1_id, player2_id',
    })
  }

  if (action === 'create') {
    const { eventYear, partnerHandle } = body
    if (rejectUnexpectedFields(res, body, DOUBLES_ACTION_FIELDS.create)) return
    const year = validEventYear(eventYear)
    if (!year || typeof partnerHandle !== 'string') {
      return res.status(400).json({ error: 'A valid eventYear and partnerHandle are required' })
    }
    let partnerId
    try {
      partnerId = resolvePartnerHandle({
        handle: partnerHandle,
        purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_DOUBLES_PARTNER,
        actorId: user.id,
        eventYear: year,
      })
    } catch (error) {
      if (error instanceof ProfileHandleConfigurationError) {
        return sendServerError(res, error, 'player:doubles-handle-config')
      }
      if (error instanceof OpaqueProfileHandleError) {
        return res.status(400).json({ error: 'Invalid or expired partner selection.' })
      }
      return sendServerError(res, error, 'player:doubles-handle')
    }
    if (partnerId === user.id) return res.status(400).json({ error: 'Choose another player as your partner' })

    return mutateDoubles(res, {
      p_user_id: user.id,
      p_action: 'create',
      p_event_year: year,
      p_roster_id: null,
      p_partner_id: partnerId,
    })
  }

  if (action === 'confirm') {
    const { id } = body
    if (rejectUnexpectedFields(res, body, DOUBLES_ACTION_FIELDS.confirm)) return
    if (!validUuid(id)) return res.status(400).json({ error: 'A valid id is required' })

    return mutateDoubles(res, {
      p_user_id: user.id,
      p_action: 'confirm',
      p_event_year: null,
      p_roster_id: id,
      p_partner_id: null,
    })
  }

  if (action === 'delete') {
    const { id } = body
    if (rejectUnexpectedFields(res, body, DOUBLES_ACTION_FIELDS.delete)) return
    if (!validUuid(id)) return res.status(400).json({ error: 'A valid id is required' })

    return mutateDoubles(res, {
      p_user_id: user.id,
      p_action: 'delete',
      p_event_year: null,
      p_roster_id: id,
      p_partner_id: null,
    }, true)
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── triples ─────────────────────────────────────────────────────────────────

async function handleTriples(req, res, user) {
  const body = req.body ?? {}
  const { action } = body

  if (action === 'search') {
    return searchPartners(req, res, user, {
      purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER,
      sideEvent: 'triples',
      rosterTable: 'triples_teams',
      rosterColumns: 'player1_id, player2_id, player3_id',
    })
  }

  if (action === 'create') {
    const { eventYear, slot, partnerHandle } = body
    if (rejectUnexpectedFields(res, body, TRIPLES_ACTION_FIELDS.create)) return
    const year = validEventYear(eventYear)
    if (!year || typeof partnerHandle !== 'string' || (slot !== 2 && slot !== 3)) {
      return res.status(400).json({ error: 'A valid eventYear, slot and partnerHandle are required' })
    }
    let partnerId
    try {
      partnerId = resolvePartnerHandle({
        handle: partnerHandle,
        purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER,
        actorId: user.id,
        eventYear: year,
      })
    } catch (error) {
      if (error instanceof ProfileHandleConfigurationError) {
        return sendServerError(res, error, 'player:triples-handle-config')
      }
      if (error instanceof OpaqueProfileHandleError) {
        return res.status(400).json({ error: 'Invalid or expired partner selection.' })
      }
      return sendServerError(res, error, 'player:triples-handle')
    }
    if (partnerId === user.id) return res.status(400).json({ error: 'Choose another player as your partner' })

    return mutateTriples(res, {
      p_user_id: user.id,
      p_action: 'create',
      p_event_year: year,
      p_roster_id: null,
      p_slot: slot,
      p_partner_id: partnerId,
    })
  }

  if (action === 'add-slot') {
    const { id, slot, partnerHandle } = body
    if (rejectUnexpectedFields(res, body, TRIPLES_ACTION_FIELDS['add-slot'])) return
    const requestYear = validEventYear(body.eventYear)
    if (!validUuid(id) || typeof partnerHandle !== 'string' || (slot !== 2 && slot !== 3) || !requestYear) {
      return res.status(400).json({ error: 'A valid id, eventYear, slot and partnerHandle are required' })
    }
    let partnerId
    try {
      partnerId = resolvePartnerHandle({
        handle: partnerHandle,
        purpose: PROFILE_HANDLE_PURPOSES.ZLTAC_TRIPLES_PARTNER,
        actorId: user.id,
        eventYear: requestYear,
      })
    } catch (error) {
      if (error instanceof ProfileHandleConfigurationError) {
        return sendServerError(res, error, 'player:triples-handle-config')
      }
      if (error instanceof OpaqueProfileHandleError) {
        return res.status(400).json({ error: 'Invalid or expired partner selection.' })
      }
      return sendServerError(res, error, 'player:triples-handle')
    }
    if (partnerId === user.id) return res.status(400).json({ error: 'Choose another player as your partner' })

    return mutateTriples(res, {
      p_user_id: user.id,
      p_action: 'add-slot',
      p_event_year: requestYear,
      p_roster_id: id,
      p_slot: slot,
      p_partner_id: partnerId,
    })
  }

  if (action === 'confirm') {
    const { id, mySlot } = body
    if (rejectUnexpectedFields(res, body, TRIPLES_ACTION_FIELDS.confirm)) return
    if (!validUuid(id) || (mySlot !== 2 && mySlot !== 3)) {
      return res.status(400).json({ error: 'A valid id and mySlot are required' })
    }

    return mutateTriples(res, {
      p_user_id: user.id,
      p_action: 'confirm',
      p_event_year: null,
      p_roster_id: id,
      p_slot: mySlot,
      p_partner_id: null,
    })
  }

  if (action === 'clear-slot') {
    const { id, slot } = body
    if (rejectUnexpectedFields(res, body, TRIPLES_ACTION_FIELDS['clear-slot'])) return
    if (!validUuid(id) || (slot !== 2 && slot !== 3)) {
      return res.status(400).json({ error: 'A valid id and slot are required' })
    }

    return mutateTriples(res, {
      p_user_id: user.id,
      p_action: 'clear-slot',
      p_event_year: null,
      p_roster_id: id,
      p_slot: slot,
      p_partner_id: null,
    })
  }

  if (action === 'disband') {
    const { id } = body
    if (rejectUnexpectedFields(res, body, TRIPLES_ACTION_FIELDS.disband)) return
    if (!validUuid(id)) return res.status(400).json({ error: 'A valid id is required' })

    return mutateTriples(res, {
      p_user_id: user.id,
      p_action: 'disband',
      p_event_year: null,
      p_roster_id: id,
      p_slot: null,
      p_partner_id: null,
    }, true)
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── registration ────────────────────────────────────────────────────────────

async function handleRegistration(req, res, user) {
  const body = req.body ?? {}
  const { action } = body

  if (action === 'confirm-side-events') {
    if (rejectUnexpectedFields(res, body, REGISTRATION_ACTION_FIELDS[action])) return

    const eventYear = validEventYear(body.year)
    if (!eventYear) return res.status(400).json({ error: 'year is required' })
    if (!Array.isArray(body.side_events)) return res.status(400).json({ error: 'side_events must be an array' })
    if (body.side_events.length > 20) return res.status(400).json({ error: 'Too many side events selected' })

    const selected = [...new Set(body.side_events)]
    if (selected.some(slug => typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))) {
      return res.status(400).json({ error: 'side_events contains an invalid value' })
    }
    const { data, error } = await supabaseAdmin.rpc('confirm_zltac_registration_choices', {
      p_user_id: user.id,
      p_event_year: eventYear,
      p_action: action,
      p_side_events: selected,
      p_dinner_guests: null,
    })
    if (error) return sendRegistrationMutationError(res, error, 'player:side-events-rpc')
    const result = rpcRecord(data)
    if (!result?.registration) {
      return sendServerError(res, new Error('Registration confirmation RPC returned no registration.'), 'player:side-events-rpc-result')
    }
    return res.json({ ok: true, registration: safeRegistration(result.registration), amountOwing: result.amountOwing ?? 0 })
  }

  if (action === 'confirm-extras') {
    if (rejectUnexpectedFields(res, body, REGISTRATION_ACTION_FIELDS[action])) return

    const eventYear = Number.parseInt(body.year, 10)
    const dinnerGuests = body.dinner_guests
    if (!Number.isInteger(eventYear)) return res.status(400).json({ error: 'year is required' })
    if (!Number.isInteger(dinnerGuests) || dinnerGuests < 0 || dinnerGuests > 10) {
      return res.status(400).json({ error: 'dinner_guests must be an integer from 0 to 10' })
    }
    const { data, error } = await supabaseAdmin.rpc('confirm_zltac_registration_choices', {
      p_user_id: user.id,
      p_event_year: eventYear,
      p_action: action,
      p_side_events: null,
      p_dinner_guests: dinnerGuests,
    })
    if (error) return sendRegistrationMutationError(res, error, 'player:extras-rpc')
    const result = rpcRecord(data)
    if (!result?.registration) {
      return sendServerError(res, new Error('Registration confirmation RPC returned no registration.'), 'player:extras-rpc-result')
    }
    return res.json({ ok: true, registration: safeRegistration(result.registration), amountOwing: result.amountOwing ?? 0 })
  }

  if (action === 'submit-under-18') {
    if (rejectUnexpectedFields(res, body, REGISTRATION_ACTION_FIELDS[action])) return

    const eventYear = Number.parseInt(body.year, 10)
    if (!Number.isInteger(eventYear)) return res.status(400).json({ error: 'year is required' })

    const { data: registration, error: registrationErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id, dob_at_registration')
      .eq('user_id', user.id)
      .eq('year', eventYear)
      .maybeSingle()
    if (registrationErr) return sendServerError(res, registrationErr, 'player:under18-registration')
    if (!registration) return res.status(403).json({ error: 'Register for this event before submitting its under-18 form.' })
    if (!validDob(registration.dob_at_registration)) {
      return res.status(400).json({ error: 'A valid date of birth is required on the registration.' })
    }
    const { data: event, error: eventErr } = await supabaseAdmin
      .from('zltac_events')
      .select('id, status, start_date, event_starts_at, timezone')
      .eq('year', eventYear)
      .maybeSingle()
    if (eventErr) return sendServerError(res, eventErr, 'player:under18-event')
    if (!event || event.status === 'archived') {
      return res.status(400).json({ error: 'This event is not available for under-18 submissions.' })
    }

    const ageRequirement = under18Requirement({
      dob: registration.dob_at_registration,
      eventStartsAt: event.event_starts_at,
      startDate: event.start_date,
      timezone: event.timezone,
    })
    if (ageRequirement.status === 'blocked') {
      return res.status(400).json({ error: 'Under-18 eligibility could not be determined from the registration and event start date.' })
    }
    if (ageRequirement.status !== 'required') {
      return res.status(400).json({ error: 'An under-18 form is not required for this registration.' })
    }

    const { data: activeDocument, error: documentErr } = await supabaseAdmin
      .from('legal_documents')
      .select('id, document_type, is_active, published_at, content_sha256, object_size')
      .eq('document_type', 'under_18_form')
      .eq('is_active', true)
      .not('published_at', 'is', null)
      .not('content_sha256', 'is', null)
      .not('object_size', 'is', null)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (documentErr) return sendServerError(res, documentErr, 'player:under18-document')
    if (!activeDocument) {
      return res.status(400).json({ error: 'The under-18 form is not currently available.' })
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('under_18_approvals')
      .select(UNDER_18_APPROVAL_COLUMNS)
      .eq('user_id', user.id)
      .eq('event_year', eventYear)
      .maybeSingle()
    if (existingErr) return sendServerError(res, existingErr, 'player:under18-existing')
    if (existing?.status === 'approved') {
      return res.status(409).json({ error: 'This under-18 form has already been approved.' })
    }

    const rpcResult = await supabaseAdmin.rpc('submit_under_18_approval', {
      p_user_id: user.id,
      p_event_year: eventYear,
      p_document_id: activeDocument.id,
    })
    if (rpcResult.error) {
      return sendLegalLifecycleRpcError(
        res,
        rpcResult.error,
        'player:under18-submit',
      )
    }

    let approval = null
    if (rpcResult.data && !Array.isArray(rpcResult.data) && typeof rpcResult.data === 'object') {
      approval = rpcResult.data
    } else if (Array.isArray(rpcResult.data) && rpcResult.data.length > 0) {
      approval = rpcResult.data[0]
    }

    if (!approval || approval.status !== 'pending') {
      const { data, error: readErr } = await supabaseAdmin
        .from('under_18_approvals')
        .select(UNDER_18_APPROVAL_COLUMNS)
        .eq('user_id', user.id)
        .eq('event_year', eventYear)
        .maybeSingle()
      if (readErr) return sendServerError(res, readErr, 'player:under18-read')
      approval = data
    }
    if (!approval || approval.status !== 'pending') {
      return res.status(409).json({ error: 'Under-18 submission did not enter pending review.' })
    }

    return res.json({ ok: true, approval })
  }

  if (action === 'sign-legal') {
    if (rejectUnexpectedFields(res, body, REGISTRATION_ACTION_FIELDS[action])) return
    // Player (re)acknowledges the Code of Conduct / Media Release. Routed
    // through the service role so
    // the clear_force_incomplete_on_resign AFTER-trigger updates
    // zltac_registrations with auth.uid() IS NULL — the system path the
    // protect_registration_admin_fields guard allows — instead of failing
    // under the player's own auth context.
    const { documentId } = body
    const eventYear = validEventYear(body.eventYear)
    if (!validUuid(documentId)) {
      return res.status(400).json({ error: 'documentId must be a valid UUID' })
    }
    if (!eventYear) return res.status(400).json({ error: 'eventYear is required' })

    // user_id is taken from the authenticated session, never the request body.
    const { error: acceptanceError } = await supabaseAdmin.rpc(
      'accept_legal_document',
      {
        p_user_id: user.id,
        p_event_year: eventYear,
        p_document_id: documentId,
        // Keep the existing RPC signature during the phased migration cutover,
        // but deliberately collect no network or browser fingerprint metadata.
        p_ip_address: null,
        p_user_agent: null,
      },
    )
    if (acceptanceError) {
      return sendLegalLifecycleRpcError(
        res,
        acceptanceError,
        'player:legal-acceptance',
      )
    }

    return res.json({ ok: true })
  }

  if (action === 'precheck-register') {
    // Best-effort cap check used by PlayerRegister / CaptainRegister before
    // the atomic registration RPC. The RPC repeats the decision while holding
    // the event lock. Do not use aliases to discover placeholder identities.
    const { year } = body
    if (!year) return res.status(400).json({ error: 'year is required' })
    // Block new registrations once the event locks. RLS also blocks the
    // client-direct insert; this returns a clean message before the attempt.
    if (await denyIfLocked(res, year)) return

    const { data: ev, error: evErr } = await supabaseAdmin
      .from('zltac_events')
      .select('max_players')
      .eq('year', year)
      .maybeSingle()
    if (evErr) return sendServerError(res, evErr, 'player:ev')

    const cap = ev?.max_players
    if (!cap) return res.json({ ok: true })

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('year', year)
      .maybeSingle()
    if (existingErr) return sendServerError(res, existingErr, 'player:existing')
    if (existing) return res.json({ ok: true })

    const { count, error: countErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('year', year)
    if (countErr) return sendServerError(res, countErr, 'player:count')

    if ((count ?? 0) >= cap) {
      return res.status(400).json({ error: `Registration cap of ${cap} reached. Contact the committee.` })
    }
    return res.json({ ok: true })
  }

  if (action === 'register') {
    if (rejectUnexpectedFields(res, body, REGISTRATION_ACTION_FIELDS[action])) return

    const eventYear = Number.parseInt(body.year, 10)
    if (!Number.isInteger(eventYear)) return res.status(400).json({ error: 'year is required' })
    const dob = validDob(body.dob)
    if (!dob) return res.status(400).json({ error: 'A valid date of birth in YYYY-MM-DD format is required.' })
    const emergencyContactName = typeof body.emergency_contact_name === 'string'
      ? body.emergency_contact_name.trim() || null
      : null
    const emergencyContactPhone = typeof body.emergency_contact_phone === 'string'
      ? body.emergency_contact_phone.trim() || null
      : null

    const { data, error } = await supabaseAdmin.rpc('register_zltac_player', {
      p_user_id: user.id,
      p_event_year: eventYear,
      p_dob: dob,
      p_emergency_contact_name: emergencyContactName,
      p_emergency_contact_phone: emergencyContactPhone,
    })
    if (error) return sendRegistrationMutationError(res, error, 'player:register-rpc')

    const result = rpcRecord(data)
    if (!result) {
      return sendServerError(res, new Error('Registration RPC returned no result.'), 'player:register-rpc-result')
    }
    if (result.ok === false) {
      return res.status(409).json({
        error: 'This registration conflicts with an existing record. Check your Player Hub or contact the committee.',
      })
    }
    if (result.existing) {
      return res.json({
        ok: true,
        id: result.id,
        existing: true,
        registration: safeRegistration(result.registration),
      })
    }
    return res.status(201).json({
      ok: true,
      id: result.id,
      registration: safeRegistration(result.registration),
      amountOwing: result.amountOwing ?? 0,
    })
  }

  if (action === 'cancel') {
    const { year } = body
    if (!year) return res.status(400).json({ error: 'year is required' })

    const { data, error } = await supabaseAdmin.rpc('cancel_zltac_registration', {
      p_user_id: user.id,
      p_event_year: Number.parseInt(year, 10),
    })
    if (error) {
      const paymentBlocked = error.hint === 'PAYMENT_RECORDS_EXIST'
        || /recorded payments cannot be cancelled/i.test(error.message ?? '')
      if (paymentBlocked) {
        return res.status(409).json({
          error: 'A payment has been recorded for this registration. Contact the committee before cancelling.',
          code: 'PAYMENT_RECORDS_EXIST',
        })
      }
      const captainBlocked = error.hint === 'CAPTAIN_BLOCKED'
        || /captain must disband/i.test(error.message ?? '')
      if (captainBlocked) {
        return res.status(409).json({
          error: 'You are the captain. Disband your team first.',
          code: 'CAPTAIN_BLOCKED',
        })
      }
      if (error.code === 'P0002') return res.status(404).json({ error: error.message })
      if (['22023', '23503', '23514', '55000'].includes(error.code)) {
        return res.status(409).json({ error: error.message })
      }
      return sendServerError(res, error, 'player:cancel-registration')
    }

    return res.json({ ok: true, ...(data ?? {}) })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── claimable / claim ───────────────────────────────────────────────────────
// Placeholder-claim flow. Two endpoints:
//   GET  ?resource=claimable → list placeholders whose recorded email
//                              matches the caller's verified Auth email.
//   POST ?resource=claim     → merge a chosen placeholder into the caller via
//                              the actor-explicit service-only merge RPC.
// The RPC binds the already verified actor to the target, repeats the
// ownership check, and performs the merge atomically.

async function handleClaimable(req, res, user) {
  const callerEmail = verifiedAuthEmail(user)
  if (!callerEmail) return res.json({ matches: [] })

  // Pull the small placeholder set and compare normalized emails server-side.
  // placeholder_email is used only for authorization and is never disclosed.
  const { data: placeholders, error: phErr } = await supabaseAdmin
    .from('profiles')
    .select('id, alias, placeholder_email')
    .eq('is_placeholder', true)
  if (phErr) return sendServerError(res, phErr, 'player:ph')

  const matched = (placeholders ?? []).filter(
    placeholder => normalizedEmail(placeholder.placeholder_email) === callerEmail,
  )
  if (!matched.length) return res.json({ matches: [] })

  // A year and selected side events provide enough context to identify the
  // registration without disclosing legal names, email, or payment reference.
  const matchedIds = matched.map(p => p.id)
  const { data: regs, error: regsErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('user_id, year, side_events')
    .in('user_id', matchedIds)
    .order('year', { ascending: false })
  if (regsErr) return sendServerError(res, regsErr, 'player:regs')

  const regsByUser = {}
  for (const r of (regs ?? [])) {
    ;(regsByUser[r.user_id] ??= []).push({
      year: r.year,
      side_events: r.side_events ?? [],
    })
  }

  const matches = matched.map(p => ({
    placeholder: {
      id: p.id,
      alias: p.alias,
    },
    registrations: regsByUser[p.id] ?? [],
  }))

  return res.json({ matches })
}

async function handleClaim(req, res, user) {
  const { placeholder_id } = req.body ?? {}
  if (!validUuid(placeholder_id)) return res.status(400).json({ error: 'A valid claim reference is required' })

  const callerEmail = verifiedAuthEmail(user)
  if (!callerEmail) {
    return res.status(403).json({ error: 'A verified account email is required to claim a registration.' })
  }

  // Mirror the database ownership check for a clean rejection. Missing,
  // non-placeholder, and nonmatching records intentionally share one response
  // so this endpoint cannot be used as a placeholder-identity oracle.
  const { data: placeholder, error: phErr } = await supabaseAdmin
    .from('profiles')
    .select('placeholder_email, is_placeholder')
    .eq('id', placeholder_id)
    .maybeSingle()
  if (phErr) return sendServerError(res, phErr, 'player:ph')
  if (!placeholder?.is_placeholder
      || normalizedEmail(placeholder.placeholder_email) !== callerEmail) {
    return res.status(403).json({ error: 'This registration cannot be claimed by this account.' })
  }

  const { data, error } = await supabaseAdmin.rpc('merge_placeholder_profile', {
    p_actor_id: user.id,
    p_placeholder_id: placeholder_id,
    p_real_id: user.id,
    p_mode: 'self',
  })
  if (error) return sendServerError(res, error, 'player:error')

  if (data && data.ok === false) {
    return res.status(400).json(data)
  }
  return res.json(data ?? { ok: true })
}

async function handlePaymentInstructions(req, res, user) {
  const eventYear = validEventYear(req.query.year)
  if (!eventYear) return res.status(400).json({ error: 'A valid year is required' })

  const { data: registration, error: registrationError } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('year', eventYear)
    .maybeSingle()
  if (registrationError) {
    return sendServerError(res, registrationError, 'player:payment-instructions-registration')
  }
  if (!registration || registration.status === 'cancelled') {
    return res.status(404).json({ error: 'Registration not found' })
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from('zltac_events')
    .select('status, reg_close_date, payments_override, bank_bsb, bank_account_number, bank_account_name')
    .eq('year', eventYear)
    .maybeSingle()
  if (eventError) return sendServerError(res, eventError, 'player:payment-instructions-event')
  if (!event) return res.status(404).json({ error: 'Event not found' })

  const paymentState = arePaymentsOpen(event)
  const available = ['open', 'closed'].includes(event.status) && paymentState.open
  return res.json({
    payment_instructions: {
      available,
      reason: available
        ? paymentState.reason
        : event.status === 'archived'
          ? 'event_archived'
          : paymentState.reason,
      opens_at: !available && paymentState.opensAt
        ? paymentState.opensAt.toISOString()
        : null,
      bank: available
        ? {
            bsb: event.bank_bsb,
            account_number: event.bank_account_number,
            account_name: event.bank_account_name,
          }
        : null,
    },
  })
}

async function handleOwnZltacTeam(req, res, user) {
  const eventYear = validEventYear(req.query.year)
  if (!eventYear) return res.status(400).json({ error: 'A valid year is required' })

  const { data: registration, error: registrationError } = await supabaseAdmin
    .from('zltac_registrations')
    .select('team_id, status')
    .eq('user_id', user.id)
    .eq('year', eventYear)
    .maybeSingle()
  if (registrationError) return sendServerError(res, registrationError, 'player:own-team-registration')
  if (!registration?.team_id || registration.status === 'cancelled') return res.json({ team: null })

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, event_id, captain_id, manager_id, name, state, home_venue, colour, status, rejection_reason, logo_url')
    .eq('id', registration.team_id)
    .maybeSingle()
  if (teamError) return sendServerError(res, teamError, 'player:own-team')
  if (!team) return res.json({ team: null })

  let captainAlias = null
  if (team.captain_id) {
    const { data: captain, error: captainError } = await supabaseAdmin
      .from('profiles')
      .select('alias')
      .eq('id', team.captain_id)
      .maybeSingle()
    if (captainError) return sendServerError(res, captainError, 'player:own-team-captain')
    captainAlias = captain?.alias ?? null
  }

  return res.json({
    team: {
      id: team.id,
      event_id: team.event_id,
      name: team.name,
      state: team.state,
      home_venue: team.home_venue,
      colour: team.colour,
      status: team.status,
      rejection_reason: team.rejection_reason,
      logo_url: team.logo_url,
      captain_alias: captainAlias,
      viewer_role: team.captain_id === user.id
        ? 'captain'
        : team.manager_id === user.id
          ? 'manager'
          : 'player',
    },
  })
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { user, error } = await verifyUser(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

  const resource = req.query.resource

  const action = req.body?.action
  const rateConfig = resource === 'claim'
    ? { limit: 5, window: '10 m', prefix: 'placeholder-claim' }
    : resource === 'claimable'
      ? { limit: 30, window: '1 m', prefix: 'placeholder-discovery' }
      : ['readiness', 'payment-instructions', 'team'].includes(resource)
        ? { limit: 60, window: '1 m', prefix: 'player-readiness' }
        : (resource === 'doubles' || resource === 'triples') && action === 'search'
          ? { limit: 30, window: '1 m', prefix: 'partner-search' }
          : resource === 'registration' && ['register', 'confirm-side-events', 'confirm-extras', 'submit-under-18', 'sign-legal'].includes(action)
            ? { limit: 30, window: '1 m', prefix: 'player-registration-mutations' }
            : null
  if (rateConfig && !await enforceRateLimit(req, res, {
    identifier: user.id,
    requireDistributed: true,
    ...rateConfig,
  })) return

  // GET endpoints
  if (req.method === 'GET') {
    if (resource === 'claimable') return handleClaimable(req, res, user)
    if (resource === 'payment-instructions') return handlePaymentInstructions(req, res, user)
    if (resource === 'team') return handleOwnZltacTeam(req, res, user)
    if (resource === 'readiness') {
      try {
        const result = await getPlayerCurrentZltacReadiness(user.id)
        return res.json({
          ...result,
          readiness: safePlayerReadiness(result.readiness),
        })
      } catch (readinessError) {
        return sendServerError(res, readinessError, 'player:readiness')
      }
    }
    return res.status(400).json({ error: 'Unsupported player resource' })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (resource === 'doubles')      return handleDoubles(req, res, user)
  if (resource === 'triples')      return handleTriples(req, res, user)
  if (resource === 'registration') return handleRegistration(req, res, user)
  if (resource === 'claim')        return handleClaim(req, res, user)
  return res.status(400).json({ error: 'resource query param must be "doubles", "triples", "registration", or "claim"' })
}
