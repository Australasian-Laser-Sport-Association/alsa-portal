import supabaseAdmin from './supabase.js'
import { registrationDateOfBirth, under18Requirement } from '../../src/lib/dateOfBirth.js'
import { calculateZltacReadiness } from './zltacReadiness.js'

const EVENT_COLUMNS = [
  'id',
  'name',
  'year',
  'status',
  'start_date',
  'event_starts_at',
  'timezone',
  'require_coc',
  'require_ref_test',
  'require_payment',
  'allow_side_events_only',
].join(', ')

const REGISTRATION_COLUMNS = [
  'id',
  'user_id',
  'team_id',
  'year',
  'status',
  'side_events',
  'has_confirmed_side_events',
  'has_confirmed_extras',
  'amount_owing',
  'dob_at_registration',
  'admin_override_coc',
  'admin_override_coc_set_by',
  'admin_override_coc_set_at',
  'admin_override_coc_reason',
  'admin_override_media',
  'admin_override_media_set_by',
  'admin_override_media_set_at',
  'admin_override_media_reason',
  'admin_override_ref_test',
  'admin_override_ref_test_set_by',
  'admin_override_ref_test_set_at',
  'admin_override_ref_test_reason',
  'admin_override_u18',
  'admin_override_u18_set_by',
  'admin_override_u18_set_at',
  'admin_override_u18_reason',
  'teams(id, event_id, status)',
].join(', ')

function dataError(context, error) {
  const wrapped = new Error(`${context}: ${error?.message ?? 'query failed'}`)
  wrapped.code = error?.code
  wrapped.cause = error
  return wrapped
}

function requireData(result, context) {
  if (result.error) throw dataError(context, result.error)
  return result.data
}

function joinedDocument(row) {
  return Array.isArray(row?.document) ? (row.document[0] ?? null) : (row?.document ?? null)
}

function joinedTeam(row) {
  return Array.isArray(row?.teams) ? (row.teams[0] ?? null) : (row?.teams ?? null)
}

function override(registration, prefix) {
  return {
    value: registration?.[`admin_override_${prefix}`] ?? null,
    setBy: registration?.[`admin_override_${prefix}_set_by`] ?? null,
    setAt: registration?.[`admin_override_${prefix}_set_at`] ?? null,
    reason: registration?.[`admin_override_${prefix}_reason`] ?? null,
  }
}

function rosterConfirmed(registration, doubles, triples) {
  const selected = new Set(registration?.side_events ?? [])
  const userId = registration?.user_id
  if (!userId) return false

  if (selected.has('doubles')) {
    const pair = doubles.find(row => row.player1_id === userId || row.player2_id === userId)
    if (pair?.confirmed !== true) return false
  }
  if (selected.has('triples')) {
    const team = triples.find(row => (
      row.player1_id === userId || row.player2_id === userId || row.player3_id === userId
    ))
    if (team?.confirmed !== true) return false
  }
  return true
}

/**
 * Pure data-to-readiness adapter. Database callers must pass only registrations
 * from the event in `event`; this function additionally filters by year so a
 * historic row can never populate the current annual readiness map.
 */
export function assembleZltacReadiness({
  event,
  userIds,
  registrations = [],
  documents = [],
  acceptances = [],
  refereeResults = [],
  under18Approvals = [],
  paymentRecords = [],
  doubles = [],
  triples = [],
  profiles = [],
}) {
  const scopedRegistrations = registrations.filter(row => row.year === event.year)
  const registrationsByUser = Object.fromEntries(scopedRegistrations.map(row => [row.user_id, row]))
  const refereeByUser = Object.fromEntries(refereeResults.map(row => [row.user_id, row]))
  const under18ByUser = Object.fromEntries(under18Approvals.map(row => [row.user_id, row]))
  const profilesByUser = Object.fromEntries(profiles.map(row => [row.id, row]))

  const activeDocuments = {}
  for (const document of [...documents].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))) {
    const published = document?.is_active === true
      && !!document.published_at
      && !!document.content_sha256
      && document.object_size != null
    if (published && !activeDocuments[document.document_type]) {
      activeDocuments[document.document_type] = document
    }
  }

  const acceptanceByUserAndType = {}
  for (const acceptance of acceptances) {
    if (acceptance.event_year !== event.year) continue
    const document = joinedDocument(acceptance)
    const type = document?.document_type
    if (!type) continue
    const key = `${acceptance.user_id}:${type}`
    if (!acceptanceByUserAndType[key]) {
      acceptanceByUserAndType[key] = { ...acceptance, document }
    }
  }

  const paidByRegistration = {}
  for (const payment of paymentRecords) {
    if (!payment.registration_id || !Number.isInteger(payment.amount)) continue
    paidByRegistration[payment.registration_id] = (
      paidByRegistration[payment.registration_id] ?? 0
    ) + payment.amount
  }

  const readinessByUser = {}
  for (const userId of userIds) {
    const registration = registrationsByUser[userId] ?? null
    const profile = profilesByUser[userId] ?? null
    const ageRequirement = under18Requirement({
      dob: registrationDateOfBirth(registration, null),
      eventStartsAt: event.event_starts_at,
      startDate: event.start_date,
      timezone: event.timezone,
    })
    const team = joinedTeam(registration)

    readinessByUser[userId] = calculateZltacReadiness({
      event: {
        requireCodeOfConduct: event.require_coc !== false,
        requireMediaRelease: true,
        requireRefereeTest: event.require_ref_test !== false,
        requirePayment: event.require_payment !== false,
        requireSideEventConfirmation: true,
        requireExtrasConfirmation: true,
      },
      registration,
      identity: {
        valid: !!registration
          && !!profile
          && profile.suspended !== true
          && ageRequirement.status !== 'blocked',
        reason: !registration
          ? 'registration_missing'
          : !profile
            ? 'profile_missing'
            : profile.suspended === true
              ? 'account_suspended'
              : ageRequirement.reason,
      },
      team: {
        id: registration?.team_id ?? null,
        status: team?.status ?? null,
        required: event.allow_side_events_only !== true,
      },
      documents: {
        codeOfConduct: activeDocuments.code_of_conduct ?? null,
        mediaRelease: activeDocuments.media_release ?? null,
        under18Form: activeDocuments.under_18_form ?? null,
      },
      acceptances: {
        codeOfConduct: acceptanceByUserAndType[`${userId}:code_of_conduct`] ?? null,
        mediaRelease: acceptanceByUserAndType[`${userId}:media_release`] ?? null,
      },
      refereeTest: refereeByUser[userId] ?? null,
      sideEvents: {
        partnerRostersConfirmed: rosterConfirmed(registration, doubles, triples),
      },
      under18: {
        requirement: ageRequirement.status,
        approval: under18ByUser[userId] ?? null,
      },
      payment: {
        amountPaidCents: registration ? (paidByRegistration[registration.id] ?? 0) : 0,
      },
      overrides: {
        codeOfConduct: override(registration, 'coc'),
        mediaRelease: override(registration, 'media'),
        refereeTest: override(registration, 'ref_test'),
        under18: override(registration, 'u18'),
      },
    })
  }

  return readinessByUser
}

/**
 * Shared privileged loader for player, captain, and (later) committee views.
 * Supplying registrations avoids a second read after the caller has already
 * established its own exact ownership/scope boundary.
 */
export async function getZltacReadinessForUsers({ event, userIds, registrations: supplied }) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
  if (uniqueUserIds.length === 0) return {}

  const registrations = supplied ?? requireData(await supabaseAdmin
    .from('zltac_registrations')
    .select(REGISTRATION_COLUMNS)
    .eq('year', event.year)
    .in('user_id', uniqueUserIds), 'readiness registrations') ?? []

  const registrationIds = registrations.map(row => row.id).filter(Boolean)
  const [documentsResult, acceptancesResult, refereeResult, under18Result, paymentsResult, doublesResult, triplesResult, profilesResult] = await Promise.all([
    supabaseAdmin
      .from('legal_documents')
      .select('id, document_type, version, is_active, requires_reacceptance, published_at, content_sha256, object_size')
      .eq('is_active', true)
      .not('published_at', 'is', null)
      .not('content_sha256', 'is', null)
      .not('object_size', 'is', null)
      .in('document_type', ['code_of_conduct', 'media_release', 'under_18_form'])
      .order('version', { ascending: false }),
    supabaseAdmin
      .from('legal_acceptances')
      .select('user_id, document_id, event_year, accepted_at, content_sha256, document:legal_documents!document_id(id, document_type, version, requires_reacceptance, content_sha256)')
      .eq('event_year', event.year)
      .in('user_id', uniqueUserIds)
      .order('accepted_at', { ascending: false }),
    supabaseAdmin
      .from('referee_test_results')
      .select('user_id, passed, score, safety_correct, safety_total, general_correct, general_total, taken_at')
      .in('user_id', uniqueUserIds),
    supabaseAdmin
      .from('under_18_approvals')
      .select('user_id, event_year, status, submitted_at, approved_at, document_id')
      .eq('event_year', event.year)
      .in('user_id', uniqueUserIds),
    registrationIds.length > 0
      ? supabaseAdmin.from('payment_records').select('registration_id, amount').in('registration_id', registrationIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from('doubles_pairs')
      .select('player1_id, player2_id, confirmed')
      .eq('event_year', event.year),
    supabaseAdmin
      .from('triples_teams')
      .select('player1_id, player2_id, player3_id, confirmed')
      .eq('event_year', event.year),
    supabaseAdmin
      .from('profiles')
      .select('id, suspended')
      .in('id', uniqueUserIds),
  ])

  return assembleZltacReadiness({
    event,
    userIds: uniqueUserIds,
    registrations,
    documents: requireData(documentsResult, 'readiness documents') ?? [],
    acceptances: requireData(acceptancesResult, 'readiness acceptances') ?? [],
    refereeResults: requireData(refereeResult, 'readiness referee results') ?? [],
    under18Approvals: requireData(under18Result, 'readiness under-18 approvals') ?? [],
    paymentRecords: requireData(paymentsResult, 'readiness payments') ?? [],
    doubles: requireData(doublesResult, 'readiness doubles') ?? [],
    triples: requireData(triplesResult, 'readiness triples') ?? [],
    profiles: requireData(profilesResult, 'readiness profiles') ?? [],
  })
}

export async function getPlayerCurrentZltacReadiness(userId) {
  const event = requireData(await supabaseAdmin
    .from('zltac_events')
    .select(EVENT_COLUMNS)
    .eq('status', 'open')
    .maybeSingle(), 'current ZLTAC event')

  if (!event) return { event: null, readiness: null }
  const readinessByUser = await getZltacReadinessForUsers({ event, userIds: [userId] })
  return { event, readiness: readinessByUser[userId] }
}

export async function getCaptainCurrentTeamReadiness({ captainId, teamId, eventId }) {
  const event = requireData(await supabaseAdmin
    .from('zltac_events')
    .select(EVENT_COLUMNS)
    .eq('id', eventId)
    .eq('status', 'open')
    .maybeSingle(), 'captain readiness event')
  if (!event) return null

  const team = requireData(await supabaseAdmin
    .from('teams')
    .select('id, event_id, captain_id, status')
    .eq('id', teamId)
    .eq('event_id', event.id)
    .eq('captain_id', captainId)
    .maybeSingle(), 'captain readiness team')
  if (!team) return null

  const registrations = requireData(await supabaseAdmin
    .from('zltac_registrations')
    .select(REGISTRATION_COLUMNS)
    .eq('year', event.year)
    .eq('team_id', team.id), 'captain readiness roster') ?? []
  const userIds = registrations.map(row => row.user_id).filter(Boolean)
  const readinessByUser = await getZltacReadinessForUsers({ event, userIds, registrations })

  return { event, team, registrations, readinessByUser }
}

export { EVENT_COLUMNS, REGISTRATION_COLUMNS }
