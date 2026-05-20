import supabaseAdmin from './_lib/supabase.js'
import { verifyUser } from './_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const {
    score, passed, taken_at,
    safety_correct, safety_total, general_correct, general_total,
  } = req.body ?? {}
  if (typeof score !== 'number' || typeof passed !== 'boolean') {
    return res.status(400).json({ error: 'score and passed are required' })
  }

  const toInt = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
  const sc = toInt(safety_correct), st = toInt(safety_total)
  const gc = toInt(general_correct), gt = toInt(general_total)

  const payload = {
    score,
    passed,
    taken_at: taken_at ?? new Date().toISOString(),
    safety_correct: sc, safety_total: st,
    general_correct: gc, general_total: gt,
    safety_passed: null, general_passed: null,
  }

  // Server-authoritative scoring: when section counts are supplied (the player
  // flow always sends them), derive the pass result from the configured
  // per-section pass scores rather than trusting client-sent flags.
  //   safety_passed  = round(sc/st * 100) >= safety_pass_score   (vacuous at st=0)
  //   general_passed = round(gc/gt * 100) >= general_pass_score  (vacuous at gt=0)
  //   overall        = both;  score = round(totalCorrect/totalQ * 100)
  // Identical rounding to the client (RefereeTest.jsx) so stored == displayed.
  // Falls back to the client-sent score/passed for any legacy caller that omits
  // section counts.
  if (st != null && gt != null) {
    const { data: cfg } = await supabaseAdmin
      .from('referee_test_settings')
      .select('safety_pass_score, general_pass_score')
      .limit(1)
      .maybeSingle()
    const safetyPassScore = cfg?.safety_pass_score ?? 100
    const generalPassScore = cfg?.general_pass_score ?? 70

    const safetyPct  = st > 0 ? Math.round(((sc ?? 0) / st) * 100) : 100
    const generalPct = gt > 0 ? Math.round(((gc ?? 0) / gt) * 100) : 100
    const safetyPassed  = safetyPct >= safetyPassScore
    const generalPassed = generalPct >= generalPassScore

    const totalQ = st + gt
    const totalCorrect = (sc ?? 0) + (gc ?? 0)

    payload.safety_passed = safetyPassed
    payload.general_passed = generalPassed
    payload.passed = safetyPassed && generalPassed
    payload.score = totalQ > 0 ? Math.min(Math.round((totalCorrect / totalQ) * 100), 100) : 0
  }

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('referee_test_results')
    .select('id, passed')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existingErr) return res.status(500).json({ error: existingErr.message })

  // Once a player has passed, the result is locked — no retakes/resubmissions.
  // The committee can clear the row or set admin_override_ref_test. Defence in
  // depth: the client also hides the test for passed players.
  if (existing?.passed === true) {
    return res.status(403).json({ error: "You've already passed the Rules Test. Contact the committee for retake." })
  }

  const { error: saveErr } = existing
    ? await supabaseAdmin.from('referee_test_results').update(payload).eq('user_id', user.id)
    : await supabaseAdmin.from('referee_test_results').insert({ user_id: user.id, ...payload })

  if (saveErr) return res.status(500).json({ error: saveErr.message })
  return res.json({ ok: true })
}
