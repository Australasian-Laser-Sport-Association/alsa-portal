// Shared backup CSV generator. Consumed by the cron handler at
// /api/admin/event?resource=backup-run AND by the "Run backup now" admin
// button. Returns three CSV strings plus row counts so the email body can
// summarise without re-counting.
//
// Conventions:
//   - UTF-8 BOM (U+FEFF) prepended to every CSV. Excel mangles non-ASCII
//     player names without it; Google Sheets is fine either way.
//   - CRLF line endings (RFC 4180).
//   - Empty arrays / NULL / undefined → empty cell (not the literal "null"
//     or "[]"). Recipients pasting into Sheets see blank cells.
//   - Array fields use ";" as the in-cell separator (side_events,
//     triples_partner_aliases, photo_urls). Avoids extra quote-escaping
//     because "," is the CSV column delimiter.
//   - Money fields export BOTH integer cents (storage fidelity, for re-
//     import) AND dollar-formatted strings (human-readable, for the
//     "run-the-tournament-from-Sheets" recovery mode).
//   - Sort: registrations by event_year DESC then alias ASC; payments by
//     recorded_at DESC; events by year DESC.
//
// The function takes a Supabase client (service-role expected so RLS does
// not interfere); it does not couple to any particular client instance.

const BOM = '﻿'

// RFC 4180-ish CSV escape. Empty / null / undefined → empty string;
// values containing comma, quote, CR, or LF get wrapped in double quotes
// with internal quotes doubled.
function csvCell(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells) {
  return cells.map(csvCell).join(',')
}

function centsToDollars(cents) {
  if (cents === null || cents === undefined) return ''
  return (Number(cents) / 100).toFixed(2)
}

function fullName(profile) {
  if (!profile) return ''
  return [profile.first_name, profile.last_name].filter(Boolean).join(' ')
}

// "Under 18 on July 1 of the event year" — mirrors CaptainHub.isUnder18 so
// the same player gets the same category on both surfaces. Returns
// 'Junior' / 'Senior' / '' when dob is missing or unparseable.
function ageCategory(dob, eventYear) {
  if (!dob || !eventYear) return ''
  const eighteenth = new Date(dob)
  if (Number.isNaN(eighteenth.getTime())) return ''
  eighteenth.setFullYear(eighteenth.getFullYear() + 18)
  const cutoff = new Date(`${eventYear}-07-01`)
  return eighteenth > cutoff ? 'Junior' : 'Senior'
}

// Same derivation as CaptainHub.derivePaymentStatus; one place that owns
// the rule so the registrations CSV agrees with what the player sees.
function paymentStatus(amountOwingCents, totalPaidCents) {
  const owing = amountOwingCents ?? 0
  const paid = totalPaidCents ?? 0
  const balance = owing - paid
  if (balance < 0) return 'overpaid'
  if (balance === 0) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

export async function generateBackupCsvs(supabase) {
  // 1. Pull everything in parallel. Each query is unscoped: backups
  //    intentionally include archived events + cancelled registrations
  //    so the snapshot is a true restore point.
  const [
    eventsRes,
    registrationsRes,
    teamsRes,
    profilesRes,
    paymentRecordsRes,
    doublesRes,
    triplesRes,
  ] = await Promise.all([
    supabase.from('zltac_events').select('*'),
    supabase.from('zltac_registrations').select('*'),
    supabase.from('teams').select('id, name, captain_id'),
    supabase.from('profiles')
      .select('id, first_name, last_name, alias, dob, phone, state, placeholder_email, is_placeholder'),
    supabase.from('payment_records')
      .select('id, registration_id, amount, recorded_at, recorded_by, bank_reference, notes'),
    supabase.from('doubles_pairs').select('event_year, player1_id, player2_id'),
    supabase.from('triples_teams').select('event_year, player1_id, player2_id, player3_id'),
  ])

  const firstErr = [eventsRes, registrationsRes, teamsRes, profilesRes, paymentRecordsRes, doublesRes, triplesRes]
    .map(r => r.error)
    .find(Boolean)
  if (firstErr) throw new Error(`Backup query failed: ${firstErr.message}`)

  const events = eventsRes.data ?? []
  const registrations = registrationsRes.data ?? []
  const teams = teamsRes.data ?? []
  const profiles = profilesRes.data ?? []
  const paymentRecords = paymentRecordsRes.data ?? []
  const doublesPairs = doublesRes.data ?? []
  const triplesTeams = triplesRes.data ?? []

  // 2. Lookup indexes.
  const eventByYear = new Map(events.map(e => [e.year, e]))
  const teamById = new Map(teams.map(t => [t.id, t]))
  const profileById = new Map(profiles.map(p => [p.id, p]))
  const regById = new Map(registrations.map(r => [r.id, r]))

  // 3. Payment aggregates per registration.
  const totalPaidByReg = new Map()
  for (const p of paymentRecords) {
    totalPaidByReg.set(p.registration_id, (totalPaidByReg.get(p.registration_id) ?? 0) + (p.amount ?? 0))
  }

  // 4. Partner indexes keyed by `${year}::${user_id}`.
  const doublesPartnerByKey = new Map()
  for (const d of doublesPairs) {
    if (d.player1_id) doublesPartnerByKey.set(`${d.event_year}::${d.player1_id}`, d.player2_id)
    if (d.player2_id) doublesPartnerByKey.set(`${d.event_year}::${d.player2_id}`, d.player1_id)
  }
  const triplesPartnersByKey = new Map() // key → [otherPlayerId, ...]
  for (const t of triplesTeams) {
    const ids = [t.player1_id, t.player2_id, t.player3_id].filter(Boolean)
    for (const me of ids) {
      triplesPartnersByKey.set(`${t.event_year}::${me}`, ids.filter(id => id !== me))
    }
  }

  // 5. Auth email lookup. auth.users.email lives outside RLS-managed
  //    tables, so each user_id needs its own admin.getUserById call. We
  //    fan out in parallel — same pattern handleCompetitionRegistrations
  //    and api/admin/volunteers use. Placeholder profiles (no auth row)
  //    fall back to profiles.placeholder_email.
  const userIdsNeeded = new Set([
    ...registrations.map(r => r.user_id),
    ...paymentRecords.map(p => p.recorded_by).filter(Boolean),
  ])
  const emailByAuthId = new Map()
  await Promise.all([...userIdsNeeded].map(async uid => {
    try {
      const { data } = await supabase.auth.admin.getUserById(uid)
      if (data?.user?.email) emailByAuthId.set(uid, data.user.email)
    } catch {
      // No auth row (placeholder) — handled by resolveEmail() below.
    }
  }))

  function resolveEmail(userId) {
    if (!userId) return ''
    const fromAuth = emailByAuthId.get(userId)
    if (fromAuth) return fromAuth
    return profileById.get(userId)?.placeholder_email ?? ''
  }

  // 6. Registrations CSV ----------------------------------------------------
  const registrationsHeader = [
    'event_year', 'event_name', 'registration_id',
    'full_name', 'alias', 'email', 'phone', 'dob', 'age_category', 'state',
    'team_id', 'team_name', 'team_role',
    'doubles_partner_alias', 'triples_partner_aliases',
    'side_events', 'dinner_guests',
    'status',
    'emergency_contact_name', 'emergency_contact_phone',
    'payment_reference',
    'amount_owing_cents', 'amount_owing_dollars',
    'total_paid_cents', 'total_paid_dollars',
    'outstanding_balance_cents', 'outstanding_balance_dollars',
    'payment_status',
    'admin_override_coc', 'admin_override_media', 'admin_override_ref_test', 'admin_override_u18',
    'admin_note',
    'registered_at',
  ]

  const registrationRows = registrations.map(reg => {
    const profile = profileById.get(reg.user_id) ?? {}
    const event = eventByYear.get(reg.year)
    const team = reg.team_id ? teamById.get(reg.team_id) : null
    const teamRole = team
      ? (team.captain_id === reg.user_id ? 'captain' : 'player')
      : ''

    const doublesPartnerId = doublesPartnerByKey.get(`${reg.year}::${reg.user_id}`)
    const doublesPartnerAlias = doublesPartnerId
      ? (profileById.get(doublesPartnerId)?.alias ?? '')
      : ''

    const triplesPartnerIds = triplesPartnersByKey.get(`${reg.year}::${reg.user_id}`) ?? []
    const triplesPartnerAliases = triplesPartnerIds
      .map(id => profileById.get(id)?.alias ?? '')
      .filter(Boolean)
      .join(';')

    const sideEvents = Array.isArray(reg.side_events) ? reg.side_events.join(';') : ''

    const owing = reg.amount_owing ?? 0
    const paid = totalPaidByReg.get(reg.id) ?? 0
    const balance = owing - paid

    return [
      reg.year,
      event?.name ?? '',
      reg.id,
      fullName(profile),
      profile.alias ?? '',
      resolveEmail(reg.user_id),
      profile.phone ?? '',
      profile.dob ?? '',
      ageCategory(profile.dob, reg.year),
      profile.state ?? '',
      reg.team_id ?? '',
      team?.name ?? '',
      teamRole,
      doublesPartnerAlias,
      triplesPartnerAliases,
      sideEvents,
      reg.dinner_guests ?? 0,
      reg.status ?? '',
      reg.emergency_contact_name ?? '',
      reg.emergency_contact_phone ?? '',
      reg.payment_reference ?? '',
      owing,
      centsToDollars(owing),
      paid,
      centsToDollars(paid),
      balance,
      centsToDollars(balance),
      paymentStatus(owing, paid),
      reg.admin_override_coc ?? false,
      reg.admin_override_media ?? false,
      reg.admin_override_ref_test ?? false,
      reg.admin_override_u18 ?? false,
      reg.admin_note ?? '',
      reg.created_at ?? '',
    ]
  })

  // Sort: event_year DESC, alias ASC (case-insensitive).
  registrationRows.sort((a, b) => {
    const yearDiff = (b[0] ?? 0) - (a[0] ?? 0)
    if (yearDiff !== 0) return yearDiff
    return (a[4] ?? '').toLowerCase().localeCompare((b[4] ?? '').toLowerCase())
  })

  const registrationsCsv = BOM
    + [csvRow(registrationsHeader), ...registrationRows.map(csvRow)].join('\r\n')

  // 7. Payments CSV --------------------------------------------------------
  const paymentsHeader = [
    'event_year', 'event_name', 'payment_record_id', 'registration_id',
    'player_alias', 'player_full_name',
    'amount_cents', 'amount_dollars',
    'recorded_at', 'recorded_by_email',
    'bank_reference', 'notes',
  ]

  const paymentRows = paymentRecords.map(p => {
    const reg = regById.get(p.registration_id)
    const profile = reg ? profileById.get(reg.user_id) : null
    const event = reg ? eventByYear.get(reg.year) : null
    return [
      reg?.year ?? '',
      event?.name ?? '',
      p.id,
      p.registration_id,
      profile?.alias ?? '',
      fullName(profile),
      p.amount ?? '',
      centsToDollars(p.amount),
      p.recorded_at ?? '',
      resolveEmail(p.recorded_by),
      p.bank_reference ?? '',
      p.notes ?? '',
    ]
  })

  // Sort: recorded_at DESC. Treat missing timestamps as 0 so they sink.
  paymentRows.sort((a, b) => {
    const ta = a[8] ? new Date(a[8]).getTime() : 0
    const tb = b[8] ? new Date(b[8]).getTime() : 0
    return tb - ta
  })

  const paymentsCsv = BOM
    + [csvRow(paymentsHeader), ...paymentRows.map(csvRow)].join('\r\n')

  // 8. Events CSV ----------------------------------------------------------
  const eventsHeader = [
    'year', 'name', 'status', 'location', 'venue', 'start_date', 'end_date',
    'event_starts_at', 'timezone',
    'reg_open_date', 'reg_close_date',
    'description', 'hero_text',
    'logo_url', 'cover_photo_url', 'photo_urls',
    'main_fee_cents', 'main_fee_dollars',
    'team_fee_cents', 'team_fee_dollars',
    'dinner_guest_price_cents', 'dinner_guest_price_dollars',
    'processing_fee_pct',
    'side_events_json',
    'require_coc', 'require_ref_test', 'require_payment', 'payments_override',
    'max_teams', 'max_players', 'max_players_per_team',
    'allow_side_events_only', 'enable_waitlist',
    'bank_bsb', 'bank_account_number', 'bank_account_name',
    'committee_email',
    'created_at', 'updated_at',
  ]

  const eventRows = events.map(e => [
    e.year,
    e.name ?? '',
    e.status ?? '',
    e.location ?? '',
    e.venue ?? '',
    e.start_date ?? '',
    e.end_date ?? '',
    e.event_starts_at ?? '',
    e.timezone ?? '',
    e.reg_open_date ?? '',
    e.reg_close_date ?? '',
    e.description ?? '',
    e.hero_text ?? '',
    e.logo_url ?? '',
    e.cover_photo_url ?? '',
    Array.isArray(e.photo_urls) ? e.photo_urls.join(';') : '',
    e.main_fee ?? '',
    centsToDollars(e.main_fee),
    e.team_fee ?? '',
    centsToDollars(e.team_fee),
    e.dinner_guest_price ?? '',
    centsToDollars(e.dinner_guest_price),
    e.processing_fee_pct ?? '',
    e.side_events == null ? '' : JSON.stringify(e.side_events),
    e.require_coc ?? false,
    e.require_ref_test ?? false,
    e.require_payment ?? false,
    e.payments_override ?? '',
    e.max_teams ?? '',
    e.max_players ?? '',
    e.max_players_per_team ?? '',
    e.allow_side_events_only ?? false,
    e.enable_waitlist ?? false,
    e.bank_bsb ?? '',
    e.bank_account_number ?? '',
    e.bank_account_name ?? '',
    e.committee_email ?? '',
    e.created_at ?? '',
    e.updated_at ?? '',
  ])

  // Sort: year DESC.
  eventRows.sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0))

  const eventsCsv = BOM
    + [csvRow(eventsHeader), ...eventRows.map(csvRow)].join('\r\n')

  // 9. Per-event breakdown for the email body. Counts registrations grouped
  //    by year; only events that actually have registrations get listed.
  //    Sorted year DESC to match the events CSV order.
  const regCountByYear = new Map()
  for (const r of registrations) {
    regCountByYear.set(r.year, (regCountByYear.get(r.year) ?? 0) + 1)
  }
  const eventBreakdown = [...regCountByYear.entries()]
    .map(([year, count]) => ({
      year,
      name: eventByYear.get(year)?.name ?? '',
      registrationCount: count,
    }))
    .sort((a, b) => b.year - a.year)

  return {
    registrationsCsv,
    paymentsCsv,
    eventsCsv,
    registrationsCount: registrationRows.length,
    paymentsCount: paymentRows.length,
    eventsCount: eventRows.length,
    eventBreakdown,
  }
}
