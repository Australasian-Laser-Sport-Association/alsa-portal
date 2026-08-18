import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc },
}))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin: vi.fn(),
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

const { default: handler } = await import('../admin/event.js')

function req(year = '2027') {
  return {
    method: 'GET',
    query: { resource: 'emergency-contacts', year },
    headers: {},
  }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function contactQuery(data, error = null) {
  const query = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.neq = vi.fn(() => query)
  query.order = vi.fn(() => Promise.resolve({ data, error }))
  return query
}

describe('admin event emergency-contacts resource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: 'committee-1' }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('returns all active registrations with only emergency roster details', async () => {
    const contacts = [{
      id: 'reg-1',
      user_id: 'user-1',
      year: 2027,
      status: 'registered',
      emergency_contact_name: 'Event Helper',
      emergency_contact_phone: '0400 123 456',
      profiles: { first_name: 'Alex', last_name: 'Player', alias: 'Photon' },
      teams: { name: 'Team Green' },
    }]
    const query = contactQuery(contacts)
    from.mockReturnValueOnce(query)

    const response = res()
    await handler(req(), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ contacts })
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(verifyCommittee).toHaveBeenCalled()
    expect(from).toHaveBeenCalledWith('zltac_registrations')
    expect(query.select).toHaveBeenCalledWith(
      'id, user_id, year, status, emergency_contact_name, emergency_contact_phone, profiles:user_id(first_name, last_name, alias), teams:team_id(name)',
    )
    expect(query.eq).toHaveBeenCalledWith('year', 2027)
    expect(query.neq).toHaveBeenCalledWith('status', 'cancelled')
  })

  it('rejects invalid years before reading registrations', async () => {
    const response = res()
    await handler(req('not-a-year'), response)

    expect(response.statusCode).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })
})
