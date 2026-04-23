import supabaseAdmin from '../_lib/supabase.js'

// Public endpoint — confirmed side-event pairs for the event page display.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const year = parseInt(req.query.year)
  if (!year) return res.status(400).json({ error: 'year is required' })

  const [{ data: doubles, error: e1 }, { data: triples, error: e2 }] = await Promise.all([
    supabaseAdmin.from('doubles_pairs').select('*').eq('event_year', year).eq('confirmed', true),
    supabaseAdmin.from('triples_teams').select('*').eq('event_year', year).eq('confirmed', true),
  ])

  if (e1 || e2) return res.status(500).json({ error: (e1 ?? e2).message })
  return res.json({ doubles: doubles ?? [], triples: triples ?? [] })
}
