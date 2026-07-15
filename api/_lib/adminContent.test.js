import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const storageFrom = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc, storage: { from: storageFrom } } }))
vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin: vi.fn(),
  statusForAuthError: vi.fn(error => error === 'Forbidden.' ? 403 : 401),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

const { default: handler } = await import('../admin/event.js')

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'

function request(method, resource, body = undefined, query = {}) {
  return {
    method,
    query: { resource, ...query },
    headers: { authorization: 'Bearer test' },
    body,
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('admin content service boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    from.mockReset()
    storageFrom.mockReset()
    verifyCommittee.mockResolvedValue({ user: { id: ACTOR_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    rpc.mockResolvedValue({ data: { record: { id: 'saved' } }, error: null })
  })

  it('saves event metadata and placings through one actor-attributed RPC', async () => {
    const res = response()
    await handler(request('POST', 'history-content', {
      entity: 'event',
      data: {
        year: 2027,
        name: '  ZLTAC 2027  ',
        start_date: '2027-05-01',
        end_date: '2027-05-03',
        internal_notes: ' Committee only ',
      },
      placings: [
        { division: 'team', rank: 1, name: ' Alpha ', subtitle: '' },
      ],
    }), res)

    expect(res.statusCode).toBe(201)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_mutate_content', {
      p_actor_id: ACTOR_ID,
      p_entity: 'event',
      p_action: 'create',
      p_record_id: null,
      p_data: {
        year: 2027,
        name: 'ZLTAC 2027',
        start_date: '2027-05-01',
        end_date: '2027-05-03',
        internal_notes: 'Committee only',
      },
      p_placings: [
        { division: 'team', rank: 1, name: 'Alpha', subtitle: null },
      ],
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('issues an exact-path signed upload only for an existing committee asset target', async () => {
    from.mockImplementation(table => {
      expect(table).toBe('zltac_events')
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: '22222222-2222-4222-8222-222222222222', status: 'draft' },
              error: null,
            }),
          })),
        })),
      }
    })
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { token: 'single-object-token' },
      error: null,
    })
    storageFrom.mockReturnValue({ createSignedUploadUrl })
    const res = response()

    await handler(request('POST', 'asset-upload', {
      action: 'issue',
      purpose: 'event-cover',
      scopeId: '22222222-2222-4222-8222-222222222222',
      contentType: 'image/webp',
      sizeBytes: 1024,
    }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body).toMatchObject({
      bucket: 'event-covers',
      token: 'single-object-token',
      url: expect.stringMatching(/^\/assets\/event-covers\//),
    })
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^22222222-2222-4222-8222-222222222222\/covers\/[0-9a-f-]+\.webp$/),
      { upsert: false },
    )
  })

  it('finalizes an exact-path upload only after Storage metadata verification and audit recording', async () => {
    const scopeId = '22222222-2222-4222-8222-222222222222'
    const path = `${scopeId}/covers/33333333-3333-4333-8333-333333333333.webp`
    const upsert = vi.fn().mockResolvedValue({ error: null })
    from.mockImplementation(table => {
      if (table === 'zltac_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: scopeId, status: 'draft' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'admin_asset_upload_audit') return { upsert }
      throw new Error(`unexpected read from ${table}`)
    })
    const info = vi.fn().mockResolvedValue({
      data: { size: 1024, contentType: 'image/webp', bucketId: 'event-covers' },
      error: null,
    })
    storageFrom.mockReturnValue({ info })
    const res = response()

    await handler(request('POST', 'asset-upload', {
      action: 'finalize',
      purpose: 'event-cover',
      scopeId,
      contentType: 'image/webp',
      sizeBytes: 1024,
      bucket: 'event-covers',
      path,
    }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({
      bucket: 'event-covers',
      path,
      url: `/assets/event-covers/${path}`,
      contentType: 'image/webp',
      sizeBytes: 1024,
    })
    expect(storageFrom).toHaveBeenCalledWith('event-covers')
    expect(info).toHaveBeenCalledWith(path)
    expect(upsert).toHaveBeenCalledWith({
      actor_id: ACTOR_ID,
      purpose: 'event-cover',
      scope_id: scopeId,
      bucket: 'event-covers',
      object_path: path,
      object_size: 1024,
      content_type: 'image/webp',
    }, {
      onConflict: 'bucket,object_path',
      ignoreDuplicates: true,
    })
  })

  it('rejects a raw storage document URL before calling the database', async () => {
    const res = response()
    await handler(request('POST', 'document-content', {
      entity: 'document',
      data: {
        scope: 'alsa',
        name: 'Policy',
        url: 'https://example.supabase.co/storage/v1/object/public/docs/policy.pdf',
      },
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/branded public asset path/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects normalized invalid dates and invalid dynasty year sequences', async () => {
    const invalidDate = response()
    await handler(request('POST', 'history-content', {
      entity: 'event',
      data: { year: 2027, name: 'ZLTAC 2027', start_date: '2027-02-31' },
    }), invalidDate)
    expect(invalidDate.statusCode).toBe(400)
    expect(invalidDate.body.error).toMatch(/valid date/i)

    const invalidDynasty = response()
    await handler(request('POST', 'history-content', {
      entity: 'dynasty',
      data: {
        team_name: 'Example',
        category: 'three_peat',
        years: [2024, 2025, 2027],
      },
    }), invalidDynasty)
    expect(invalidDynasty.statusCode).toBe(400)
    expect(invalidDynasty.body.error).toMatch(/exactly 3 consecutive years/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('serves full answer data only after committee authentication', async () => {
    const questions = [{ id: 'q1', question: 'Question?', correct_answer: 'c' }]
    from.mockImplementation(table => {
      if (table === 'referee_questions') {
        return {
          select: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: questions, error: null }),
          })),
        }
      }
      if (table === 'referee_test_settings') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 1, general_pass_score: 70 },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const allowed = response()
    await handler(request('GET', 'referee-content'), allowed)
    expect(allowed.body.questions).toEqual(questions)
    expect(allowed.body.questions[0].correct_answer).toBe('c')

    verifyCommittee.mockResolvedValueOnce({ user: null, error: 'Forbidden.' })
    from.mockClear()
    const denied = response()
    await handler(request('GET', 'referee-content'), denied)
    expect(denied.statusCode).toBe(403)
    expect(denied.body).toEqual({ error: 'Forbidden.' })
    expect(from).not.toHaveBeenCalled()
  })

  it('returns history records with server-derived placing counts', async () => {
    from.mockImplementation(table => {
      if (table === 'zltac_event_history') {
        return {
          select: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'event-1', year: 2026, internal_notes: 'committee' },
                { id: 'event-2', year: 2025, internal_notes: null },
              ],
              error: null,
            }),
          })),
        }
      }
      if (table === 'zltac_event_placings') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                { tournament_year: 2026 },
                { tournament_year: 2026 },
                { tournament_year: 2025 },
              ],
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const res = response()
    await handler(request('GET', 'history-content', undefined, { entity: 'event' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.records).toEqual([
      { id: 'event-1', year: 2026, internal_notes: 'committee', placing_count: 2 },
      { id: 'event-2', year: 2025, internal_notes: null, placing_count: 1 },
    ])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects unsupported methods for singleton settings', async () => {
    const res = response()
    await handler(request('PATCH', 'referee-content', {
      entity: 'settings',
      data: {
        safety_questions_per_test: 10,
        safety_pass_score: 100,
        general_questions_per_test: 20,
        general_pass_score: 70,
      },
    }), res)

    expect(res.statusCode).toBe(405)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects caller-supplied audit record ids and unsupported request fields', async () => {
    const suppliedId = '22222222-2222-4222-8222-222222222222'
    const withId = response()
    await handler(request('POST', 'site-banner', {
      entity: 'banner',
      id: suppliedId,
      data: { enabled: true, message: 'Testing in progress' },
    }), withId)
    expect(withId.statusCode).toBe(400)
    expect(withId.body.error).toMatch(/id is not valid/i)

    const withActor = response()
    await handler(request('POST', 'site-banner', {
      entity: 'banner',
      actor_id: suppliedId,
      data: { enabled: true, message: 'Testing in progress' },
    }), withActor)
    expect(withActor.statusCode).toBe(400)
    expect(withActor.body.error).toMatch(/unsupported fields/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects misleading delete data and placings on non-event entities', async () => {
    const questionId = '22222222-2222-4222-8222-222222222222'
    const deleteWithData = response()
    await handler(request('DELETE', 'referee-content', {
      entity: 'question',
      id: questionId,
      data: { active: false },
    }), deleteWithData)
    expect(deleteWithData.statusCode).toBe(400)
    expect(deleteWithData.body.error).toMatch(/DELETE data must be an empty object/)

    const categoryWithPlacings = response()
    await handler(request('POST', 'document-content', {
      entity: 'category',
      data: { scope: 'alsa', name: 'Policies' },
      placings: [],
    }), categoryWithPlacings)
    expect(categoryWithPlacings.statusCode).toBe(400)
    expect(categoryWithPlacings.body.error).toMatch(/only valid for event content/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not disclose unexpected database errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'private table and policy detail' },
    })
    const res = response()
    await handler(request('POST', 'site-banner', {
      entity: 'banner',
      data: { enabled: true, message: 'Testing in progress' },
    }), res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(res.body)).not.toContain('private table')
    consoleError.mockRestore()
  })

  it('maps defensive PostgreSQL date errors to a safe client error', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22008', message: 'date/time field value out of range: private input' },
    })
    const res = response()
    await handler(request('POST', 'history-content', {
      entity: 'event',
      data: { year: 2027, name: 'ZLTAC 2027' },
    }), res)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'The content request is invalid.' })
    expect(JSON.stringify(res.body)).not.toContain('private input')
  })
})
