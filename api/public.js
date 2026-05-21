import supabaseAdmin from './_lib/supabase.js'

// Consolidated public-read endpoint. Dispatches by ?resource=:
//   ?resource=event&year=YYYY → confirmed doubles/triples pairs for an event
//   ?resource=committee       → ALSA + ZLTAC committee members
//   ?resource=members         → current ALSA membership period + member list
//
// All resources are GET, all public (no auth). Consolidated from
// api/event.js + api/committee.js + api/members.js to stay under the
// Vercel Hobby function cap.

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

// ── Dispatch ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const resource = req.query.resource
  if (resource === 'event')     return handleEvent(req, res)
  if (resource === 'committee') return handleCommittee(req, res)
  if (resource === 'members')   return handleMembers(req, res)
  return res.status(400).json({ error: 'resource query param must be "event", "committee", or "members"' })
}
