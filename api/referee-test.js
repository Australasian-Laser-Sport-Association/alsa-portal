import supabaseAdmin from './_lib/supabase.js'
import { sendServerError } from './_lib/apiErrors.js'
import { verifyUser, statusForAuthError } from './_lib/auth.js'
import { enforceRateLimit } from './_lib/rateLimit.js'

const QUESTION_COLUMNS = 'id, section, question, option_a, option_b, option_c, option_d, category, image_url, video_url'
const ALLOWED_LETTERS = new Set(['a', 'b', 'c', 'd'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function retryAfterSeconds(error) {
  const retryAt = new Date(error?.details ?? '').getTime()
  if (!Number.isFinite(retryAt)) return 60
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))
}

function sendAttemptError(res, error, operation) {
  const message = String(error?.message ?? '')
  if (error?.code === '55P03') {
    const retryAfter = retryAfterSeconds(error)
    res.setHeader('Retry-After', String(retryAfter))
    return res.status(429).json({
      error: 'Please wait before starting another Rules Test attempt.',
      retry_after_seconds: retryAfter,
    })
  }
  if (error?.code === '42501') return res.status(403).json({ error: message || 'Not allowed.' })
  if (error?.code === '23514' && /already been passed/i.test(message)) {
    return res.status(403).json({ error: 'You have already passed the Rules Test.' })
  }
  if (error?.code === 'P0002') return res.status(404).json({ error: message || 'Rules Test attempt not found.' })
  if (error?.code === '22023') return res.status(400).json({ error: message || 'Invalid Rules Test submission.' })
  if (error?.code === '57014') return res.status(410).json({ error: 'This Rules Test attempt has expired.' })
  if (error?.code === '55000') return res.status(409).json({ error: message || 'Rules Test attempt is unavailable.' })
  return sendServerError(res, error, operation)
}

function validateAnswers(answers) {
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 100) {
    return 'answers must be a non-empty array of at most 100 entries'
  }
  const ids = new Set()
  for (const answer of answers) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      return 'each answer must be an object'
    }
    if (typeof answer.question_id !== 'string' || !UUID_PATTERN.test(answer.question_id)) {
      return 'each answer requires a valid question_id'
    }
    if (typeof answer.letter !== 'string' || !ALLOWED_LETTERS.has(answer.letter)) {
      return "letter must be one of 'a', 'b', 'c', or 'd'"
    }
    if (ids.has(answer.question_id)) return 'duplicate question_id in payload'
    ids.add(answer.question_id)
  }
  return null
}

async function startAttempt(res, user) {
  const { data: attempt, error } = await supabaseAdmin.rpc('start_referee_test_attempt', {
    p_user_id: user.id,
  })
  if (error) return sendAttemptError(res, error, 'referee-test:start')

  const questionIds = Array.isArray(attempt?.question_ids) ? attempt.question_ids : []
  if (!UUID_PATTERN.test(attempt?.attempt_id ?? '') || questionIds.length === 0) {
    return sendServerError(res, new Error('Attempt RPC returned an invalid payload.'), 'referee-test:start-payload')
  }

  const { data: questionRows, error: questionError } = await supabaseAdmin
    .from('referee_questions')
    .select(QUESTION_COLUMNS)
    .in('id', questionIds)
  if (questionError) return sendServerError(res, questionError, 'referee-test:start-questions')

  const byId = new Map((questionRows ?? []).map(question => [question.id, question]))
  const questions = questionIds.map(id => byId.get(id)).filter(Boolean)
  if (questions.length !== questionIds.length) {
    return res.status(409).json({ error: 'One or more issued Rules Test questions are unavailable.' })
  }

  return res.json({
    attempt_id: attempt.attempt_id,
    expires_at: attempt.expires_at,
    resumed: attempt.resumed === true,
    settings: {
      safety_questions_per_test: attempt.safety_total,
      safety_pass_score: attempt.safety_pass_score,
      general_questions_per_test: attempt.general_total,
      general_pass_score: attempt.general_pass_score,
    },
    questions,
  })
}

async function submitAttempt(res, user, body) {
  if (typeof body.attempt_id !== 'string' || !UUID_PATTERN.test(body.attempt_id)) {
    return res.status(400).json({ error: 'A valid attempt_id is required.' })
  }
  const validationError = validateAnswers(body.answers)
  if (validationError) return res.status(400).json({ error: validationError })

  const { data, error } = await supabaseAdmin.rpc('submit_referee_test_attempt', {
    p_attempt_id: body.attempt_id,
    p_user_id: user.id,
    p_answers: body.answers,
  })
  if (error) return sendAttemptError(res, error, 'referee-test:submit')
  if (data?.expired === true) {
    return res.status(410).json({
      error: 'This Rules Test attempt has expired.',
      attempt_id: data.attempt_id,
      expires_at: data.expires_at,
    })
  }

  // The transactional RPC closes the attempt before returning. It deliberately
  // returns aggregate scores only, never a reusable answer key.
  return res.json({
    ok: true,
    attempt_id: data?.attempt_id,
    score: data?.score,
    passed: data?.passed === true,
    taken_at: data?.taken_at,
    safety_correct: data?.safety_correct,
    safety_total: data?.safety_total,
    general_correct: data?.general_correct,
    general_total: data?.general_total,
    safety_passed: data?.safety_passed === true,
    general_passed: data?.general_passed === true,
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authError } = await verifyUser(req)
  if (authError) return res.status(statusForAuthError(authError)).json({ error: authError })

  const permitted = await enforceRateLimit(req, res, {
    identifier: user.id,
    limit: 30,
    window: '15m',
    prefix: 'referee-test',
    requireDistributed: true,
  })
  if (!permitted) return

  const body = req.body ?? {}
  if (body.action === 'start') return startAttempt(res, user)
  if (body.action === 'submit') return submitAttempt(res, user, body)
  return res.status(400).json({ error: 'action must be "start" or "submit"' })
}
