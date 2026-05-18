import supabaseAdmin from './_lib/supabase.js'

// Public endpoint — returns committee members for the About and ZLTAC pages.
// No auth required. Returns minimal identity fields and the matching committee
// role(s). No PII (no email/phone/DOB).
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

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
