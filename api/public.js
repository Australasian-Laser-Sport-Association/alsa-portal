import supabaseAdmin from './_lib/supabase.js'
import { sendServerError } from './_lib/apiErrors.js'
import { clientIp, enforceRateLimit } from './_lib/rateLimit.js'
import {
  PUBLIC_ASSET_BUCKETS,
  isAllowedContentType,
  isAllowedPublicAsset,
  normalizeQueryValue,
  sanitizeFilename,
  shouldUseImageRenderer,
  validatedRenderParams,
} from './_lib/publicAsset.js'

// Consolidated public-read endpoint. Dispatches by ?resource=:
//   ?resource=event&year=YYYY → confirmed doubles/triples pairs for an event
//   ?resource=committee       → ALSA + ZLTAC committee members
//   ?resource=members         → current ALSA membership period + member list
//   ?resource=competitions    → pre-nationals listings (list or single by slug)
//   ?resource=roster&slug=…   → pre-nationals public roster (grouped by team)
//
// All resources are GET, all public (no auth). Consolidated from
// api/event.js + api/committee.js + api/members.js to stay under the
// Vercel Hobby function cap.

async function enforcePublicRateLimit(req, res, resource) {
  const isAsset = resource === 'asset'
  return enforceRateLimit(req, res, {
    identifier: clientIp(req),
    limit: isAsset ? 300 : 120,
    window: '1 m',
    prefix: isAsset ? 'public-asset' : `public-${resource || 'unknown'}`,
    requireDistributed: true,
  })
}

// Columns that anon callers see for a competition. bank_account_name,
// bank_bsb, bank_account_number are deliberately stripped — those only ever
// appear in the authenticated registration flow (Phase 3c). Matches the
// defence-in-depth model: the RLS policy from 20260527000000 admits the row,
// the API enforces the column filter so anon never sees bank details even via
// this endpoint.
const PUBLIC_COMPETITION_COLUMNS =
  'id, slug, name, start_date, end_date, registration_open_at, registration_close_at, price_per_player, payment_info_visible, description, links, banner_url'

// Columns shown on the public ZLTAC card. Mirrors the displayable surface of
// the zltac_events row without exposing fees or admin metadata.
const PUBLIC_ZLTAC_COLUMNS =
  'id, year, name, status, location, venue, start_date, end_date, logo_url, reg_open_date, reg_close_date, timezone'

// ── event ───────────────────────────────────────────────────────────────────

async function handleEvent(req, res) {
  const year = parseInt(req.query.year)
  if (!year) return res.status(400).json({ error: 'year is required' })

  const [{ data: doubles, error: e1 }, { data: triples, error: e2 }] = await Promise.all([
    supabaseAdmin.from('doubles_pairs').select('id, event_year, player1_id, player2_id, confirmed').eq('event_year', year).eq('confirmed', true),
   supabaseAdmin.from('triples_teams').select('id, event_year, player1_id, player2_id, player3_id, confirmed').eq('event_year', year).eq('confirmed', true),
  ])

  if (e1 || e2) return sendServerError(res, e1 ?? e2, 'public:event')
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
    return sendServerError(res, alsaErr ?? zltacErr, 'public:committee')
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

  const [
    { data: period, error: periodErr },
    { data: lifetimeRows, error: lifetimeErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('alsa_membership_periods')
      .select('id, label, starts_at, ends_at')
      .lte('starts_at', today)
      .gt('ends_at', today)
      .maybeSingle(),
    supabaseAdmin
      .from('alsa_lifetime_members')
      .select('profile_id, profiles:profile_id (id, first_name, last_name, alias, avatar_url)'),
  ])

  if (periodErr) return sendServerError(res, periodErr, 'public:members-period')
  if (lifetimeErr) return sendServerError(res, lifetimeErr, 'public:members-lifetime')

  const lifetime_members = (lifetimeRows ?? [])
    .map(m => m.profiles)
    .filter(Boolean)
    .sort((a, b) => (a.alias ?? a.first_name ?? '').localeCompare(b.alias ?? b.first_name ?? ''))

  if (!period) return res.json({ current_period: null, members: [], lifetime_members })

  const { data: memberships, error: membershipsErr } = await supabaseAdmin
    .from('alsa_memberships')
    .select('profile_id, profiles:profile_id (id, first_name, last_name, alias, avatar_url)')
    .eq('period_id', period.id)

  if (membershipsErr) return sendServerError(res, membershipsErr, 'public:memberships')

  const lifetimeIds = new Set(lifetime_members.map(p => p.id))
  const members = (memberships ?? [])
    .map(m => m.profiles)
    .filter(Boolean)
    .filter(p => !lifetimeIds.has(p.id))
    .sort((a, b) => (a.alias ?? a.first_name ?? '').localeCompare(b.alias ?? b.first_name ?? ''))

  return res.json({ current_period: period, members, lifetime_members })
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
    if (error) return sendServerError(res, error, 'public:competition-detail')
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

  if (mainEventsResult.error) return sendServerError(res, mainEventsResult.error, 'public:main-events')
  if (competitionsResult.error) return sendServerError(res, competitionsResult.error, 'public:competitions')

  return res.json({
    main_events: mainEventsResult.data ?? [],
    competitions: competitionsResult.data ?? [],
  })
}

// ── roster ──────────────────────────────────────────────────────────────────
// Anon-facing public roster for a pre-nationals competition. Reads from the
// definer-mode view public.public_competition_roster (see migration
// 20260527030000), which exposes only alias / first_name / last_name plus
// team metadata. Payment fields, audit timestamps, emails, etc. stay inside
// the locked-down base tables. The view's WHERE clause also enforces:
//   - competition not archived
//   - registration not yet closed
//   - team_members.invite_status = 'accepted' (pending invites stay private)
//
// This handler turns the flat view rows into the grouped response shape:
//   { competition, teams: [...], unteamed_players: [...] }
// Grouping happens server-side so the client stays decoupled from the
// view's column layout.

async function handleRoster(req, res) {
  const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : ''
  if (!slug) return res.status(400).json({ error: 'slug query param is required' })

  // Look up the competition to source its name (the view does not expose
  // name) and to surface a clean 404 when the slug is unknown / archived /
  // closed — even though the view itself also filters on those predicates.
  const nowIso = new Date().toISOString()
  const { data: comp, error: compErr } = await supabaseAdmin
    .from('competitions')
    .select('id, slug, name, archived_at, registration_close_at')
    .eq('slug', slug)
    .is('archived_at', null)
    .or(`registration_close_at.is.null,registration_close_at.gt.${nowIso}`)
    .maybeSingle()
  if (compErr) return sendServerError(res, compErr, 'public:roster-competition')
  if (!comp) return res.status(404).json({ error: 'competition not found' })

  const { data: rows, error: rosterErr } = await supabaseAdmin
    .from('public_competition_roster')
    .select('team_id, team_name, team_colour, alias, first_name, last_name, role_in_team')
    .eq('competition_slug', slug)
  if (rosterErr) return sendServerError(res, rosterErr, 'public:roster')

  // Group flat rows into { teams[], unteamed_players[] }. Each player entry
  // exposes only the three public columns.
  const teamMap = new Map()
  const unteamed = []
  for (const row of rows ?? []) {
    const entry = {
      alias: row.alias,
      first_name: row.first_name,
      last_name: row.last_name,
    }
    if (row.team_id == null) {
      unteamed.push(entry)
      continue
    }
    let team = teamMap.get(row.team_id)
    if (!team) {
      team = {
        id: row.team_id,
        name: row.team_name,
        colour: row.team_colour,
        captain: null,
        members: [],
      }
      teamMap.set(row.team_id, team)
    }
    if (row.role_in_team === 'captain') {
      team.captain = entry
    } else {
      team.members.push(entry)
    }
  }

  const aliasCmp = (a, b) =>
    (a.alias ?? '').toLowerCase().localeCompare((b.alias ?? '').toLowerCase())

  const teams = Array.from(teamMap.values()).sort((a, b) =>
    (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase())
  )
  for (const team of teams) {
    team.members.sort(aliasCmp)
  }
  unteamed.sort(aliasCmp)

  return res.json({
    competition: { id: comp.id, slug: comp.slug, name: comp.name },
    teams,
    unteamed_players: unteamed,
  })
}

// ── Dispatch ────────────────────────────────────────────────────────────────

function sendAssetError(res, status, message) {
  res.status(status).json({ error: message })
}

function normalizePathValue(value) {
  if (Array.isArray(value)) return value.join('/')
  return value
}

function forwardedHost(req) {
  return String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()
}

function isAllowedAssetHost(req) {
  const baseUrl = process.env.VITE_PUBLIC_ASSET_BASE_URL
  if (!baseUrl) return true

  try {
    const expectedHost = new URL(baseUrl).host.toLowerCase()
    const host = forwardedHost(req)
    if (host === expectedHost) return true

    // Keep preview deploys smoke-testable before the asset subdomain is aliased.
    return process.env.VERCEL_ENV !== 'production' && host.endsWith('.vercel.app')
  } catch {
    return false
  }
}

function setAssetHeaders(res, bucket, path, contentType, upstreamHeaders) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")

  const length = upstreamHeaders.get('content-length')
  if (length) res.setHeader('Content-Length', length)

  if (bucket === 'legal-documents') {
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(path)}"`)
  }
}

function publicAssetUrlFor(bucket, path, query) {
  const { publicUrl } = supabaseAdmin.storage.from(bucket).getPublicUrl(path).data

  if (!shouldUseImageRenderer(bucket, query)) return publicUrl

  const params = validatedRenderParams(query)
  if (!params) return null

  const parsed = new URL(publicUrl)
  parsed.pathname = parsed.pathname.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/',
  )
  parsed.search = params.toString()
  return parsed.toString()
}

async function handleAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return sendAssetError(res, 405, 'Method not allowed')
  }

  if (!isAllowedAssetHost(req)) {
    return sendAssetError(res, 404, 'Public asset not found')
  }

  const bucket = normalizeQueryValue(req.query.bucket)
  const path = normalizePathValue(req.query.path)

  if (!PUBLIC_ASSET_BUCKETS[bucket] || !isAllowedPublicAsset(bucket, path)) {
    return sendAssetError(res, 404, 'Public asset not found')
  }

  const upstreamUrl = publicAssetUrlFor(bucket, path, req.query)
  if (!upstreamUrl) return sendAssetError(res, 404, 'Public asset not found')

  const upstream = await fetch(upstreamUrl, { method: req.method })
  if (!upstream.ok) {
    return sendAssetError(res, upstream.status === 404 ? 404 : 502, 'Public asset not available')
  }

  const contentType = upstream.headers.get('content-type') ?? ''
  if (!isAllowedContentType(bucket, contentType)) {
    return sendAssetError(res, 404, 'Public asset not found')
  }

  setAssetHeaders(res, bucket, path, contentType, upstream.headers)

  if (req.method === 'HEAD') {
    return res.status(200).end()
  }

  const body = Buffer.from(await upstream.arrayBuffer())
  return res.status(200).send(body)
}

export default async function handler(req, res) {
  const resource = req.query.resource
  if (!await enforcePublicRateLimit(req, res, resource)) return
  if (resource === 'asset')       return handleAsset(req, res)

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (resource === 'event')        return handleEvent(req, res)
  if (resource === 'committee')    return handleCommittee(req, res)
  if (resource === 'members')      return handleMembers(req, res)
  if (resource === 'competitions') return handleCompetitions(req, res)
  if (resource === 'roster')       return handleRoster(req, res)
  return res.status(400).json({ error: 'resource query param must be "event", "committee", "members", "competitions", "roster", or "asset"' })
}
