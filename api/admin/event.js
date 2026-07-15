import { randomUUID, timingSafeEqual } from 'crypto'
import { Resend } from 'resend'
import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'
import { isAllowedTeamLogoUrl } from '../_lib/captainTeam.js'
import {
  buildBackupFiles,
  reconcileFailedBackupObjects,
  removeBackupObjects,
} from '../_lib/backupStorage.js'
import { backupScheduleHealth } from '../_lib/backupHealth.js'
import { enforceRateLimit } from '../_lib/rateLimit.js'
import { isUuid } from '../_lib/idValidation.js'
import { sendServerError } from '../_lib/apiErrors.js'
import { captureServerException } from '../_lib/serverTelemetry.js'
import { handleAdminContent } from '../_lib/adminContent.js'
import {
  canonicalAssetReference,
  COMMITTEE_ASSET_PURPOSES,
  finalizeSignedAssetUpload,
  inspectAssetUploadRequest,
  issueSignedAssetUpload,
} from '../_lib/adminAssetUpload.js'
import { EVENT_COLUMNS, getZltacReadinessForUsers } from '../_lib/zltacReadinessData.js'
import {
  LEGAL_DOCUMENT_BUCKET,
  brandedLegalDocumentPath,
  inspectLegalPdfRequest,
} from '../_lib/legalDocuments.js'
import { generateBackupCsvs } from '../../src/lib/backup/generateBackupCsvs.js'
import { dollars } from '../../src/lib/pricing.js'
import { isRefTestRequired, isCocRequired, isPaymentRequired } from '../../src/lib/eventSettings.js'

const TEAM_STATES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ'])
const TEAM_FORMATS = new Set(['team', 'doubles', 'triples'])
const TEAM_ENTRY_TYPES = new Set(['state_association', 'direct_entry'])
const TEAM_SETTINGS_FIELDS = new Set([
  'teamId', 'name', 'state', 'home_venue', 'entry_type', 'format', 'colour',
  'logo_url', 'manager_id', 'captain_id',
])
const UNDER_18_STATUSES = new Set(['pending', 'approved', 'rejected'])
const EVENT_STATUSES = new Set(['draft', 'open', 'closed'])
const CURRENT_YEAR = new Date().getFullYear()
const DEFAULT_UNDER_18_YEAR = CURRENT_YEAR + 1
const DOUBLES_PAIR_COLUMNS = 'id, event_year, player1_id, player2_id, confirmed, created_at'
const TRIPLES_TEAM_COLUMNS = 'id, event_year, player1_id, player2_id, player3_id, player2_confirmed, player3_confirmed, confirmed, created_at'
const BACKUP_SETTINGS_COLUMNS = 'id, frequency, weekly_day, recipient_emails, last_backup_at, last_backup_status, created_at, updated_at'
const GLOBAL_BACKUP_RATE_LIMIT_IDENTIFIER = 'portal-backup-run'
const EVENT_WRITE_COLUMNS = new Set([
  'name',
  'year',
  'status',
  'start_date',
  'end_date',
  'location',
  'venue',
  'description',
  'logo_url',
  'cover_photo_url',
  'hero_text',
  'photo_urls',
  'main_fee',
  'team_fee',
  'dinner_guest_price',
  'processing_fee_pct',
  'bank_bsb',
  'bank_account_number',
  'bank_account_name',
  'side_events',
  'timezone',
  'reg_open_date',
  'reg_close_date',
  'event_starts_at',
  'max_teams',
  'max_players',
  'max_players_per_team',
  'require_coc',
  'require_ref_test',
  'require_payment',
  'allow_side_events_only',
  'enable_waitlist',
  'committee_email',
  'payments_override',
])

// Committee-gated event operations. Dispatches by ?resource=:
//   ?resource=event            → archive / delete the event (POST + body.action)
//   ?resource=registrations    → registrations admin (GET&year / PATCH / DELETE)
//   ?resource=payments         → payment records (POST / PATCH / DELETE)
//   ?resource=backup-settings  → GET / PATCH the single backup_settings row
//   ?resource=backup-run       → POST runs a backup. Dual auth: cron secret
//                                bearer OR committee session. Cron path
//                                honours frequency/weekly_day; committee
//                                path always sends (manual ad-hoc).
//
// Consolidated from api/admin/event.js + registrations.js + payments.js to stay
// under the Vercel Hobby function cap. All three share verifyCommittee +
// service-role (ADR-0002). Note the registrations DELETE uses a body field
// `kind` ('doubles'/'triples') — distinct from the top-level ?resource query.

// Vercel's recommended cron-protection pattern: set CRON_SECRET in the env,
// Vercel auto-injects `Authorization: Bearer ${CRON_SECRET}` on cron-fire.
// Returns true only for the cron path; the admin session takes a different
// branch in the dispatcher.
function isCronRequest(req) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = req.headers.authorization
  if (typeof header !== 'string' || header.length === 0) return false
  // Constant-time comparison so a forged header can't be tuned byte-by-byte
  // from response timing. timingSafeEqual throws on unequal buffer lengths,
  // so bail on a length mismatch first (the length is not itself secret).
  const provided = Buffer.from(header)
  const wanted = Buffer.from(`Bearer ${expected}`)
  if (provided.length !== wanted.length) return false
  return timingSafeEqual(provided, wanted)
}

// "Day of week" + "today's date" both resolved in Australia/Sydney — the
// project pattern (see src/lib/eventTimezone.js) uses Intl.DateTimeFormat
// with timeZone:, mirrored here so we don't introduce a second TZ approach.
// Returns 0=Sun .. 6=Sat plus YYYY-MM-DD in Sydney local time.
function sydneyDateInfo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date)
  const m = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  const dateStr = `${m.year}-${m.month}-${m.day}`
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { dateStr, dayOfWeek: weekdayMap[m.weekday] ?? 0 }
}

// ── event ─────────────────────────────────────────────────────────────────────
function validateEventLifecycleBody(body, action) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'A JSON object body is required.'
  }
  const unexpected = Object.keys(body).filter(key => !['action', 'eventId'].includes(key))
  if (unexpected.length > 0) {
    return `${action} accepts only action and eventId.`
  }
  return null
}

function sendEventLifecycleError(res, error, context) {
  if (error?.code === 'P0002') return res.status(404).json({ error: 'Event not found.' })
  if (error?.code === '22023') return res.status(400).json({ error: 'Invalid event lifecycle request.' })
  if (error?.code === '42501') return res.status(403).json({ error: 'The acting account is not active.' })
  if (error?.code === '23514') return res.status(409).json({ error: error.message })
  return sendServerError(res, error, context)
}

function sendRosterMutationError(res, error, context) {
  if (error?.hint === 'PAYMENT_RECORDS_EXIST') {
    return res.status(409).json({
      error: 'This registration has recorded payments. Resolve the payment records before cancelling it.',
      code: 'PAYMENT_RECORDS_EXIST',
    })
  }
  if (error?.code === 'P0002') return res.status(404).json({ error: error.message })
  if (error?.code === '42501') return res.status(403).json({ error: error.message })
  if (['22001', '22023', '22P02', '23503', '23505', '23514'].includes(error?.code)) {
    return res.status(400).json({ error: error.message })
  }
  if (['40001', '40P01', '55000'].includes(error?.code)) {
    return res.status(409).json({ error: error.message })
  }
  return sendServerError(res, error, context)
}

async function handleEvent(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('zltac_events')
      .select('*')
      .neq('status', 'archived')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return sendServerError(res, error, 'admin-event-read')
    return res.json({ event: data ?? null })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, eventId } = req.body ?? {}
  if (!action) {
    return res.status(400).json({ error: 'action is required' })
  }

  if (['archive', 'delete', 'status', 'cover'].includes(action) && !isUuid(eventId)) {
    return res.status(400).json({ error: 'A valid eventId is required' })
  }

  if (action === 'save') {
    const sanitized = sanitizeEventPayload(req.body?.payload, { eventId: eventId || null })
    if (!sanitized) return res.status(400).json({ error: 'payload is required' })
    if (sanitized.error) return res.status(400).json({ error: sanitized.error })

    if (eventId && !isUuid(eventId)) {
      return res.status(400).json({ error: 'A valid eventId is required' })
    }
    const { data, error } = await supabaseAdmin.rpc('committee_save_zltac_event', {
      p_actor_id: user.id,
      p_event_id: eventId || null,
      p_changes: sanitized.payload,
    })
    if (error) return sendRosterMutationError(res, error, 'admin-event-save')
    return res.json({ ok: true, event: data })
  }

  if (action === 'status') {
    const status = req.body?.status
    if (status === 'archived') {
      return res.status(400).json({ error: 'Use the dedicated archive action to archive an event.' })
    }
    if (!EVENT_STATUSES.has(status)) return res.status(400).json({ error: 'A valid event status is required.' })

    const { data, error } = await supabaseAdmin.rpc('committee_save_zltac_event', {
      p_actor_id: user.id,
      p_event_id: eventId,
      p_changes: { status },
    })
    if (error) return sendRosterMutationError(res, error, 'admin-event-status')
    return res.json({ ok: true, event: data })
  }

  if (action === 'cover') {
    const cover = canonicalAssetReference(req.body?.coverPhotoUrl, {
      bucket: 'event-covers',
      scopeId: eventId,
    })
    if (cover.error) return res.status(400).json({ error: cover.error })
    const coverPhotoUrl = cover.value
    const { data, error } = await supabaseAdmin.rpc('committee_save_zltac_event', {
      p_actor_id: user.id,
      p_event_id: eventId,
      p_changes: { cover_photo_url: coverPhotoUrl },
    })
    if (error) return sendRosterMutationError(res, error, 'admin-event-cover')
    return res.json({ ok: true, event: data })
  }

  if (action === 'archive') {
    const shapeError = validateEventLifecycleBody(req.body, action)
    if (shapeError) return res.status(400).json({ error: shapeError })

    const { data, error } = await supabaseAdmin.rpc('archive_zltac_event', {
      event_id: eventId,
      actor_id: user.id,
    })
    if (error) return sendEventLifecycleError(res, error, 'admin-event-archive')
    return res.json({ ok: true, ...(data ?? {}) })
  }

  if (action === 'delete') {
    const shapeError = validateEventLifecycleBody(req.body, action)
    if (shapeError) return res.status(400).json({ error: shapeError })
    // Destructive cascade — superadmin only. The dispatcher already
    // verifyCommittee'd the request; deletes raise the bar to superadmin.
    const { user: superadmin, error: err } = await verifySuperAdmin(req)
    if (err) return res.status(statusForAuthError(err)).json({ error: err })

    const { data, error } = await supabaseAdmin.rpc('delete_zltac_event', {
      event_id: eventId,
      actor_id: superadmin.id,
    })
    if (error) return sendEventLifecycleError(res, error, 'admin-event-delete')
    return res.json({ ok: true, ...(data ?? {}) })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── registrations ─────────────────────────────────────────────────────────────
async function handleEventDeleteImpact(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const { error: superErr } = await verifySuperAdmin(req)
  if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })

  const eventId = req.query.eventId
  if (!isUuid(eventId)) return res.status(400).json({ error: 'A valid eventId is required' })

  const { data: event, error: eventError } = await supabaseAdmin
    .from('zltac_events')
    .select('id, year')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError) return sendServerError(res, eventError, 'admin-event-delete-impact-event')
  if (!event) return res.status(404).json({ error: 'Event not found.' })

  const [registrationsResult, teamsResult, acceptancesResult, approvalsResult] = await Promise.all([
    supabaseAdmin.from('zltac_registrations').select('id', { count: 'exact', head: true }).eq('year', event.year),
    supabaseAdmin.from('teams').select('id', { count: 'exact', head: true }).eq('event_id', event.id),
    supabaseAdmin.from('legal_acceptances').select('id', { count: 'exact', head: true }).eq('event_year', event.year),
    supabaseAdmin.from('under_18_approvals').select('id', { count: 'exact', head: true }).eq('event_year', event.year),
  ])
  const error = [registrationsResult.error, teamsResult.error, acceptancesResult.error, approvalsResult.error].find(Boolean)
  if (error) return sendServerError(res, error, 'admin-event-delete-impact-counts')

  const legalAcceptances = acceptancesResult.count ?? 0
  const under18Approvals = approvalsResult.count ?? 0
  return res.json({
    registrations: registrationsResult.count ?? 0,
    teams: teamsResult.count ?? 0,
    legalAcceptances,
    under18Approvals,
  })
}

async function handleSignedDocuments(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const [documentsResult, acceptancesResult] = await Promise.all([
    supabaseAdmin
      .from('legal_documents')
      .select('id, document_type, version, original_filename, effective_date, is_active, content_sha256, published_at')
      .in('document_type', ['code_of_conduct', 'media_release'])
      .order('document_type', { ascending: true })
      .order('version', { ascending: false }),
    supabaseAdmin
      .from('legal_acceptances')
      .select('id, document_id, event_year, accepted_at, content_sha256, document:legal_documents!document_id(id, document_type, version, original_filename, effective_date, content_sha256), profile:profiles!user_id(id, alias, first_name, last_name)')
      .order('accepted_at', { ascending: false }),
  ])
  const error = documentsResult.error ?? acceptancesResult.error
  if (error) return sendServerError(res, error, 'admin-signed-documents')
  return res.json({
    documents: documentsResult.data ?? [],
    acceptances: acceptancesResult.data ?? [],
  })
}

async function handlePortalDashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const [usersResult, registrationsResult, archivedEventsResult] = await Promise.all([
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('zltac_registrations').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('zltac_events').select('id', { count: 'exact', head: true }).eq('status', 'archived'),
  ])
  const error = usersResult.error ?? registrationsResult.error ?? archivedEventsResult.error
  if (error) return sendServerError(res, error, 'admin-portal-dashboard')
  return res.json({
    totalUsers: usersResult.count ?? 0,
    lifetimeRegistrations: registrationsResult.count ?? 0,
    archivedEvents: archivedEventsResult.count ?? 0,
  })
}

async function handleRegistrations(req, res, user) {
  if (req.method === 'GET') {
    const year = parseInt(req.query.year)
    if (!year) return res.status(400).json({ error: 'year is required' })

    // Resolve the ZLTAC event id for this year so the teams query can be
    // scoped to it. teams.event_id is NULL for competition (pre-nats) teams,
    // so filtering on a concrete event id drops both competition teams and
    // teams from other years. If no event exists for the year, there are no
    // ZLTAC teams to show — return an empty teams set rather than an
    // unfiltered (.eq event_id NULL would otherwise match competition teams).
    const { data: ev, error: evLookupErr } = await supabaseAdmin
      .from('zltac_events')
      .select(EVENT_COLUMNS)
      .eq('year', year)
      .maybeSingle()
    if (evLookupErr) return sendServerError(res, evLookupErr, 'admin:event:registrations-event')
    const eventId = ev?.id ?? null
    const teamsQuery = eventId
      ? supabaseAdmin.from('teams').select('id, name, entry_type, state, status, captain_id, manager_id, home_venue, colour, logo_url, format, rejection_reason, created_at, event_id').eq('event_id', eventId)
      : Promise.resolve({ data: [], error: null })

    const [
      { data: registrations, error: e1 },
      { data: profiles, error: e2 },
      { data: teams, error: e3 },
      { data: acceptances, error: e4 },
      { data: ref_results, error: e5 },
      { data: payment_records_raw, error: e7 },
      { data: doubles, error: e8 },
      { data: triples, error: e9 },
      { data: u18_approvals, error: e10 },
    ] = await Promise.all([
      supabaseAdmin.from('zltac_registrations').select('id, user_id, team_id, year, status, created_at, side_events, dinner_guests, amount_owing, payment_reference, emergency_contact_name, emergency_contact_phone, has_confirmed_side_events, has_confirmed_extras, admin_note, dob_at_registration, admin_override_coc, admin_override_coc_set_by, admin_override_coc_set_at, admin_override_coc_reason, admin_override_media, admin_override_media_set_by, admin_override_media_set_at, admin_override_media_reason, admin_override_ref_test, admin_override_ref_test_set_by, admin_override_ref_test_set_at, admin_override_ref_test_reason, admin_override_u18, admin_override_u18_set_by, admin_override_u18_set_at, admin_override_u18_reason, teams(id, event_id, status)').eq('year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('id, first_name, last_name, alias, state, is_placeholder'),
      teamsQuery,
      supabaseAdmin
        .from('legal_acceptances')
        .select('user_id, accepted_at, document:legal_documents!document_id(document_type)')
        .eq('event_year', year),
      supabaseAdmin.from('referee_test_results').select('user_id, passed, score, safety_correct, safety_total, general_correct, general_total'),
      supabaseAdmin.from('payment_records')
        .select('id, registration_id, amount, recorded_at, recorded_by, bank_reference, notes, zltac_registrations!inner(year)')
        .eq('zltac_registrations.year', year),
      supabaseAdmin.from('doubles_pairs').select(DOUBLES_PAIR_COLUMNS).eq('event_year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('triples_teams').select(TRIPLES_TEAM_COLUMNS).eq('event_year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('under_18_approvals').select('user_id, status').eq('event_year', year).eq('status', 'approved'),
    ])

    const errs = [e1, e2, e3, e4, e5, e7, e8, e9, e10].filter(Boolean)
    if (errs.length) return sendServerError(res, errs[0], 'admin:event:registrations-list')

    const coc_sigs = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'code_of_conduct')
      .map(a => ({ user_id: a.user_id, signed_at: a.accepted_at }))
    const media_releases = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'media_release')
      .map(a => ({ user_id: a.user_id, submitted_at: a.accepted_at }))

    const payment_records = (payment_records_raw ?? []).map(r => ({
      id: r.id,
      registration_id: r.registration_id,
      amount: r.amount,
      recorded_at: r.recorded_at,
      recorded_by: r.recorded_by,
      bank_reference: r.bank_reference,
      notes: r.notes,
    }))

    let readinessByUser = {}
    if (ev && (registrations ?? []).length > 0) {
      try {
        readinessByUser = await getZltacReadinessForUsers({
          event: ev,
          userIds: registrations.map(registration => registration.user_id),
          registrations,
        })
      } catch (error) {
        return sendServerError(res, error, 'admin:registrations-readiness')
      }
    }

    return res.json({ registrations, profiles, teams, coc_sigs, ref_results, media_releases, payment_records, doubles, triples, u18_approvals, readinessByUser })
  }

  if (req.method === 'PATCH') {
    // Compose the full editor save in one database transaction. Validate every
    // partner and identity field before invoking it so malformed late fields
    // cannot produce a partial save.
    const body = req.body ?? {}
    const { registrationId } = body
    if (!isUuid(registrationId)) {
      return res.status(400).json({ error: 'registrationId must be a valid UUID' })
    }

    if ('status' in body && !['pending', 'confirmed'].includes(body.status)) {
      return res.status(400).json({
        error: body.status === 'cancelled'
          ? 'Use the registration cancellation action so roster and payment records are handled safely.'
          : 'Invalid status',
      })
    }
    if ('side_events' in body && !Array.isArray(body.side_events)) {
      return res.status(400).json({ error: 'side_events must be an array' })
    }

    const updates = {}
    if (Array.isArray(body.side_events)) updates.side_events = body.side_events
    if ('admin_note' in body) updates.admin_note = body.admin_note?.trim() || null
    if ('dinner_guests' in body) updates.dinner_guests = Math.max(0, parseInt(body.dinner_guests) || 0)
    if ('status' in body) updates.status = body.status
    if ('has_confirmed_side_events' in body) updates.has_confirmed_side_events = !!body.has_confirmed_side_events
    if ('has_confirmed_extras' in body) updates.has_confirmed_extras = !!body.has_confirmed_extras
    if ('emergency_contact_name' in body) updates.emergency_contact_name = body.emergency_contact_name?.trim() || null
    if ('emergency_contact_phone' in body) updates.emergency_contact_phone = body.emergency_contact_phone?.trim() || null
    // Override actor/timestamp transitions are derived while the database row
    // is locked. The route supplies only the tri-state value and its reason.
    const OVERRIDES = ['admin_override_coc', 'admin_override_media', 'admin_override_ref_test', 'admin_override_u18']
    for (const key of OVERRIDES) {
      if (!(key in body)) continue
      const raw = body[key]
      const newValue = raw === true ? true : raw === false ? false : null
      const reasonKey = `${key}_reason`

      if (newValue !== null) {
        const reason = typeof body[reasonKey] === 'string' ? body[reasonKey].trim() : ''
        if (reason.length < 5) {
          return res.status(400).json({ error: `${reasonKey} must be at least 5 characters when ${key} is set` })
        }
        updates[key] = newValue
        updates[reasonKey] = reason
      } else {
        updates[key] = null
        updates[reasonKey] = null
      }
    }

    const bundle = { updates }
    if ('team_id' in body) {
      const newTeamId = body.team_id || null
      if (newTeamId && !isUuid(newTeamId)) {
        return res.status(400).json({ error: 'team_id must be a valid UUID' })
      }
      bundle.team_id = newTeamId
    }

    if ('alias' in body) {
      if (body.alias !== null && typeof body.alias !== 'string') {
        return res.status(400).json({ error: 'alias must be a string or null' })
      }
      const alias = typeof body.alias === 'string' ? body.alias.trim() || null : null
      const aliasReason = typeof body.alias_change_reason === 'string' ? body.alias_change_reason.trim() : ''
      if (alias && alias.length > 30) {
        return res.status(400).json({ error: 'Alias must be 30 characters or fewer.' })
      }
      if (aliasReason.length < 5) {
        return res.status(400).json({ error: 'Alias change reason must be at least 5 characters.' })
      }
      bundle.alias = alias
      bundle.alias_reason = aliasReason
    }

    if ('state' in body) {
      if (body.state !== null && typeof body.state !== 'string') {
        return res.status(400).json({ error: 'state must be a string or null' })
      }
      bundle.state = typeof body.state === 'string' ? body.state.trim() || null : null
    }

    if ('doubles_partner_id' in body) {
      const newPartnerId = body.doubles_partner_id || null
      if (newPartnerId && !isUuid(newPartnerId)) {
        return res.status(400).json({ error: 'doubles_partner_id must be a valid UUID' })
      }
      bundle.doubles_partner_ids = newPartnerId ? [newPartnerId] : []
    }

    if ('triples_partner_ids' in body) {
      if (!Array.isArray(body.triples_partner_ids)) {
        return res.status(400).json({ error: 'triples_partner_ids must be an array' })
      }
      if (body.triples_partner_ids.length > 2) {
        return res.status(400).json({ error: 'triples_partner_ids must contain at most two ids' })
      }
      const partnerIds = body.triples_partner_ids
      const [p2, p3] = [partnerIds[0] || null, partnerIds[1] || null]
      if ((p2 && !isUuid(p2)) || (p3 && !isUuid(p3))) {
        return res.status(400).json({ error: 'triples_partner_ids contains an invalid id' })
      }
      bundle.triples_partner_ids = [p2, p3].filter(Boolean)
    }

    const { data, error } = await supabaseAdmin.rpc('admin_update_zltac_registration_bundle', {
      p_actor_id: user.id,
      p_registration_id: registrationId,
      p_bundle: bundle,
    })
    if (error?.code === '23505' && 'alias' in body) {
      return res.status(409).json({ error: 'That alias is already taken, please choose another.' })
    }
    if (error) return sendRosterMutationError(res, error, 'admin:event:registration-bundle')

    const result = Array.isArray(data) ? data[0] : data
    if (!result) {
      return sendServerError(res, new Error('Registration bundle RPC returned no result.'), 'admin:event:registration-bundle-result')
    }
    return res.json(result)
  }

  if (req.method === 'DELETE') {
    // `kind` distinguishes the satellite resources from the registration itself
    // (was `resource` before the event/registrations/payments consolidation —
    // renamed to avoid clashing with the top-level ?resource dispatch).
    const { kind, id, userId, year } = req.body ?? {}

    if (kind === 'doubles' || kind === 'triples') {
      if (!isUuid(id)) return res.status(400).json({ error: 'id must be a valid UUID' })
      const { data, error } = await supabaseAdmin.rpc('admin_delete_zltac_side_event_roster', {
        p_actor_id: user.id,
        p_format: kind,
        p_roster_id: id,
      })
      if (error) return sendRosterMutationError(res, error, `admin:event:${kind}-delete`)
      return res.json({ ok: true, ...(data ?? {}) })
    }

    if (!userId || !year) return res.status(400).json({ error: 'userId and year are required' })
    if (!isUuid(userId)) return res.status(400).json({ error: 'userId must be a valid UUID' })

    const { data, error } = await supabaseAdmin.rpc('cancel_zltac_registration', {
      p_user_id: userId,
      p_event_year: Number.parseInt(year, 10),
    })
    if (error) return sendRosterMutationError(res, error, 'admin:event:registration-delete')
    return res.json({ ok: true, ...(data ?? {}) })
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}

    // link-placeholder — Chunk 2 manual fallback. Committee picks any real
    // user to absorb a stuck placeholder (alias/email auto-match failed or the
    // real user prefers not to use the banner). Invokes the same
    // actor-explicit merge RPC, so the year-conflict check, FK moves, and
    // deletion stay atomic. The RPC independently validates the active
    // committee/advisor role of the already verified API actor.
    if (body.action === 'link-placeholder') {
      const { placeholder_id, real_user_id } = body
      if (!placeholder_id || !real_user_id) {
        return res.status(400).json({ error: 'placeholder_id and real_user_id are required' })
      }
      if (!isUuid(placeholder_id) || !isUuid(real_user_id)) {
        return res.status(400).json({ error: 'placeholder_id and real_user_id must be valid UUIDs' })
      }
      const { data, error } = await supabaseAdmin.rpc('merge_placeholder_profile', {
        p_actor_id: user.id,
        p_placeholder_id: placeholder_id,
        p_real_id: real_user_id,
        p_mode: 'admin',
      })
      if (error) return sendServerError(res, error, 'admin:event:registration-placeholder-link')
      if (data && data.ok === false) return res.status(400).json(data)
      return res.json(data ?? { ok: true })
    }

    // create-placeholder-registration — committee creates a profile + registration
    // for a player who has no portal account (a "placeholder", is_placeholder=true).
    // See migration 20260524000000_placeholder_profiles.sql.
    if (body.action !== 'create-placeholder-registration') {
      return res.status(400).json({ error: `Unknown action: ${body.action}` })
    }

    const eventYear = parseInt(body.event_year)
    const firstName = (body.first_name ?? '').trim()
    const alias     = (body.alias ?? '').trim()

    if (!eventYear) return res.status(400).json({ error: 'Event year is required' })
    if (!firstName) return res.status(400).json({ error: 'First name is required' })
    if (!alias)     return res.status(400).json({ error: 'Alias is required' })
    if (!body.dob) return res.status(400).json({ error: 'Date of birth is required' })
    if (body.doubles_partner_id && !isUuid(body.doubles_partner_id)) {
      return res.status(400).json({ error: 'doubles_partner_id must be a valid UUID' })
    }
    if (body.triples_partner_ids != null && !Array.isArray(body.triples_partner_ids)) {
      return res.status(400).json({ error: 'triples_partner_ids must be an array' })
    }
    const triplesPartnerIds = (body.triples_partner_ids ?? []).filter(Boolean)
    if (triplesPartnerIds.length > 2 || triplesPartnerIds.some(id => !isUuid(id))) {
      return res.status(400).json({ error: 'triples_partner_ids contains invalid ids' })
    }

    const { data, error } = await supabaseAdmin.rpc('admin_create_placeholder_zltac_registration', {
      p_actor_id: user.id,
      p_event_year: eventYear,
      p_first_name: firstName,
      p_last_name: (body.last_name ?? '').trim() || null,
      p_alias: alias,
      p_placeholder_email: (body.email ?? '').trim() || null,
      p_phone: (body.phone ?? '').trim() || null,
      p_state: body.state || null,
      p_dob: body.dob,
      p_emergency_contact_name: (body.emergency_contact_name ?? '').trim() || null,
      p_emergency_contact_phone: (body.emergency_contact_phone ?? '').trim() || null,
      p_team_id: body.team_id || null,
      p_side_events: Array.isArray(body.side_events) ? body.side_events : [],
      p_dinner_guests: Math.max(0, Number.parseInt(body.dinner_guests, 10) || 0),
      p_doubles_partner_id: body.doubles_partner_id || null,
      p_triples_partner_ids: triplesPartnerIds,
    })
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: error.message })
      return sendRosterMutationError(res, error, 'admin:event:placeholder-create')
    }

    const registration = data?.registration ?? null
    return res.status(201).json({
      registration: registration
        ? { ...registration, amount_owing: data.amountOwing ?? registration.amount_owing }
        : null,
      profile: data?.profile ?? null,
      payment_reference: registration?.payment_reference ?? null,
    })

  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── payments ──────────────────────────────────────────────────────────────────
function validAmount(v) {
  return Number.isInteger(v) && v !== 0
}

function validPositiveAmount(v) {
  return Number.isInteger(v) && v > 0
}

function sendPaymentMutationError(res, error, context) {
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'Payment state has changed. Refresh and try again.'
  if (['22007', '22023', '22P02', '23514'].includes(error?.code)) {
    return res.status(400).json({ error: message })
  }
  if (error?.code === '42501') return res.status(403).json({ error: message })
  if (error?.code === 'P0002') return res.status(404).json({ error: message })
  if (['23503', '23505', '55000'].includes(error?.code)) {
    return res.status(409).json({ error: message })
  }
  return sendServerError(res, error, context)
}

async function handlePayments(req, res, user) {
  if (req.method === 'POST') {
    const { registrationId, requestId, amountCents, datePaid, bankReference, notes, type, reason } = req.body ?? {}
    if (!isUuid(registrationId)) return res.status(400).json({ error: 'registrationId must be a valid UUID' })
    if (!isUuid(requestId)) return res.status(400).json({ error: 'requestId must be a valid UUID' })

    const recordType = type ?? 'payment'
    if (recordType !== 'payment' && recordType !== 'refund') {
      return res.status(400).json({ error: "type must be 'payment' or 'refund'" })
    }
    if (!validPositiveAmount(amountCents)) {
      return res.status(400).json({ error: 'amountCents must be a positive integer' })
    }

    let storedNotes = notes?.trim() || null
    if (recordType === 'refund') {
      const trimmedReason = reason?.trim() ?? ''
      if (!trimmedReason) return res.status(400).json({ error: 'reason is required for refunds' })
      storedNotes = storedNotes
        ? `Refund - ${trimmedReason} - ${storedNotes}`
        : `Refund - ${trimmedReason}`
    }

    const signedAmount = recordType === 'refund' ? -amountCents : amountCents

    const { data, error } = await supabaseAdmin.rpc('record_zltac_payment', {
      p_actor_id: user.id,
      p_registration_id: registrationId,
      p_request_id: requestId,
      p_amount: signedAmount,
      p_recorded_at: datePaid || null,
      p_bank_reference: bankReference?.trim() || null,
      p_notes: storedNotes,
    })
    if (error) return sendPaymentMutationError(res, error, 'admin:event:payment-create')
    return res.status(201).json(singleRpcRecord(data))
  }

  if (req.method === 'PATCH') {
    const { id, requestId, amountCents, datePaid, bankReference, notes } = req.body ?? {}
    if (!isUuid(id)) return res.status(400).json({ error: 'id must be a valid UUID' })
    if (!isUuid(requestId)) return res.status(400).json({ error: 'requestId must be a valid UUID' })
    if (!validAmount(amountCents)) return res.status(400).json({ error: 'amountCents must be a non-zero integer' })

    // recorded_at is only sent when datePaid was provided — the key-present RPC
    // semantics preserve the stored date when it's omitted, so editing an
    // unrelated field (e.g. a note) no longer silently resets the payment date.
    const p_changes = {
      amount: amountCents,
      bank_reference: bankReference?.trim() || null,
      notes: notes?.trim() || null,
    }
    if (datePaid) p_changes.recorded_at = datePaid

    const { data, error } = await supabaseAdmin.rpc('update_zltac_payment', {
      p_actor_id: user.id,
      p_payment_id: id,
      p_request_id: requestId,
      p_changes,
    })
    if (error) return sendPaymentMutationError(res, error, 'admin:event:payment-update')
    return res.json(singleRpcRecord(data))
  }

  if (req.method === 'DELETE') {
    const { id, requestId } = req.body ?? {}
    if (!isUuid(id)) return res.status(400).json({ error: 'id must be a valid UUID' })
    if (!isUuid(requestId)) return res.status(400).json({ error: 'requestId must be a valid UUID' })

    const { data, error } = await supabaseAdmin.rpc('remove_zltac_payment', {
      p_actor_id: user.id,
      p_payment_id: id,
      p_request_id: requestId,
    })
    if (error) return sendPaymentMutationError(res, error, 'admin:event:payment-delete')
    return res.json(singleRpcRecord(data))
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── backup-settings ───────────────────────────────────────────────────────────
// Committee may read; superadmin may update (enforced by RLS on the table).
// Service-role here bypasses RLS, so the API gates writes explicitly: only
// the caller's profile.roles ∋ 'superadmin' may PATCH. Reads admit any
// committee role (the dispatcher already verifyCommittee'd the request).
async function handleBackupSettings(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('backup_settings')
      .select(BACKUP_SETTINGS_COLUMNS)
      .eq('id', 1)
      .maybeSingle()
    if (error) return sendServerError(res, error, 'admin:event:backup-settings-read')
    return res.json({
      ...(data ?? {}),
      health: backupScheduleHealth(data),
    })
  }

  if (req.method === 'PATCH') {
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('roles')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr) return sendServerError(res, profileErr, 'admin:event:backup-settings-authorisation')
    const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')
    if (!isSuperadmin) {
      return res.status(403).json({ error: 'Only superadmins can change the backup schedule.' })
    }

    const body = req.body ?? {}
    const updates = {}
    if ('frequency' in body) {
      if (!['daily', 'weekly', 'off'].includes(body.frequency)) {
        return res.status(400).json({ error: "frequency must be 'daily', 'weekly', or 'off'" })
      }
      updates.frequency = body.frequency
    }
    if ('weekly_day' in body) {
      const n = Number(body.weekly_day)
      if (!Number.isInteger(n) || n < 0 || n > 6) {
        return res.status(400).json({ error: 'weekly_day must be an integer 0-6' })
      }
      updates.weekly_day = n
    }
    if ('recipient_emails' in body) {
      if (!Array.isArray(body.recipient_emails)) {
        return res.status(400).json({ error: 'recipient_emails must be an array' })
      }
      const cleaned = []
      for (const e of body.recipient_emails) {
        if (typeof e !== 'string') return res.status(400).json({ error: 'each recipient email must be a string' })
        const trimmed = e.trim()
        if (!trimmed) continue
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return res.status(400).json({ error: `invalid email address: ${trimmed}` })
        }
        cleaned.push(trimmed)
      }
      updates.recipient_emails = cleaned
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no editable fields supplied' })
    }

    const { data, error } = await supabaseAdmin
      .from('backup_settings')
      .update(updates)
      .eq('id', 1)
      .select()
      .single()
    if (error) return sendServerError(res, error, 'admin:event:backup-settings-update')
    return res.json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── backup-run ────────────────────────────────────────────────────────────────
// Generates the backup CSVs, stores them privately, sends an optional
// summary-only notification, and updates last_backup_at/status.
//
// Two auth contexts converge here:
//   - Cron: enforces frequency + weekly_day in Australia/Sydney
//   - Admin manual: always stores, bypasses frequency/weekly_day
async function loadBackupRun(runId) {
  try {
    return await supabaseAdmin
      .from('backup_runs')
      .select('id, status, object_prefix, object_paths, completed_at')
      .eq('id', runId)
      .maybeSingle()
  } catch (error) {
    return { data: null, error }
  }
}

function isBackupLeaseConflict(error) {
  return error?.code === '55P03'
    || error?.hint === 'BACKUP_ALREADY_RUNNING'
    || error?.code === '23505'
}

async function beginBackupRun({ runId, objectPrefix, triggeredBy }) {
  let data
  let error
  try {
    const result = await supabaseAdmin.rpc('begin_portal_backup_run', {
      p_run_id: runId,
      p_object_prefix: objectPrefix,
      p_triggered_by: triggeredBy,
    })
    data = result.data
    error = result.error
  } catch (caught) {
    error = caught
  }
  if (!error) return { data, error: null, conflict: false }
  if (isBackupLeaseConflict(error)) return { data: null, error, conflict: true }

  // The database may have committed while the HTTP response was lost. Re-read
  // the exact run id before treating the lease as failed, so a safe retry does
  // not leave an invisible 30-minute lease behind.
  const reconciliation = await loadBackupRun(runId)
  if (!reconciliation.error
      && reconciliation.data?.status === 'running'
      && reconciliation.data.object_prefix === objectPrefix) {
    return { data: reconciliation.data, error: null, conflict: false, reconciled: true }
  }
  return { data: null, error, conflict: false, reconciliationError: reconciliation.error }
}

async function finishBackupRun({
  runId,
  status,
  objectPaths = [],
  manifest = null,
  failureMessage = null,
  completedAt = new Date().toISOString(),
}) {
  try {
    return await supabaseAdmin.rpc('finish_portal_backup_run', {
      p_run_id: runId,
      p_status: status,
      p_object_paths: objectPaths,
      p_manifest: manifest,
      p_failure_message: failureMessage,
      p_completed_at: completedAt,
    })
  } catch (error) {
    return { data: null, error }
  }
}

function sameObjectPaths(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((path, index) => path === expected[index])
}

async function stageBackupRunObjects({ runId, objectPaths }) {
  let data
  let error
  try {
    const result = await supabaseAdmin
      .from('backup_runs')
      .update({ object_paths: objectPaths })
      .eq('id', runId)
      .eq('status', 'running')
      .select('id, status, object_prefix, object_paths')
      .maybeSingle()
    data = result.data
    error = result.error
  } catch (caught) {
    error = caught
  }
  if (!error && data?.status === 'running' && sameObjectPaths(data.object_paths, objectPaths)) {
    return { error: null }
  }

  // Treat an update response as ambiguous until the exact run is reloaded.
  // Uploads never begin without a durable inventory of every candidate path.
  let reconciliation
  try {
    reconciliation = await loadBackupRun(runId)
  } catch (caught) {
    reconciliation = { data: null, error: caught }
  }
  if (!reconciliation.error
      && reconciliation.data?.status === 'running'
      && sameObjectPaths(reconciliation.data.object_paths, objectPaths)) {
    return { error: null, reconciled: true }
  }
  return {
    error: error ?? new Error('Backup object inventory could not be persisted.'),
    reconciliationError: reconciliation.error,
  }
}

async function handleBackupRun(req, res, { enforceSchedule, triggeredBy }) {
  const expectedMethod = enforceSchedule ? 'GET' : 'POST'
  if (req.method !== expectedMethod) return res.status(405).json({ error: 'Method not allowed' })

  // Helper to write the outcome back to backup_settings. Best-effort; an
  // error here is logged but never bubbles up.
  async function recordOutcome(status, sentAt) {
    let error
    try {
      const result = await supabaseAdmin
        .from('backup_settings')
        .update({ last_backup_at: sentAt ?? new Date().toISOString(), last_backup_status: status })
        .eq('id', 1)
      error = result.error
    } catch (caught) {
      error = caught
    }
    if (error) {
      console.error('[backup-run] failed to record outcome:', error.message)
      captureServerException(error, 'admin-backup-run-record-outcome')
    }
  }

  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from('backup_settings')
    .select(BACKUP_SETTINGS_COLUMNS)
    .eq('id', 1)
    .maybeSingle()
  if (settingsErr) return sendServerError(res, settingsErr, 'admin:event:backup-run-settings')
  if (!settings) {
    return sendServerError(
      res,
      new Error('Backup settings row is missing.'),
      'admin:event:backup-run-settings-result',
    )
  }

  if (enforceSchedule) {
    const health = backupScheduleHealth(settings)
    if (health.stale) {
      captureServerException(
        new Error(health.message || `Backup schedule health is ${health.status}.`),
        'admin-backup-schedule-health',
        {
          status: health.status,
          ageHours: health.ageHours ?? null,
          maxAgeHours: health.maxAgeHours,
        },
      )
    }
  }

  const { dateStr, dayOfWeek } = sydneyDateInfo()

  // Schedule gate — cron only. Manual admin runs always proceed.
  if (enforceSchedule) {
    if (settings.frequency === 'off') {
      await recordOutcome(`Skipped on ${dateStr}: frequency is off`)
      return res.json({ ok: true, skipped: 'disabled' })
    }
    if (settings.frequency === 'weekly' && dayOfWeek !== settings.weekly_day) {
      // Don't update last_backup_status for "wrong day" — that would
      // overwrite the real last-run status every day in between. Only the
      // active-day runs touch the row.
      return res.json({ ok: true, skipped: 'not_weekly_day' })
    }
  }

  const runId = randomUUID()
  const objectPrefix = `${dateStr}/${new Date().toISOString().replace(/[:.]/g, '-')}-${runId}`
  const start = await beginBackupRun({ runId, objectPrefix, triggeredBy })
  if (start.conflict) {
    return res.status(409).json({
      error: 'A portal backup is already running. Wait for it to finish before starting another.',
      code: 'BACKUP_ALREADY_RUNNING',
    })
  }
  if (start.error) {
    if (start.reconciliationError) {
      captureServerException(start.reconciliationError, 'admin-backup-run-start-reconciliation', { runId })
    }
    return sendServerError(res, start.error, 'admin:event:backup-run-start')
  }

  await reconcileFailedBackupObjects(supabaseAdmin, {
    onError(error, operation, failedRunId) {
      captureServerException(error, `admin-backup-run-orphan-${operation}`, {
        runId,
        failedRunId,
      })
    },
  })

  const failRun = async (message, retainedObjectPaths = []) => {
    captureServerException(new Error(message), 'admin-backup-run', { runId })
    const { error } = await finishBackupRun({
      runId,
      status: 'failed',
      objectPaths: retainedObjectPaths,
      failureMessage: message,
    })
    if (error) {
      const reconciliation = await loadBackupRun(runId)
      const reconciledPaths = reconciliation.data?.object_paths ?? []
      const evidencePreserved = reconciledPaths.length === retainedObjectPaths.length
        && reconciledPaths.every((path, index) => path === retainedObjectPaths[index])
      if (reconciliation.error
          || reconciliation.data?.status !== 'failed'
          || !evidencePreserved) {
        captureServerException(error, 'admin-backup-run-failure-transition', { runId })
        if (reconciliation.error) {
          captureServerException(
            reconciliation.error,
            'admin-backup-run-failure-reconciliation',
            { runId },
          )
        }
      }
    }
    await recordOutcome(`Failed: ${message}`)
  }

  // Generate the four CSVs.
  let csvs
  try {
    csvs = await generateBackupCsvs(supabaseAdmin)
  } catch (err) {
    const msg = err?.message || 'CSV generation failed'
    await failRun(`Generation failed: ${msg}`)
    return sendServerError(res, err, 'admin:event:backup-run-generate')
  }

  const { manifest, files: storedFiles } = buildBackupFiles(csvs)
  const objectPaths = storedFiles.map(file => `${objectPrefix}/${file.name}`)
  const staged = await stageBackupRunObjects({ runId, objectPaths })
  if (staged.error) {
    if (staged.reconciliationError) {
      captureServerException(
        staged.reconciliationError,
        'admin-backup-run-object-inventory-reconciliation',
        { runId },
      )
    }
    await failRun(`Object inventory failed: ${staged.error.message}`)
    return sendServerError(res, staged.error, 'admin:event:backup-run-object-inventory')
  }

  const uploadResults = await Promise.all(storedFiles.map(async (file, index) => {
    try {
      return await supabaseAdmin.storage.from('portal-backups').upload(
        objectPaths[index],
        Buffer.from(file.content, 'utf8'),
        { contentType: file.contentType, upsert: false },
      )
    } catch (error) {
      return { data: null, error }
    }
  }))
  const uploadError = uploadResults.find(result => result?.error)?.error
  if (uploadError) {
    const cleanup = await removeBackupObjects(supabaseAdmin, objectPaths)
    if (cleanup.error) {
      captureServerException(cleanup.error, 'admin-backup-run-upload-cleanup', { runId })
    }
    await failRun(
      `Storage failed: ${uploadError?.message || 'Object upload failed.'}`,
      cleanup.removed ? [] : objectPaths,
    )
    return sendServerError(res, uploadError, 'admin:event:backup-run-upload')
  }

  const completedAt = new Date().toISOString()
  const { error: completeErr } = await finishBackupRun({
    runId,
    status: 'complete',
    objectPaths,
    manifest,
    completedAt,
  })
  if (completeErr) {
    // Reconcile an ambiguous RPC response before removing valid objects. If
    // the terminal transition committed, the stored run is authoritative and
    // the backup is complete despite the lost HTTP response.
    const reconciliation = await loadBackupRun(runId)
    const completionCommitted = !reconciliation.error
      && reconciliation.data?.status === 'complete'
      && reconciliation.data.object_prefix === objectPrefix
      && sameObjectPaths(reconciliation.data.object_paths, objectPaths)
    if (!completionCommitted) {
      if (reconciliation.error) {
        captureServerException(
          reconciliation.error,
          'admin-backup-run-completion-reconciliation',
          { runId },
        )
        // Completion may have committed. Keep the objects and their staged
        // database inventory until a later worker can determine the outcome.
        await recordOutcome('Failed: Backup completion could not be confirmed; objects retained for reconciliation')
      } else {
        const cleanup = await removeBackupObjects(supabaseAdmin, objectPaths)
        if (cleanup.error) {
          captureServerException(cleanup.error, 'admin-backup-run-metadata-cleanup', { runId })
        }
        await failRun(
          `Metadata failed: ${completeErr.message}`,
          cleanup.removed ? [] : objectPaths,
        )
      }
      return sendServerError(res, completeErr, 'admin:event:backup-run-complete')
    }
  }

  // Optional email contains summary counts only. PII remains in private storage.
  const breakdownLines = csvs.eventBreakdown.map(
    e => `  - ${e.name || 'Unnamed event'} ${e.year}: ${e.registrationCount} registration${e.registrationCount === 1 ? '' : 's'}`,
  )
  const triggerNote = triggeredBy ? 'Triggered manually by an administrator.' : 'Triggered by the scheduled backup.'
  const bodyText = [
    `ALSA Portal backup stored successfully for ${dateStr} (Australia/Sydney).`,
    '',
    `Registrations: ${csvs.registrationsCount}`,
    `Payment records: ${csvs.paymentsCount}`,
    `Events: ${csvs.eventsCount}`,
    '',
    csvs.eventBreakdown.length > 0 ? 'Per event:' : 'No event registrations yet.',
    ...breakdownLines,
    '',
    'The files are in the private portal-backups storage bucket. No personal data is attached to this email.',
    '',
    triggerNote,
  ].join('\n')

  const subject = `ALSA Portal backup for ${dateStr} (${csvs.registrationsCount} registrations, ${csvs.eventsCount} events)`

  const recipients = Array.isArray(settings.recipient_emails) ? settings.recipient_emails : []
  let sendError = recipients.length > 0 && !process.env.RESEND_API_KEY
    ? 'RESEND_API_KEY is not configured'
    : null
  if (recipients.length > 0 && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const { error } = await resend.emails.send({
        from: 'ALSA Portal Backup <noreply@lasersport.org.au>',
        to: recipients,
        subject,
        text: bodyText,
      })
      if (error) sendError = error?.message || 'Resend returned an error'
    } catch (err) {
      sendError = err?.message || 'Resend threw'
    }
  }

  if (sendError) {
    console.error('[backup-run] notification email failed:', sendError)
    captureServerException(new Error(sendError), 'admin-backup-run-notification', { runId })
  }

  const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  let expiredRuns
  let retentionQueryError
  try {
    const result = await supabaseAdmin
      .from('backup_runs')
      .select('id, object_paths')
      .eq('status', 'complete')
      .lt('started_at', retentionCutoff)
    expiredRuns = result.data
    retentionQueryError = result.error
  } catch (error) {
    retentionQueryError = error
  }
  if (retentionQueryError) {
    captureServerException(retentionQueryError, 'admin-backup-run-retention-query', { runId })
  }
  for (const expired of expiredRuns ?? []) {
    if (expired.object_paths?.length) {
      const { error: removeErr } = await removeBackupObjects(supabaseAdmin, expired.object_paths)
      if (removeErr) {
        captureServerException(removeErr, 'admin-backup-run-retention-remove', {
          runId,
          expiredRunId: expired.id,
        })
        continue
      }
    }
    let deleteErr
    try {
      const result = await supabaseAdmin.from('backup_runs').delete().eq('id', expired.id)
      deleteErr = result.error
    } catch (error) {
      deleteErr = error
    }
    if (deleteErr) {
      captureServerException(deleteErr, 'admin-backup-run-retention-delete', {
        runId,
        expiredRunId: expired.id,
      })
    }
  }

  const notificationStatus = recipients.length === 0
    ? 'no notification recipients configured'
    : sendError
      ? `notification failed: ${sendError}`
      : `notified ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`
  await recordOutcome(`Stored privately; ${notificationStatus}`, completedAt)
  return res.json({
    ok: true,
    stored: true,
    notified: recipients.length > 0 && !sendError,
    date: dateStr,
    objectPrefix,
    registrations: csvs.registrationsCount,
    payments: csvs.paymentsCount,
    events: csvs.eventsCount,
    recipients: recipients.length,
    notificationError: sendError,
  })
}


// ── zltac-dashboard ───────────────────────────────────────────────────────────
// Aggregate for AdminZltacDashboard. Collapses the client's resolve-event-then-
// fan-out waterfall (one serial edge + eight queries) into a single committee-
// gated call: it resolves the open event, runs the year/event-scoped counts and
// recent-activity reads in parallel, computes the stat tiles, and returns the
// ready-to-render payload. Only rendered values are returned (counts, ratio
// strings, dollar strings, labels) plus raw activity timestamps the client
// formats viewer-local — no raw registration / payment / override rows ship.
// Committee auth is enforced by the verifyCommittee gate in the dispatcher.
async function handleZltacDashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // "X / N (Y%)" — guards divide-by-zero. Mirrors the old client helper.
  const ratioLabel = (x, n) => {
    const num = x ?? 0
    const denom = n ?? 0
    if (denom <= 0) return `${num} / 0`
    return `${num} / ${denom} (${Math.round((num / denom) * 100)}%)`
  }

  // 1. Resolve the active (open) event — the one genuine serial dependency.
  const { data: activeEvent, error: evErr } = await supabaseAdmin
    .from('zltac_events')
    .select('id, name, year, require_ref_test, require_coc, require_payment')
    .eq('status', 'open')
    .limit(1).maybeSingle()
  if (evErr) return sendServerError(res, evErr, 'admin:event:dashboard-event')

  const activeYear = activeEvent?.year ?? null
  const activeEventId = activeEvent?.id ?? null
  const eventLabel = activeEvent ? `${activeEvent.name} ${activeEvent.year}` : '—'
  const eventScope = activeEvent ? `${activeEvent.name} ${activeEvent.year}` : 'No active event'

  // 2. Year/event-scoped counts + recent-activity rows, all in parallel.
  const [
    teamsRes,
    { data: regsForYear, error: e2 },
    { data: payRecsForYear, error: e3 },
    { data: refResults, error: e4 },
    { data: cocMediaAccs, error: e5 },
    { data: recentRegs, error: e6 },
    { data: recentPayRecs, error: e7 },
    { data: recentCoc, error: e8 },
  ] = await Promise.all([
    activeEventId
      ? supabaseAdmin.from('teams').select('*', { count: 'exact', head: true }).eq('event_id', activeEventId)
      : Promise.resolve({ count: 0 }),
    activeYear
      ? supabaseAdmin.from('zltac_registrations').select('id, user_id, amount_owing, admin_override_coc, admin_override_media, admin_override_ref_test').eq('year', activeYear)
      : Promise.resolve({ data: [] }),
    activeYear
      ? supabaseAdmin.from('payment_records')
          .select('registration_id, amount, zltac_registrations!inner(year)')
          .eq('zltac_registrations.year', activeYear)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('referee_test_results').select('user_id, passed'),
    activeYear
      ? supabaseAdmin.from('legal_acceptances')
          .select('user_id, document:legal_documents!document_id(document_type)')
          .eq('event_year', activeYear)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('zltac_registrations')
      .select('id, created_at, year, profiles!zltac_registrations_user_id_fkey(first_name, alias)')
      .order('created_at', { ascending: false }).limit(5),
    supabaseAdmin.from('payment_records')
      .select('amount, recorded_at, registration:zltac_registrations!inner(profiles!zltac_registrations_user_id_fkey(first_name, alias))')
      .order('recorded_at', { ascending: false }).limit(5),
    supabaseAdmin.from('legal_acceptances')
      .select('accepted_at, profiles!user_id(first_name, alias), document:legal_documents!document_id(document_type)')
      .order('accepted_at', { ascending: false }).limit(20),
  ])

  const errs = [teamsRes?.error, e2, e3, e4, e5, e6, e7, e8].filter(Boolean)
  if (errs.length) return sendServerError(res, errs[0], 'admin:event:dashboard-data')

  const teamsForEvent = teamsRes?.count ?? 0
  const playersForEvent = (regsForYear ?? []).length

  // Payment totals: sum payment_records by registration, then per-reg balance.
  const paidByReg = {}
  let paymentsReceivedCents = 0
  for (const rec of (payRecsForYear ?? [])) {
    paidByReg[rec.registration_id] = (paidByReg[rec.registration_id] ?? 0) + (rec.amount ?? 0)
    paymentsReceivedCents += rec.amount ?? 0
  }
  let amountOwingCents = 0
  for (const reg of (regsForYear ?? [])) {
    const balance = (reg.amount_owing ?? 0) - (paidByReg[reg.id] ?? 0)
    if (balance > 0) amountOwingCents += balance
  }

  // Ratios honour the tri-state override: a user counts satisfied iff the
  // override is true, or the override is null/absent and the real record
  // satisfies it. An override of false (force incomplete) excludes the user.
  const registeredUserIds = new Set((regsForYear ?? []).map(r => r.user_id))
  const overrideCoc   = new Map((regsForYear ?? []).map(r => [r.user_id, r.admin_override_coc]))
  const overrideMedia = new Map((regsForYear ?? []).map(r => [r.user_id, r.admin_override_media]))
  const overrideRef   = new Map((regsForYear ?? []).map(r => [r.user_id, r.admin_override_ref_test]))
  const effective = (ov, real) => (ov == null ? real : ov === true)

  const refPassedUserIds = new Set((refResults ?? []).filter(r => r.passed).map(r => r.user_id))
  const refPassedRegistered = [...registeredUserIds].filter(uid => effective(overrideRef.get(uid), refPassedUserIds.has(uid))).length

  const cocSignedUserIds = new Set((cocMediaAccs ?? []).filter(a => a.document?.document_type === 'code_of_conduct').map(a => a.user_id))
  const mediaSignedUserIds = new Set((cocMediaAccs ?? []).filter(a => a.document?.document_type === 'media_release').map(a => a.user_id))
  const cocSignedRegistered   = [...registeredUserIds].filter(uid => effective(overrideCoc.get(uid),   cocSignedUserIds.has(uid))).length
  const mediaSignedRegistered = [...registeredUserIds].filter(uid => effective(overrideMedia.get(uid), mediaSignedUserIds.has(uid))).length

  const refRequired = isRefTestRequired(activeEvent)
  const cocRequired = isCocRequired(activeEvent)
  const paymentRequired = isPaymentRequired(activeEvent)

  const stats = {
    teamsForEvent,
    playersForEvent,
    paymentRequired,
    paymentsReceivedDisplay: paymentRequired ? dollars(paymentsReceivedCents ?? 0) : 'N/A',
    amountOwingDisplay:      paymentRequired ? dollars(amountOwingCents ?? 0)     : 'N/A',
    amountOwingCents,
    refRequired,
    refRatio:   refRequired ? ratioLabel(refPassedRegistered, playersForEvent) : 'N/A',
    cocRequired,
    cocRatio:   cocRequired ? ratioLabel(cocSignedRegistered, playersForEvent) : 'N/A',
    mediaRatio: ratioLabel(mediaSignedRegistered, playersForEvent),
    eventLabel,
    eventScope,
    eventName: activeEvent?.name ?? null,
    eventYear: activeYear,
    eventOpen: !!activeEvent,
  }

  // Activity feed. Timestamps stay raw (ts); the client formats them
  // viewer-local via its existing fmt(), preserving the prior render exactly.
  const displayName = profiles => {
    if (!profiles) return 'A player'
    return profiles.alias || profiles.first_name || 'A player'
  }
  const feed = []
  for (const r of recentRegs ?? []) {
    feed.push({ icon: '📋', text: `${displayName(r.profiles)} registered for ZLTAC ${r.year ?? activeYear ?? ''}`, ts: r.created_at })
  }
  for (const p of recentPayRecs ?? []) {
    const prof = p.registration?.profiles
    const isRefund = (p.amount ?? 0) < 0
    feed.push({
      icon: isRefund ? '↩️' : '💳',
      text: isRefund
        ? `${displayName(prof)} refunded ${dollars(Math.abs(p.amount))}`
        : `${displayName(prof)} paid ${dollars(p.amount)}`,
      ts: p.recorded_at,
    })
  }
  const cocAcceptances = (recentCoc ?? []).filter(a => a.document?.document_type === 'code_of_conduct').slice(0, 5)
  for (const c of cocAcceptances) {
    feed.push({ icon: '✅', text: `${displayName(c.profiles)} accepted the Code of Conduct`, ts: c.accepted_at })
  }
  feed.sort((a, b) => new Date(b.ts) - new Date(a.ts))

  return res.json({ stats, activity: feed.slice(0, 12) })
}


// ── profile-search ────────────────────────────────────────────────────────────
// Committee-gated typeahead backing the LinkPlaceholderModal merge picker
// (AdminRegistrations). Replaces a whole-profiles client fetch + client filter.
// Mirrors the modal's old client semantics: case-insensitive contains-match on
// the same fields (alias OR first/last name), active non-placeholder profiles
// only. Suspended and permanently revoked accounts cannot receive a merge.
// Returns just the columns the picker renders + needs for the link; no
// sensitive columns. Bounded by limit(25); a query under 2 chars returns [] so
// the endpoint never runs an unfiltered scan. Committee auth is enforced by the
// verifyCommittee gate in the dispatcher below.
async function handleProfileSearch(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const q = (req.query.q ?? '').trim()
  if (q.length < 2) return res.json([])

  // Escape LIKE wildcards so a query like "a_b" matches literally, then wrap
  // the value in double quotes for the PostgREST .or() filter so embedded
  // commas/parens in the query aren't parsed as logic-tree separators (the
  // inner " and \ are backslash-escaped for the quoted form).
  const likeEscaped = q.replace(/[\\%_]/g, m => `\\${m}`)
  const orValue = `"%${likeEscaped.replace(/["\\]/g, m => `\\${m}`)}%"`

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, alias, state, is_placeholder')
    .eq('is_placeholder', false)
    .eq('suspended', false)
    .is('access_revoked_at', null)
    .or(`alias.ilike.${orValue},first_name.ilike.${orValue},last_name.ilike.${orValue}`)
    .limit(25)
  if (error) return sendServerError(res, error, 'admin:event:profile-search')
  return res.json(data ?? [])
}


// ── Dispatch ──────────────────────────────────────────────────────────────────
// ── team-review ────────────────────────────────────────────────────────────
// Committee approve/reject of a ZLTAC team's submission. Replaces the old
// client-side direct teams.update({status}). Runs on the service role so it
// bypasses the Batch-1 status trigger; the dispatcher already verifyCommittee'd
// the request. Only a ZLTAC team (event_id) that is currently 'pending' can be
// reviewed; reject requires a non-empty reason, stored in rejection_reason.
async function handleTeamReview(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body ?? {}
  const { teamId, action } = body
  if (!isUuid(teamId)) return res.status(400).json({ error: 'A valid teamId is required' })
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: "action must be 'approve' or 'reject'" })
  }

  let update
  if (action === 'approve') {
    update = { status: 'approved', rejection_reason: null }
  } else {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return res.status(400).json({ error: 'A reason is required to reject a team.' })
    update = { status: 'rejected', rejection_reason: reason }
  }

  const { error: updErr } = await supabaseAdmin.rpc('committee_update_zltac_team', {
    p_actor_id: user.id,
    p_team_id: teamId,
    p_changes: update,
    p_mode: 'review',
  })
  if (updErr) return sendRosterMutationError(res, updErr, 'admin-team-review')

  return res.json({ ok: true, status: update.status })
}

// ── team-settings ───────────────────────────────────────────────────────────
// Committee edit of any ZLTAC team's settings. Runs on the service role, which
// is exempt from the Batch-1 team lock (enforce_zltac_team_lock), so locked
// teams (pending/approved) can still be edited here. Each field is validated
// and applied only when present in the body. Dispatcher already verifyCommittee'd.
async function handleTeamSettings(req, res, user) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body ?? {}
  const { teamId } = body
  if (!isUuid(teamId)) return res.status(400).json({ error: 'A valid teamId is required' })
  const unexpected = Object.keys(body).filter(key => !TEAM_SETTINGS_FIELDS.has(key))
  if (unexpected.length > 0) {
    return res.status(400).json({
      error: 'Team approval status must be changed through the dedicated review action.',
    })
  }

  const updates = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) return res.status(400).json({ error: 'Team name is required and must be 80 characters or fewer.' })
    updates.name = name
  }
  if ('state' in body) {
    const state = typeof body.state === 'string' ? body.state.trim() : ''
    if (!TEAM_STATES.has(state)) return res.status(400).json({ error: 'A valid team state is required.' })
    updates.state = state
  }
  if ('home_venue' in body) {
    const hv = typeof body.home_venue === 'string' ? body.home_venue.trim() : ''
    if (hv.length > 120) return res.status(400).json({ error: 'Home venue must be 120 characters or fewer.' })
    updates.home_venue = hv || null
  }
  if ('entry_type' in body) {
    if (body.entry_type != null && !TEAM_ENTRY_TYPES.has(body.entry_type)) {
      return res.status(400).json({ error: 'Invalid entry type.' })
    }
    updates.entry_type = body.entry_type || null
  }
  if ('format' in body) {
    if (!TEAM_FORMATS.has(body.format)) return res.status(400).json({ error: 'Invalid team format.' })
    updates.format = body.format
  }
  if ('colour' in body) {
    const colour = typeof body.colour === 'string' ? body.colour.trim() : ''
    if (colour && !/^#[0-9a-f]{6}$/i.test(colour)) return res.status(400).json({ error: 'Invalid team colour.' })
    updates.colour = colour || null
  }
  if ('logo_url' in body) {
    const logoUrl = typeof body.logo_url === 'string' ? body.logo_url.trim() : ''
    if (!isAllowedTeamLogoUrl(logoUrl, process.env.VITE_SUPABASE_URL)) {
      return res.status(400).json({ error: 'Invalid team logo URL.' })
    }
    updates.logo_url = logoUrl || null
  }
  if ('manager_id' in body) {
    if (body.manager_id && !isUuid(body.manager_id)) {
      return res.status(400).json({ error: 'A valid manager is required.' })
    }
    updates.manager_id = body.manager_id || null
  }
  if ('captain_id' in body) {
    if (!isUuid(body.captain_id)) return res.status(400).json({ error: 'A valid captain is required.' })
    updates.captain_id = body.captain_id
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields supplied.' })
  }

  const { data: updated, error: updErr } = await supabaseAdmin.rpc('committee_update_zltac_team', {
    p_actor_id: user.id,
    p_team_id: teamId,
    p_changes: updates,
    p_mode: 'settings',
  })
  if (updErr) return sendRosterMutationError(res, updErr, 'admin-team-settings')
  return res.json({ ok: true, team: updated })
}

function sanitizeEventPayload(raw, { eventId = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const payload = {}
  for (const [key, value] of Object.entries(raw)) {
    if (EVENT_WRITE_COLUMNS.has(key)) payload[key] = value
  }

  if (!payload.name || typeof payload.name !== 'string' || payload.name.trim().length > 120) {
    return { error: 'Event name is required and must be 120 characters or fewer.' }
  }
  payload.name = payload.name.trim()

  const year = Number(payload.year)
  if (!Number.isInteger(year) || year < 1999 || year > CURRENT_YEAR + 10) {
    return { error: 'A valid event year is required.' }
  }
  payload.year = year

  if (payload.status === 'archived') {
    return { error: 'Use the dedicated archive action to archive an event.' }
  }
  if (!EVENT_STATUSES.has(payload.status)) {
    return { error: 'A valid event status is required.' }
  }

  for (const [field, bucket] of [
    ['logo_url', 'event-logos'],
    ['cover_photo_url', 'event-covers'],
  ]) {
    if (!Object.hasOwn(payload, field)) continue
    const asset = canonicalAssetReference(payload[field], {
      bucket,
      scopeId: field === 'cover_photo_url' ? eventId : null,
    })
    if (asset.error) return { error: asset.error }
    payload[field] = asset.value
  }

  if (payload.photo_urls != null && (!Array.isArray(payload.photo_urls) || payload.photo_urls.length > 50)) {
    return { error: 'photo_urls must be an array of at most 50 items.' }
  }
  if (Array.isArray(payload.photo_urls)) {
    const photoUrls = []
    for (const value of payload.photo_urls) {
      const asset = canonicalAssetReference(value, { bucket: 'event-photos' })
      if (asset.error) return { error: asset.error }
      if (asset.value) photoUrls.push(asset.value)
    }
    payload.photo_urls = photoUrls
  }
  if (payload.side_events != null && !Array.isArray(payload.side_events)) {
    return { error: 'side_events must be an array.' }
  }

  for (const field of ['main_fee', 'team_fee', 'dinner_guest_price', 'max_teams', 'max_players', 'max_players_per_team']) {
    if (payload[field] != null && !Number.isInteger(Number(payload[field]))) {
      return { error: `${field} must be an integer.` }
    }
  }

  return { payload }
}

// ── under-18-approvals ─────────────────────────────────────────────────────
// Committee workflow for parental-consent approvals. Runs through the
// service-role API so browser clients do not perform cross-user profile reads
// or approval writes directly.
function parseApprovalYear(value) {
  const year = Number.parseInt(value, 10)
  if (!Number.isInteger(year) || year < 2000 || year > CURRENT_YEAR + 5) return null
  return year
}

function cleanApprovalNotes(value) {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 2000) : null
}

function singleRpcRecord(data) {
  return Array.isArray(data) ? (data[0] ?? null) : data
}

function sendUnder18RpcError(res, error, context) {
  const expected = {
    '22023': [400, 'Invalid under-18 approval request.'],
    '22P02': [400, 'Invalid under-18 approval request.'],
    '23503': [400, 'An eligible registration and active published under-18 form are required.'],
    '23514': [409, 'The under-18 approval conflicts with the current form or registration.'],
    '23505': [409, 'This player already has an approval record for that year.'],
    '40001': [409, 'The approval changed at the same time. Please try again.'],
    '40P01': [409, 'The approval changed at the same time. Please try again.'],
    '42501': [403, 'An active committee account is required.'],
    '55000': [409, 'This event cannot accept under-18 approval changes.'],
    'P0002': [404, 'Approval record or event not found.'],
  }
  const mapped = expected[error?.code]
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] })
  return sendServerError(res, error, context)
}

async function handleUnder18Approvals(req, res, user) {
  if (req.method === 'GET') {
    const yearFilter = req.query.year ?? DEFAULT_UNDER_18_YEAR
    const statusFilter = req.query.status ?? 'all'
    if (statusFilter !== 'all' && !UNDER_18_STATUSES.has(statusFilter)) {
      return res.status(400).json({ error: 'Invalid status filter' })
    }

    let approvalsQuery = supabaseAdmin
      .from('under_18_approvals')
      .select('id, user_id, event_year, status, submitted_at, approved_at, approved_by, notes, created_at, updated_at, player:profiles!user_id(first_name, last_name, alias), approver:profiles!approved_by(first_name, last_name, alias)')
      .order('event_year', { ascending: false })
      .order('created_at', { ascending: false })

    if (yearFilter !== 'all') {
      const year = parseApprovalYear(yearFilter)
      if (!year) return res.status(400).json({ error: 'Invalid event year' })
      approvalsQuery = approvalsQuery.eq('event_year', year)
    }
    if (statusFilter !== 'all') approvalsQuery = approvalsQuery.eq('status', statusFilter)

    const [{ data: rows, error: rowsErr }, { data: profiles, error: profilesErr }, { data: yearRows, error: yearsErr }] = await Promise.all([
      approvalsQuery,
      supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, alias')
        .order('first_name', { ascending: true }),
      supabaseAdmin
        .from('under_18_approvals')
        .select('event_year'),
    ])

    const err = rowsErr ?? profilesErr ?? yearsErr
    if (err) return sendServerError(res, err, 'admin:event:under-18-approvals:get')

    const years = Array
      .from(new Set([DEFAULT_UNDER_18_YEAR, CURRENT_YEAR, ...(yearRows ?? []).map(row => row.event_year)]))
      .filter(Boolean)
      .sort((a, b) => b - a)

    return res.json({ rows: rows ?? [], profiles: profiles ?? [], years })
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const userId = body.user_id
    const eventYear = parseApprovalYear(body.event_year)
    const status = typeof body.status === 'string' ? body.status : 'approved'

    if (!isUuid(userId)) return res.status(400).json({ error: 'user_id must be a valid UUID' })
    if (!eventYear) return res.status(400).json({ error: 'Invalid event year' })
    if (!UNDER_18_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' })

    const { data, error } = await supabaseAdmin.rpc(
      'committee_create_under_18_approval',
      {
        p_actor_id: user.id,
        p_user_id: userId,
        p_event_year: eventYear,
        p_status: status,
        p_notes: cleanApprovalNotes(body.notes),
      },
    )
    if (error) {
      return sendUnder18RpcError(
        res,
        error,
        'admin:event:under-18-approvals:create',
      )
    }
    const approval = singleRpcRecord(data)
    if (!isUuid(approval?.id)) {
      return sendServerError(
        res,
        new Error('Under-18 create RPC returned no approval'),
        'admin:event:under-18-approvals:create-result',
      )
    }
    return res.status(201).json({ ok: true, id: approval.id })
  }

  if (req.method === 'PATCH') {
    const body = req.body ?? {}
    const id = body.id
    const status = typeof body.status === 'string' ? body.status : null
    if (!isUuid(id)) return res.status(400).json({ error: 'id must be a valid UUID' })
    if (!UNDER_18_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' })

    const { data, error } = await supabaseAdmin.rpc(
      'committee_decide_under_18_approval',
      {
        p_actor_id: user.id,
        p_approval_id: id,
        p_status: status,
        p_notes: cleanApprovalNotes(body.notes),
      },
    )
    if (error) {
      return sendUnder18RpcError(
        res,
        error,
        'admin:event:under-18-approvals:update',
      )
    }
    if (!isUuid(singleRpcRecord(data)?.id)) {
      return sendServerError(
        res,
        new Error('Under-18 decision RPC returned no approval'),
        'admin:event:under-18-approvals:update-result',
      )
    }
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── team-roster ─────────────────────────────────────────────────────────────
// Committee add / remove / move of a player on a ZLTAC team. The database RPC
// keeps zltac_registrations and team_members synchronized in one transaction.
async function handleTeamRoster(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body ?? {}
  const { action, userId } = body
  const year = parseInt(body.year)
  if (action !== 'add' && action !== 'remove' && action !== 'move') {
    return res.status(400).json({ error: "action must be 'add', 'remove', or 'move'" })
  }
  if (!userId || !year) return res.status(400).json({ error: 'userId and year are required' })
  if (!isUuid(userId)) return res.status(400).json({ error: 'userId must be a valid UUID' })

  let newTeamId = null
  if (action === 'add' || action === 'move') {
    const { teamId } = body
    if (!teamId) return res.status(400).json({ error: 'teamId is required' })
    if (!isUuid(teamId)) return res.status(400).json({ error: 'teamId must be a valid UUID' })
    newTeamId = teamId
  }

  const { data, error } = await supabaseAdmin.rpc('committee_set_zltac_team_roster', {
    p_actor_id: user.id,
    p_user_id: userId,
    p_year: year,
    p_team_id: newTeamId,
  })
  if (error) {
    // The RPC owns roster validation and amount recomputation; map known
    // business-rule failures to client errors and keep surprises as 500s.
    const code = error.code
    const status = code === 'P0002' ? 404 : code === '22023' || code === '23503' || code === '23514' ? 400 : null
    if (status == null) return sendServerError(res, error, 'admin:event:team-roster')
    return res.status(status).json({ error: error.message })
  }

  return res.json({ ok: true, ...(data ?? {}) })
}

// ── required-documents ─────────────────────────────────────────────────────
// Committee reads and publication share this existing multiplexer so the app
// does not add another deployable serverless function. Publication accepts a
// binary body plus bounded metadata headers, validates and hashes the PDF on
// the server, uploads to a generated immutable path, then performs the database
// version switch in one service-only transaction.
async function reconcilePublishedLegalDocument(pdf) {
  try {
    const result = await supabaseAdmin.rpc(
      'reconcile_legal_document_publication',
      {
        p_document_type: pdf.documentType,
        p_file_path: pdf.objectPath,
        p_content_sha256: pdf.contentSha256,
        p_object_size: pdf.objectSize,
      },
    )
    return {
      data: singleRpcRecord(result?.data),
      error: result?.error ?? null,
    }
  } catch (error) {
    return { data: null, error }
  }
}

function sendPublishedLegalDocument(res, document) {
  return res.status(201).json({
    ok: true,
    document: {
      ...document,
      url: brandedLegalDocumentPath(document.file_path),
    },
  })
}

async function handleRequiredDocuments(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('legal_documents')
      .select([
        'id',
        'document_type',
        'version',
        'file_path',
        'original_filename',
        'effective_date',
        'uploaded_by',
        'uploaded_at',
        'is_active',
        'requires_reacceptance',
        'notes',
        'content_sha256',
        'object_size',
        'published_at',
        'uploader:profiles!uploaded_by(first_name, last_name, alias)',
      ].join(', '))
      .order('document_type', { ascending: true })
      .order('version', { ascending: false })

    if (error) return sendServerError(res, error, 'admin:required-documents:list')
    return res.json({
      documents: (data ?? []).map(document => ({
        ...document,
        url: document.published_at && document.is_active
          ? brandedLegalDocumentPath(document.file_path)
          : null,
      })),
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.query.action !== 'publish') {
    return res.status(400).json({ error: 'action must be "publish"' })
  }

  const inspection = inspectLegalPdfRequest(req)
  if (inspection.error) return res.status(400).json({ error: inspection.error })
  const pdf = inspection.value

  const storage = supabaseAdmin.storage.from(LEGAL_DOCUMENT_BUCKET)
  const { error: uploadError } = await storage.upload(pdf.objectPath, pdf.bytes, {
    contentType: 'application/pdf',
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadError) {
    return sendServerError(res, uploadError, 'admin:required-documents:upload')
  }

  let publishError = null
  try {
    const result = await supabaseAdmin.rpc(
      'publish_legal_document',
      {
        p_document_type: pdf.documentType,
        p_file_path: pdf.objectPath,
        p_original_filename: pdf.originalFilename,
        p_effective_date: pdf.effectiveDate,
        p_uploaded_by: user.id,
        p_requires_reacceptance: pdf.requiresReacceptance,
        p_notes: pdf.notes,
        p_content_sha256: pdf.contentSha256,
        p_object_size: pdf.objectSize,
      },
    )
    publishError = result?.error ?? null
  } catch (error) {
    publishError = error
  }

  // The RPC may commit even if its HTTP response is lost. Resolve the exact
  // immutable object identity before deciding whether storage is orphaned.
  const reconciliation = await reconcilePublishedLegalDocument(pdf)
  if (reconciliation.error) {
    captureServerException(
      reconciliation.error,
      'admin-required-documents-reconciliation',
    )
    return sendServerError(
      res,
      publishError ?? reconciliation.error,
      'admin:required-documents:reconcile',
    )
  }
  if (reconciliation.data?.id) {
    return sendPublishedLegalDocument(res, reconciliation.data)
  }

  if (publishError) {
    const { error: cleanupError } = await storage.remove([pdf.objectPath])
    if (cleanupError) {
      console.error('[admin:required-documents:cleanup]', cleanupError.message)
      captureServerException(cleanupError, 'admin-required-documents-cleanup')
    }
    return sendServerError(res, publishError, 'admin:required-documents:publish')
  }

  // A reported RPC success is never evidence that the object is safe to
  // remove. Leave it in place for operational reconciliation and fail closed.
  return sendServerError(
    res,
    new Error('Published required document could not be reloaded'),
    'admin:required-documents:publish-result',
  )
}

async function handleAssetUpload(req, res, user) {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const action = req.body?.action ?? 'issue'
  if (!['issue', 'finalize'].includes(action)) {
    return res.status(400).json({ error: 'Asset upload action is invalid.' })
  }

  const inspection = inspectAssetUploadRequest(req.body, {
    allowedPurposes: COMMITTEE_ASSET_PURPOSES,
    actorId: user.id,
  })
  if (inspection.error) return res.status(400).json({ error: inspection.error })

  const { purpose } = inspection.data
  const scopeId = req.body?.scopeId || null
  const target = purpose.startsWith('event-')
    ? { table: 'zltac_events', columns: 'id, status' }
    : purpose.startsWith('history-')
      ? { table: 'zltac_event_history', columns: 'id' }
      : scopeId
        ? { table: 'referee_questions', columns: 'id' }
        : null
  if (target) {
    const { data, error } = await supabaseAdmin
      .from(target.table)
      .select(target.columns)
      .eq('id', scopeId)
      .maybeSingle()
    if (error) return sendServerError(res, error, 'admin:asset-upload:target')
    if (!data) return res.status(404).json({ error: 'Upload target was not found.' })
    if (data.status === 'archived') {
      return res.status(409).json({ error: 'Archived events cannot accept new uploads.' })
    }
  }

  const operation = action === 'finalize'
    ? finalizeSignedAssetUpload
    : issueSignedAssetUpload
  const result = await operation({
    supabase: supabaseAdmin,
    input: req.body,
    allowedPurposes: COMMITTEE_ASSET_PURPOSES,
    actorId: user.id,
  })
  if (result.error) return res.status(400).json({ error: result.error })
  if (result.serviceError) {
    return sendServerError(res, result.serviceError, 'admin:asset-upload:authorise')
  }

  res.setHeader?.('Cache-Control', 'no-store')
  return res.status(201).json(result.data)
}

export default async function handler(req, res) {
  const resource = req.query.resource

  // Vercel cron invokes configured paths with GET. Keep that path completely
  // separate from the committee-only POST used by the manual backup button.
  if (resource === 'backup-run' && req.method === 'GET') {
    if (!process.env.CRON_SECRET) {
      return res.status(503).json({ error: 'Backup cron is not configured.' })
    }
    if (!isCronRequest(req)) {
      return res.status(401).json({ error: 'Invalid cron credentials.' })
    }
    if (!await enforceRateLimit(req, res, {
      identifier: 'cron-backup-run',
      limit: 2,
      window: '1 d',
      prefix: 'cron-backup-run',
      requireDistributed: true,
    })) return
    return handleBackupRun(req, res, { enforceSchedule: true, triggeredBy: null })
  }

  const { user, error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const rateConfig = resource === 'backup-run'
    ? { limit: 2, window: '1 h', prefix: 'admin-backup-run' }
    : resource === 'profile-search'
      ? { limit: 60, window: '1 m', prefix: 'admin-profile-search' }
      : resource === 'asset-upload'
        ? { limit: 30, window: '1 m', prefix: 'admin-asset-upload' }
      : resource === 'required-documents' && req.method === 'POST'
        ? { limit: 20, window: '1 m', prefix: 'admin-event' }
        : { limit: 120, window: '1 m', prefix: 'admin-event' }
  if (!await enforceRateLimit(req, res, {
    identifier: resource === 'backup-run' ? GLOBAL_BACKUP_RATE_LIMIT_IDENTIFIER : user.id,
    requireDistributed: true,
    ...rateConfig,
  })) return

  if (resource === 'event')            return handleEvent(req, res, user)
  if (resource === 'event-delete-impact') return handleEventDeleteImpact(req, res)
  if (resource === 'registrations')    return handleRegistrations(req, res, user)
  if (resource === 'payments')         return handlePayments(req, res, user)
  if (resource === 'backup-settings')  return handleBackupSettings(req, res, user)
  if (resource === 'backup-run')       return handleBackupRun(req, res, { enforceSchedule: false, triggeredBy: user.id })
  if (resource === 'profile-search')   return handleProfileSearch(req, res)
  if (resource === 'zltac-dashboard')  return handleZltacDashboard(req, res)
  if (resource === 'portal-dashboard') return handlePortalDashboard(req, res)
  if (resource === 'signed-documents') return handleSignedDocuments(req, res)
  if (resource === 'team-review')      return handleTeamReview(req, res, user)
  if (resource === 'team-settings')    return handleTeamSettings(req, res, user)
  if (resource === 'team-roster')      return handleTeamRoster(req, res, user)
  if (resource === 'under-18-approvals') return handleUnder18Approvals(req, res, user)
  if (resource === 'required-documents') return handleRequiredDocuments(req, res, user)
  if (resource === 'asset-upload')      return handleAssetUpload(req, res, user)
  if (['document-content', 'history-content', 'referee-content', 'site-banner'].includes(resource)) {
    return handleAdminContent(req, res, { user, supabase: supabaseAdmin, resource })
  }
  return res.status(400).json({ error: 'Unknown or missing resource query parameter.' })
}
