import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const statusForAuthError = vi.fn(error => (
  error === 'Unauthorized' ? 401 : error === 'Account suspended' ? 403 : 500
))
const enforceRateLimit = vi.fn()
const sendServerError = vi.fn(res => res.status(500).json({ error: 'Internal server error' }))

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({ verifyUser, statusForAuthError }))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))
vi.mock('./apiErrors.js', () => ({ sendServerError }))

const { default: handler } = await import('../referee-test.js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const ATTEMPT_ID = '223e4567-e89b-42d3-a456-426614174000'
const QUESTION_1 = '323e4567-e89b-42d3-a456-426614174000'
const QUESTION_2 = '423e4567-e89b-42d3-a456-426614174000'

function request(body, method = 'POST') {
  return { method, headers: { authorization: 'Bearer test' }, body }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('server-issued referee-test attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it.each([
    ['Unauthorized', 401],
    ['Account suspended', 403],
    ['Internal error', 500],
  ])('maps %s without misclassifying it as an expired session', async (error, status) => {
    verifyUser.mockResolvedValue({ user: null, error })

    const res = response()
    await handler(request({ action: 'start' }), res)

    expect(res.statusCode).toBe(status)
    expect(statusForAuthError).toHaveBeenCalledWith(error)
    expect(enforceRateLimit).not.toHaveBeenCalled()
  })

  it('starts an attempt from server-selected IDs and never selects the answer key', async () => {
    rpc.mockResolvedValue({
      data: {
        attempt_id: ATTEMPT_ID,
        question_ids: [QUESTION_2, QUESTION_1],
        expires_at: '2026-07-13T14:00:00.000Z',
        safety_total: 1,
        general_total: 1,
        safety_pass_score: 100,
        general_pass_score: 70,
        resumed: false,
      },
      error: null,
    })
    const inIds = vi.fn().mockResolvedValue({
      data: [
        { id: QUESTION_1, section: 'general', question: 'General?' },
        { id: QUESTION_2, section: 'safety', question: 'Safe?' },
      ],
      error: null,
    })
    const select = vi.fn(() => ({ in: inIds }))
    from.mockReturnValue({ select })

    const res = response()
    await handler(request({ action: 'start' }), res)

    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('start_referee_test_attempt', { p_user_id: USER_ID })
    expect(select).toHaveBeenCalledWith(expect.not.stringContaining('correct_answer'))
    expect(res.body.questions.map(question => question.id)).toEqual([QUESTION_2, QUESTION_1])
    expect(res.body).not.toHaveProperty('correct_answer')
  })

  it('binds submission to the verified user and issued attempt without a client timestamp', async () => {
    const answers = [
      { question_id: QUESTION_1, letter: 'a' },
      { question_id: QUESTION_2, letter: 'd' },
    ]
    rpc.mockResolvedValue({
      data: {
        attempt_id: ATTEMPT_ID,
        score: 50,
        passed: false,
        taken_at: '2026-07-13T13:00:00.000Z',
        safety_correct: 1,
        safety_total: 1,
        general_correct: 0,
        general_total: 1,
        safety_passed: true,
        general_passed: false,
        per_question: [{ question_id: QUESTION_1, correct_answer: 'b' }],
      },
      error: null,
    })

    const res = response()
    await handler(request({
      action: 'submit',
      attempt_id: ATTEMPT_ID,
      answers,
      taken_at: '2001-01-01T00:00:00.000Z',
    }), res)

    expect(rpc).toHaveBeenCalledWith('submit_referee_test_attempt', {
      p_attempt_id: ATTEMPT_ID,
      p_user_id: USER_ID,
      p_answers: answers,
    })
    expect(res.body).toMatchObject({ ok: true, score: 50, passed: false })
    expect(res.body).not.toHaveProperty('per_question')
    expect(JSON.stringify(res.body)).not.toContain('correct_answer')
  })

  it('rejects duplicate or malformed answers before touching the database', async () => {
    const res = response()
    await handler(request({
      action: 'submit',
      attempt_id: ATTEMPT_ID,
      answers: [
        { question_id: QUESTION_1, letter: 'a' },
        { question_id: QUESTION_1, letter: 'b' },
      ],
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/duplicate/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects the legacy unbound submission contract', async () => {
    const res = response()
    await handler(request({ answers: [{ question_id: QUESTION_1, letter: 'a' }] }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/action/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns retry guidance when the database cooldown is active', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: '55P03',
        message: 'A new Rules Test attempt is temporarily unavailable.',
        details: new Date(Date.now() + 120_000).toISOString(),
      },
    })

    const res = response()
    await handler(request({ action: 'start' }), res)
    expect(res.statusCode).toBe(429)
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0)
    expect(res.body).toMatchObject({ error: expect.stringMatching(/wait/i) })
  })

  it('maps a replayed closed attempt to conflict without leaking database details', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'This Rules Test attempt has already been closed.' },
    })
    const res = response()
    await handler(request({
      action: 'submit',
      attempt_id: ATTEMPT_ID,
      answers: [{ question_id: QUESTION_1, letter: 'a' }],
    }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatch(/closed/i)
  })

  it('maps a durably persisted expiry outcome to gone', async () => {
    rpc.mockResolvedValue({
      data: {
        attempt_id: ATTEMPT_ID,
        expired: true,
        expires_at: '2026-07-13T13:00:00.000Z',
      },
      error: null,
    })
    const res = response()
    await handler(request({
      action: 'submit',
      attempt_id: ATTEMPT_ID,
      answers: [{ question_id: QUESTION_1, letter: 'a' }],
    }), res)

    expect(res.statusCode).toBe(410)
    expect(res.body).toEqual({
      error: 'This Rules Test attempt has expired.',
      attempt_id: ATTEMPT_ID,
      expires_at: '2026-07-13T13:00:00.000Z',
    })
  })
})
