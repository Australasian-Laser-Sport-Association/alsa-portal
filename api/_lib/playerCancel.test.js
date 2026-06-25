import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const verifyUser = vi.fn()
const enforceRateLimit = vi.fn()
const cleanupFormerSideEventMembers = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from },
}))

vi.mock('./auth.js', () => ({
  verifyUser,
  getActiveEventYear: vi.fn(),
}))

vi.mock('./rateLimit.js', () => ({
  enforceRateLimit,
}))

vi.mock('./eventPhase.js', () => ({
  requireOpenPhase: vi.fn(() => Promise.resolve({ ok: true })),
  getEventPhase: vi.fn(() => Promise.resolve({ phase: 'open' })),
}))

vi.mock('./sideEventCleanup.js', () => ({
  cleanupFormerSideEventMember: vi.fn(),
  cleanupFormerSideEventMembers,
  ensureSideEventMember: vi.fn(),
}))

vi.mock('./computeAmountOwing.js', () => ({
  computeAndWriteAmountOwing: vi.fn(),
}))

vi.mock('./placeholders.js', () => ({
  anyPlaceholder: vi.fn(),
}))

const { default: handler } = await import('../player.js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'

function selectMaybeSingle(data) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
        })),
        maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
      })),
    })),
  }
}

function deleteEq() {
  return {
    delete: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ error: null })),
    })),
  }
}

function sideEventRows(rows) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        or: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      })),
    })),
    delete: vi.fn(() => ({
      in: vi.fn(() => Promise.resolve({ error: null })),
    })),
  }
}

function req() {
  return {
    method: 'POST',
    query: { resource: 'registration' },
    headers: { authorization: 'Bearer test-token' },
    body: { action: 'cancel', year: 2026 },
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

describe('player registration cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({ user: { id: USER_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
    cleanupFormerSideEventMembers.mockResolvedValue([])
  })

  it('batch-cleans former doubles and triples partners after deleting side-event rows', async () => {
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') {
        return from.mock.calls.filter(([name]) => name === 'zltac_registrations').length === 1
          ? selectMaybeSingle({ id: 'reg-1', team_id: null })
          : deleteEq()
      }
      if (table === 'doubles_pairs') {
        return sideEventRows([
          { id: 'double-1', player1_id: USER_ID, player2_id: 'partner-double' },
        ])
      }
      if (table === 'triples_teams') {
        return sideEventRows([
          { id: 'triple-1', player1_id: USER_ID, player2_id: 'partner-triple-a', player3_id: 'partner-triple-b' },
        ])
      }
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(req(), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true })
    expect(cleanupFormerSideEventMembers).toHaveBeenCalledTimes(2)
    expect(cleanupFormerSideEventMembers).toHaveBeenCalledWith(expect.objectContaining({
      table: 'doubles_pairs',
      slug: 'doubles',
      memberIds: ['partner-double'],
      eventYear: 2026,
    }))
    expect(cleanupFormerSideEventMembers).toHaveBeenCalledWith(expect.objectContaining({
      table: 'triples_teams',
      slug: 'triples',
      memberIds: expect.arrayContaining(['partner-triple-a', 'partner-triple-b']),
      eventYear: 2026,
    }))
  })
})
