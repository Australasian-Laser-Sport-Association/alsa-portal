import supabaseAdmin from './_lib/supabase.js'

// Consolidated public-read endpoint. Dispatches by ?resource=:
//   ?resource=event&year=YYYY → confirmed doubles/triples pairs for an event
//   ?resource=committee       → ALSA + ZLTAC committee members
//   ?resource=members         → current ALSA membership period + member list
//   ?resource=competitions    → pre-nationals listings (list or single by slug)
//
// All resources are GET, all public (no auth). Consolidated from
// api/event.js + api/committee.js + api/members.js to stay under the
// Vercel Hobby function cap.

// Columns that anon callers see for a competition. bank_account_name,
// bank_bsb, bank_account_number are deliberately stripped — those only ever
// appear in the authenticated registration flow (Phase 3c). Matches the
// defence-in-depth model: the RLS policy from 20260527000000 admits the row,
// the API enforces the column filter so anon never sees bank details even via
// this endpoint.
const PUBLIC_COMPETITION_COLUMNS =
  'id, slug, name, start_date, end_date, registration_open_at, registration_close_at, price_per_player, payment_info_visible'

// Columns shown on the public ZLTAC card. Mirrors the displayable surface of
// the zltac_events row without exposing fees or admin metadata.
const PUBLIC_ZLTAC_COLUMNS =
  'id, year, name, status, location, venue, start_date, end_date, logo_url, reg_open_date, reg_close_date'

// ── event ───────────────────────────────────────────────────────────────────

async function handleEvent(req, res) {
  const year = parseInt(req.query.year)
  if (!year) return res.status(400).json({ error: 'year is required' })

  const [{ data: doubles, error: e1 }, { data: triples, error: e2 }] = await Promise.all([
    supabaseAdmin.from('doubles_pairs').select('id, event_year, player1_id, player2_id, confirmed').eq('event_year', year).eq('confirmed', true),
   supabaseAdmin.from('triples_teams').select('id, event_year, player1_id, player2_id, player3_id, confirmed').eq('event_year', year).eq('confirmed', true),
  ])

  if (e1 || e2) return res.status(500).json({ error: (e1 ?? e2).message })
  return res.json({ doubles: doubles ?? [], triples: triples ?? [] })
}

// ── committee ───────────────────────────────────────────────────────────────

async function handleCommittee(_req, res) {
  const [{ data: alsaData, error: alsaErr }, { data: zltacData, error: zltacErr }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, alias, avatar_url, alsa_position, roles')
      .contains('roles', ['alsa_committee']),
    supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, alias, avatar_url, roles')
      .contains('roles', ['zltac_committee']),
  ])

  if (alsaErr || zltacErr) {
    return res.status(500).json({ error: (alsaErr ?? zltacErr).message })
  }

  const sortFn = (a, b) =>
    (a.alias ?? a.first_name ?? '').localeCompare(b.alias ?? b.first_name ?? '')

  return res.json({
    alsa: (alsaData ?? []).slice().sort(sortFn),
    zltac: (zltacData ?? []).slice().sort(sortFn),
  })
}

// ── members ─────────────────────────────────────────────────────────────────

async function handleMembers(_req, res) {
  const today = new Date().toISOString().slice(0, 10)

  const { data: period, error: periodErr } = await supabaseAdmin
    .from('alsa_membership_periods')
    .select('id, label, starts_at, ends_at')
    .lte('starts_at', today)
    .gt('ends_at', today)
    .maybeSingle()

  if (periodErr) return res.status(500).json({ error: periodErr.message })

  if (!period) return res.json({ current_period: null, members: [] })

  const { data: memberships, error: membershipsErr } = await supabaseAdmin
    .from('alsa_memberships')
    .select('profile_id, profiles:profile_id (id, first_name, last_name, alias, avatar_url)')
    .eq('period_id', period.id)

  if (membershipsErr) return res.status(500).json({ error: membershipsErr.message })

  const members = (memberships ?? [])
    .map(m => m.profiles)
    .filter(Boolean)
    .sort((a, b) => (a.alias ?? a.first_name ?? '').localeCompare(b.alias ?? b.first_name ?? ''))

  return res.json({ current_period: period, members })
}

// ── competitions ────────────────────────────────────────────────────────────
// Anon-facing public listings. Two modes:
//   ?resource=competitions            → { main_events, competitions } combined
//                                       feed for the /competitions page
//   ?resource=competitions&slug=<s>   → single pre-nationals competition,
//                                       404 if not found
//
// The slug branch is unchanged from Phase 3b. The list branch was widened to
// also surface ZLTAC events (the "main event" each year) so the public page
// can show both in two labelled sections.
//
// Visibility:
//   - competitions: mirrors the anon RLS predicate from 20260527000000
//     (archived_at IS NULL AND (registration_close_at IS NULL OR > now)).
//   - zltac_events: mirrors the anon RLS predicate from initial_schema.sql:567
//     (status IN ('open', 'closed', 'archived') — i.e. anything not draft).
// Both filters are enforced server-side regardless of RLS for defence-in-depth.

async function handleCompetitions(req, res) {
  const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : ''
  const nowIso = new Date().toISOString()

  if (slug) {
    const { data, error } = await supabaseAdmin
      .from('competitions')
      .select(PUBLIC_COMPETITION_COLUMNS)
      .eq('slug', slug)
      .is('archived_at', null)
      // Postgrest can't OR (a IS NULL, a > now) cleanly; .or() handles it.
      .or(`registration_close_at.is.null,registration_close_at.gt.${nowIso}`)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'competition not found' })
    return res.json(data)
  }

  // Run both queries in parallel; if either fails, surface a single 500 so
  // the client never has to render a partial feed.
  const [mainEventsResult, competitionsResult] = await Promise.all([
    supabaseAdmin
      .from('zltac_events')
      .select(PUBLIC_ZLTAC_COLUMNS)
      .in('status', ['open', 'closed', 'archived'])
      .order('start_date', { ascending: true }),
    supabaseAdmin
      .from('competitions')
      .select(PUBLIC_COMPETITION_COLUMNS)
      .is('archived_at', null)
      .or(`registration_close_at.is.null,registration_close_at.gt.${nowIso}`)
      .order('start_date', { ascending: true }),
  ])

  if (mainEventsResult.error) return res.status(500).json({ error: mainEventsResult.error.message })
  if (competitionsResult.error) return res.status(500).json({ error: competitionsResult.error.message })

  return res.json({
    main_events: mainEventsResult.data ?? [],
    competitions: competitionsResult.data ?? [],
  })
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const resource = req.query.resource
  if (resource === 'event')        return handleEvent(req, res)
  if (resource === 'committee')    return handleCommittee(req, res)
  if (resource === 'members')      return handleMembers(req, res)
  if (resource === 'competitions') return handleCompetitions(req, res)
  return res.status(400).json({ error: 'resource query param must be "event", "committee", "members", or "competitions"' })
}
