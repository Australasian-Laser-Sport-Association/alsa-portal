import supabaseAdmin from './_lib/supabase.js'
import { verifyUser } from './_lib/auth.js'

// Server-authoritative Rules Test scoring.
//
// The client submits only raw answers — { question_id, letter } pairs — and
// this handler:
//   1. Verifies every submitted question_id is in the active question bank.
//   2. Confirms the per-section submitted count matches the configured
//      sample size (or the active pool size if that pool is smaller),
//      mirroring RulesTestRunner.composeAttempt().
//   3. Scores each answer against the stored correct_answer.
//   4. Derives safety_correct / safety_total / general_correct /
//      general_total / safety_passed / general_passed / overall passed /
//      score entirely server-side.
//   5. Writes to referee_test_results via service-role (the only allowed
//      write path post-20260528010000_rules_test_integrity_patch).
//
// The response carries the per-question breakdown so the client can render
// the post-submit reveal without ever holding correct_answer pre-submit.
//
// Already-passed guard preserved: once a player's stored result is
// passed=true, this endpoint refuses re-submissions (committee can clear
// the row or use admin_override_ref_test for retake).

const ALLOWED_LETTERS = new Set(['a', 'b', 'c', 'd'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(401).json({ error: authErr })

  const body = req.body ?? {}
  const answers = body.answers
  const takenAt = body.taken_at

  // ── 1. Payload shape ───────────────────────────────────────────────────────
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'answers must be a non-empty array' })
  }

  const submittedById = new Map()
  const submittedIds = []
  for (const a of answers) {
    if (!a || typeof a !== 'object') {
      return res.status(400).json({ error: 'each answer must be an object' })
    }
    const qid = a.question_id
    const letter = a.letter
    if (typeof qid !== 'string' || qid.length === 0) {
      return res.status(400).json({ error: 'each answer requires a question_id' })
    }
    if (typeof letter !== 'string' || !ALLOWED_LETTERS.has(letter)) {
      return res.status(400).json({ error: "letter must be one of 'a', 'b', 'c', 'd'" })
    }
    if (submittedById.has(qid)) {
      return res.status(400).json({ error: 'duplicate question_id in payload' })
    }
    submittedById.set(qid, letter)
    submittedIds.push(qid)
  }

  // ── 2. Verify against the live question bank ───────────────────────────────
  const { data: questions, error: qErr } = await supabaseAdmin
    .from('referee_questions')
    .select('id, section, correct_answer')
    .in('id', submittedIds)
    .eq('active', true)
  if (qErr) return res.status(500).json({ error: qErr.message })

  if ((questions ?? []).length !== submittedIds.length) {
    return res.status(400).json({ error: 'one or more questions are not active or do not exist' })
  }

  // ── 3. Per-section expected counts (match composeAttempt's sampling) ──────
  const { data: cfg } = await supabaseAdmin
    .from('referee_test_settings')
    .select('safety_questions_per_test, safety_pass_score, general_questions_per_test, general_pass_score')
    .limit(1)
    .maybeSingle()
  const safetyPerTest    = cfg?.safety_questions_per_test ?? 10
  const generalPerTest   = cfg?.general_questions_per_test ?? 20
  const safetyPassScore  = cfg?.safety_pass_score ?? 100
  const generalPassScore = cfg?.general_pass_score ?? 70

  const { data: activeAll, error: actErr } = await supabaseAdmin
    .from('referee_questions')
    .select('id, section')
    .eq('active', true)
  if (actErr) return res.status(500).json({ error: actErr.message })

  const activeSafety  = (activeAll ?? []).filter(q => q.section === 'safety').length
  const activeGeneral = (activeAll ?? []).filter(q => q.section !== 'safety').length

  const expectedSafety  = Math.min(safetyPerTest, activeSafety)
  const expectedGeneral = Math.min(generalPerTest, activeGeneral)

  let submittedSafety = 0
  let submittedGeneral = 0
  for (const q of questions) {
    if (q.section === 'safety') submittedSafety++
    else submittedGeneral++
  }
  if (submittedSafety !== expectedSafety) {
    return res.status(400).json({ error: `expected ${expectedSafety} safety answer(s), got ${submittedSafety}` })
  }
  if (submittedGeneral !== expectedGeneral) {
    return res.status(400).json({ error: `expected ${expectedGeneral} general answer(s), got ${submittedGeneral}` })
  }

  // ── 4. Score ──────────────────────────────────────────────────────────────
  const perQuestion = []
  let safetyCorrect = 0
  let generalCorrect = 0
  for (const q of questions) {
    const selected = submittedById.get(q.id)
    const isCorrect = selected === q.correct_answer
    perQuestion.push({
      question_id: q.id,
      section: q.section,
      selected_letter: selected,
      correct_answer: q.correct_answer,
      is_correct: isCorrect,
    })
    if (q.section === 'safety' && isCorrect) safetyCorrect++
    if (q.section !== 'safety' && isCorrect) generalCorrect++
  }

  const safetyTotal  = expectedSafety
  const generalTotal = expectedGeneral
  const safetyPct  = safetyTotal > 0 ? Math.round((safetyCorrect / safetyTotal) * 100) : 100
  const generalPct = generalTotal > 0 ? Math.round((generalCorrect / generalTotal) * 100) : 100
  const safetyPassed  = safetyPct >= safetyPassScore
  const generalPassed = generalPct >= generalPassScore
  const passed = safetyPassed && generalPassed
  const totalQ = safetyTotal + generalTotal
  const totalCorrect = safetyCorrect + generalCorrect
  const score = totalQ > 0 ? Math.min(Math.round((totalCorrect / totalQ) * 100), 100) : 0

  // ── 5. Already-passed guard + write ───────────────────────────────────────
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('referee_test_results')
    .select('id, passed')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existingErr) return res.status(500).json({ error: existingErr.message })

  if (existing?.passed === true) {
    return res.status(403).json({ error: "You've already passed the Rules Test. Contact the committee for retake." })
  }

  const payload = {
    score,
    passed,
    taken_at: takenAt ?? new Date().toISOString(),
    safety_correct: safetyCorrect,
    safety_total:   safetyTotal,
    general_correct: generalCorrect,
    general_total:   generalTotal,
    safety_passed:  safetyPassed,
    general_passed: generalPassed,
  }

  const { error: saveErr } = existing
    ? await supabaseAdmin.from('referee_test_results').update(payload).eq('user_id', user.id)
    : await supabaseAdmin.from('referee_test_results').insert({ user_id: user.id, ...payload })

  if (saveErr) return res.status(500).json({ error: saveErr.message })

  return res.json({
    ok: true,
    ...payload,
    per_question: perQuestion,
  })
}
