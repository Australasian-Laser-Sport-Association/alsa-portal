import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const statusForAuthError = vi.fn(error => (
  error === 'Unauthorized' ? 401 : error === 'Account suspended' ? 403 : 500
))
const enforceRateLimit = vi.fn()
const requireOpenPhase = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc },
}))

vi.mock('./auth.js', () => ({
  verifyUser,
  statusForAuthError,
  getActiveEventYear: vi.fn(),
}))

vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

vi.mock('./eventPhase.js', () => ({
  requireOpenPhase,
  getEventPhase: vi.fn(() => Promise.resolve({ phase: 'open' })),
}))

vi.mock('./sideEventCleanup.js', () => ({
  cleanupFormerSideEventMember: vi.fn(),
  cleanupFormerSideEventMembers: vi.fn(),
  ensureSideEventMember: vi.fn(),
}))

vi.mock('./placeholders.js', () => ({ anyPlaceholder: vi.fn() }))

const { default: handler } = await import('../player.js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const DOCUMENT_ID = '123e4567-e89b-42d3-a456-426614174010'

function req(body) {
  return {
    method: 'POST',
    query: { resource: 'registration' },
    headers: { authorization: 'Bearer test-token' },
    body,
  }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function selectByUserYear(data, error = null) {
  const maybeSingle = vi.fn(() => Promise.resolve({ data, error }))
  const yearEq = vi.fn(() => ({ maybeSingle }))
  const userEq = vi.fn(() => ({ eq: yearEq }))
  const select = vi.fn(() => ({ eq: userEq }))
  return { query: { select }, select, userEq, yearEq, maybeSingle }
}

function selectByOneField(data, error = null) {
  const maybeSingle = vi.fn(() => Promise.resolve({ data, error }))
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  return { query: { select }, select, eq, maybeSingle }
}

function activeUnder18Document(data) {
  const maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }))
  const limit = vi.fn(() => ({ maybeSingle }))
  const order = vi.fn(() => ({ limit }))
  const thirdNot = vi.fn(() => ({ order }))
  const secondNot = vi.fn(() => ({ not: thirdNot }))
  const firstNot = vi.fn(() => ({ not: secondNot }))
  const activeEq = vi.fn(() => ({ not: firstNot }))
  const typeEq = vi.fn(() => ({ eq: activeEq }))
  const select = vi.fn(() => ({ eq: typeEq }))
  return { query: { select }, typeEq, activeEq, firstNot, secondNot, thirdNot }
}

describe('player registration security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    requireOpenPhase.mockResolvedValue({ ok: true, phase: 'open' })
  })

  it.each([
    ['Account suspended', 403],
    ['Internal error', 500],
  ])('maps %s through the shared auth status policy', async (authError, status) => {
    verifyUser.mockResolvedValueOnce({ user: null, error: authError })
    const response = res()

    await handler(req({ action: 'register', year: 2027, dob: '2000-01-02' }), response)

    expect(response.statusCode).toBe(status)
    expect(response.body).toEqual({ error: authError })
    expect(statusForAuthError).toHaveBeenCalledWith(authError)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('requires a valid DOB before starting registration work', async () => {
    const response = res()
    await handler(req({ action: 'register', year: 2027 }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/date of birth/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('routes profile, cap, insert, and pricing work through one registration RPC', async () => {
    const registration = {
      id: 'reg-atomic',
      user_id: USER_ID,
      year: 2027,
      side_events: null,
      has_confirmed_side_events: false,
      dinner_guests: 0,
      has_confirmed_extras: false,
      dob_at_registration: '2000-01-02',
    }
    rpc.mockResolvedValue({
      data: { ok: true, id: registration.id, existing: false, registration, amountOwing: 5000 },
      error: null,
    })

    const response = res()
    await handler(req({
      action: 'register',
      year: 2027,
      dob: '2000-01-02',
      emergency_contact_name: ' Helper ',
      emergency_contact_phone: ' 0400 000 000 ',
    }), response)

    expect(response.statusCode).toBe(201)
    expect(response.body).toEqual({ ok: true, id: registration.id, registration, amountOwing: 5000 })
    expect(rpc).toHaveBeenCalledWith('register_zltac_player', {
      p_user_id: USER_ID,
      p_event_year: 2027,
      p_dob: '2000-01-02',
      p_emergency_contact_name: 'Helper',
      p_emergency_contact_phone: '0400 000 000',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('maps a draft-event denial from the locked registration RPC', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'The event is not open for roster changes.' },
    })

    const response = res()
    await handler(req({ action: 'register', year: 2027, dob: '2000-01-02' }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/not open/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('does not forward a placeholder id from a stale registration RPC response', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: false,
        error: 'placeholder_exists',
        placeholder_id: '123e4567-e89b-42d3-a456-426614174099',
      },
      error: null,
    })

    const response = res()
    await handler(req({ action: 'register', year: 2027, dob: '2000-01-02' }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({
      error: 'This registration conflicts with an existing record. Check your Player Hub or contact the committee.',
    })
    expect(JSON.stringify(response.body)).not.toContain('placeholder')
  })

  it('does not let registration rewrite a locked date of birth', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', hint: 'DOB_LOCKED', message: 'Date of birth is locked.' },
    })

    const response = res()
    await handler(req({ action: 'register', year: 2027, dob: '2000-01-02' }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({
      error: 'Date of birth is locked after event registration. Contact the committee to correct it.',
      code: 'DOB_LOCKED',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects committee-controlled fields instead of ignoring them', async () => {
    const response = res()
    await handler(req({
      action: 'submit-under-18',
      year: 2027,
      status: 'approved',
      approved_by: USER_ID,
      notes: 'self approved',
    }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toContain('status')
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('submits only a pending under-18 state through the service-role RPC and requires the active form', async () => {
    // This player turns 18 before 1 July, but after the actual event start.
    // The submission must use the event cutoff instead of a hard-coded date.
    const registration = selectByUserYear({ id: 'reg-1', dob_at_registration: '2009-06-20' })
    const event = selectByOneField({
      id: 'event-1',
      status: 'open',
      start_date: '2027-06-15',
      event_starts_at: null,
      timezone: 'Australia/Sydney',
    })
    const document = activeUnder18Document({ id: 'document-1', document_type: 'under_18_form', is_active: true })
    const approvalLookup = selectByUserYear(null)
    const approval = {
      id: 'approval-1',
      user_id: USER_ID,
      event_year: 2027,
      status: 'pending',
      submitted_at: '2026-07-13T00:00:00.000Z',
      approved_at: null,
      approved_by: null,
      notes: null,
      document_id: 'document-1',
    }

    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return registration.query
      if (table === 'zltac_events') return event.query
      if (table === 'legal_documents') return document.query
      if (table === 'under_18_approvals') return approvalLookup.query
      throw new Error(`unexpected table ${table}`)
    })
    rpc.mockResolvedValue({ data: approval, error: null })

    const response = res()
    await handler(req({ action: 'submit-under-18', year: 2027 }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, approval })
    expect(document.typeEq).toHaveBeenCalledWith('document_type', 'under_18_form')
    expect(document.activeEq).toHaveBeenCalledWith('is_active', true)
    expect(rpc).toHaveBeenCalledWith('submit_under_18_approval', {
      p_user_id: USER_ID,
      p_event_year: 2027,
      p_document_id: 'document-1',
    })
    expect(response.body.approval.status).toBe('pending')
  })

  it('fails closed when the under-18 RPC is missing instead of writing the table directly', async () => {
    const registration = selectByUserYear({ id: 'reg-1', dob_at_registration: '2012-01-02' })
    const event = selectByOneField({
      id: 'event-1',
      status: 'open',
      start_date: '2027-06-15',
      event_starts_at: null,
      timezone: 'Australia/Sydney',
    })
    const document = activeUnder18Document({ id: 'document-1', document_type: 'under_18_form', is_active: true })
    const approvalLookup = selectByUserYear(null)
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return registration.query
      if (table === 'zltac_events') return event.query
      if (table === 'legal_documents') return document.query
      if (table === 'under_18_approvals') return approvalLookup.query
      throw new Error(`unexpected table ${table}`)
    })
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function missing' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = res()
    await handler(req({ action: 'submit-under-18', year: 2027 }), response)

    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual({ error: 'Internal server error' })
    expect(from.mock.calls.filter(([table]) => table === 'under_18_approvals')).toHaveLength(1)
    consoleError.mockRestore()
  })

  it('returns a conflict when an event is archived during under-18 submission', async () => {
    const registration = selectByUserYear({ id: 'reg-1', dob_at_registration: '2012-01-02' })
    const event = selectByOneField({
      id: 'event-1',
      status: 'open',
      start_date: '2027-06-15',
      event_starts_at: null,
      timezone: 'Australia/Sydney',
    })
    const document = activeUnder18Document({ id: DOCUMENT_ID, document_type: 'under_18_form', is_active: true })
    const approvalLookup = selectByUserYear(null)
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return registration.query
      if (table === 'zltac_events') return event.query
      if (table === 'legal_documents') return document.query
      if (table === 'under_18_approvals') return approvalLookup.query
      throw new Error(`unexpected table ${table}`)
    })
    rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'Archived event' },
    })

    const response = res()
    await handler(req({ action: 'submit-under-18', year: 2027 }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/event cannot accept/i)
  })

  it('fails closed when the event has no usable local start-date cutoff', async () => {
    const registration = selectByUserYear({ id: 'reg-1', dob_at_registration: '2012-01-02' })
    const event = selectByOneField({
      id: 'event-1',
      status: 'open',
      start_date: null,
      event_starts_at: null,
      timezone: 'Australia/Sydney',
    })
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return registration.query
      if (table === 'zltac_events') return event.query
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(req({ action: 'submit-under-18', year: 2027 }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/eligibility could not be determined/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses the configured timezone when only event_starts_at supplies the cutoff', async () => {
    const registration = selectByUserYear({ id: 'reg-1', dob_at_registration: '2009-06-15' })
    const event = selectByOneField({
      id: 'event-1',
      status: 'open',
      start_date: null,
      event_starts_at: '2027-06-14T15:30:00.000Z',
      timezone: 'Australia/Sydney',
    })
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return registration.query
      if (table === 'zltac_events') return event.query
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(req({ action: 'submit-under-18', year: 2027 }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/not required/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails closed when event_starts_at has no valid configured timezone', async () => {
    const registration = selectByUserYear({ id: 'reg-1', dob_at_registration: '2012-01-02' })
    const event = selectByOneField({
      id: 'event-1',
      status: 'open',
      start_date: null,
      event_starts_at: '2027-06-14T15:30:00.000Z',
      timezone: null,
    })
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') return registration.query
      if (table === 'zltac_events') return event.query
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(req({ action: 'submit-under-18', year: 2027 }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/eligibility could not be determined/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('records acknowledgements through the authenticated RPC without request metadata', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'acceptance-1' }, error: null })
    const request = req({
      action: 'sign-legal',
      documentId: DOCUMENT_ID,
      eventYear: 2027,
    })
    request.headers['user-agent'] = 'must-not-be-stored'
    request.headers['x-forwarded-for'] = '203.0.113.9, 10.0.0.2'

    const response = res()
    await handler(request, response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('accept_legal_document', {
      p_user_id: USER_ID,
      p_event_year: 2027,
      p_document_id: DOCUMENT_ID,
      p_ip_address: null,
      p_user_agent: null,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('maps an archived-event acknowledgement race to a retryable conflict', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'Archived event' },
    })

    const response = res()
    await handler(req({
      action: 'sign-legal',
      documentId: DOCUMENT_ID,
      eventYear: 2027,
    }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/event cannot accept/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects malformed required-document ids before calling the service RPC', async () => {
    const response = res()
    await handler(req({
      action: 'sign-legal',
      documentId: `${DOCUMENT_ID}),is_active.eq.true`,
      eventYear: 2027,
    }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/valid UUID/i)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('confirms side events and recalculates through one authenticated RPC', async () => {
    const saved = {
      id: 'reg-1',
      user_id: USER_ID,
      year: 2027,
      side_events: ['doubles'],
      has_confirmed_side_events: true,
      dinner_guests: 0,
      has_confirmed_extras: false,
      dob_at_registration: '2000-01-02',
    }
    rpc.mockResolvedValue({ data: { registration: saved, amountOwing: 5000 }, error: null })

    const response = res()
    await handler(req({ action: 'confirm-side-events', year: 2027, side_events: ['doubles', 'doubles'] }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, registration: saved, amountOwing: 5000 })
    expect(rpc).toHaveBeenCalledWith('confirm_zltac_registration_choices', {
      p_user_id: USER_ID,
      p_event_year: 2027,
      p_action: 'confirm-side-events',
      p_side_events: ['doubles'],
      p_dinner_guests: null,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('keeps the legacy service-role recompute action unreachable', async () => {
    const response = res()
    await handler(req({ action: 'recompute-owing', registrationId: 'reg-1' }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/unknown action/i)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('maps roster-alignment conflicts without exposing database details', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        hint: 'SIDE_EVENT_ROSTER_EXISTS',
        message: 'Leave the existing doubles roster before removing that side event.',
      },
    })

    const response = res()
    await handler(req({ action: 'confirm-side-events', year: 2027, side_events: [] }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/leave the existing doubles roster/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('validates and confirms extras without accepting client confirmation fields', async () => {
    const response = res()
    await handler(req({
      action: 'confirm-extras',
      year: 2027,
      dinner_guests: 2,
      has_confirmed_extras: false,
    }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toContain('has_confirmed_extras')
    expect(from).not.toHaveBeenCalled()
  })
})
