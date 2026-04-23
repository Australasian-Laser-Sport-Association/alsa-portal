import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const { playerIds, eventYear } = req.body ?? {}
  if (!Array.isArray(playerIds) || playerIds.length === 0 || !eventYear) {
    return res.json({ coc_sigs: [], payments: [], ref_results: [], u18_subs: [], media_subs: [] })
  }

  const [
    { data: coc_sigs },
    { data: payments },
    { data: ref_results },
    { data: u18_subs },
    { data: media_subs },
  ] = await Promise.all([
    supabaseAdmin.from('code_of_conduct_signatures').select('user_id').in('user_id', playerIds),
    supabaseAdmin.from('payments').select('user_id, status').in('user_id', playerIds).eq('event_year', eventYear),
    supabaseAdmin.from('referee_test_results').select('user_id, passed, score').in('user_id', playerIds),
    supabaseAdmin.from('under18_submissions').select('user_id').in('user_id', playerIds).eq('event_year', eventYear),
    supabaseAdmin.from('media_release_submissions').select('user_id').in('user_id', playerIds).eq('event_year', eventYear),
  ])

  return res.json({
    coc_sigs: coc_sigs ?? [],
    payments: payments ?? [],
    ref_results: ref_results ?? [],
    u18_subs: u18_subs ?? [],
    media_subs: media_subs ?? [],
  })
}
