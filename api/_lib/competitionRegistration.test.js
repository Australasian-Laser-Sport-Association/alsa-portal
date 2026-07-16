import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyUser = vi.fn()
const verifySuperAdmin = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc },
}))

vi.mock('./auth.js', () => ({
  verifyUser,
  verifySuperAdmin,
  statusForAuthError: vi.fn(error => (error === 'Unauthorized' ? 401 : 403)),
}))

vi.mock('./computeCompetitionAmountPaid.js', () => ({
  computeCompetitionAmountPaid: vi.fn(),
}))

const { default: handler } = await import('../superadmin/[resource].js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const COMPETITION_ID = '223e4567-e89b-42d3-a456-426614174000'

function req(body = { competition_id: COMPETITION_ID }) {
  return {
    method: 'POST',
    query: { resource: 'competition-registration' },
    headers: { authorization: 'Bearer player-token' },
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

function registrationsQuery() {
  const registration = {
    id: 'reg-1',
    competition_id: COMPETITION_ID,
    user_id: USER_ID,
    competition: { id: COMPETITION_ID, slug: 'side-comp', name: 'Side Comp' },
  }
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: registration, error: null })),
        })),
      })),
    })),
  }
}

describe('competition self-registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyUser.mockResolvedValue({
      user: { id: USER_ID },
      profile: { roles: ['player'], suspended: false },
      roles: ['player'],
      error: null,
    })
    rpc.mockResolvedValue({ data: { registration_id: 'reg-1' }, error: null })
  })

  it('allows a plain authenticated player to register themselves', async () => {
    const regQuery = registrationsQuery()
    from.mockImplementation(table => {
      if (table === 'competition_registrations') return regQuery
      throw new Error(`unexpected table ${table}`)
    })

    const response = res()
    await handler(req(), response)

    expect(response.statusCode).toBe(201)
    expect(response.body).toMatchObject({
      competition_id: COMPETITION_ID,
      user_id: USER_ID,
    })
    expect(verifyUser).toHaveBeenCalledTimes(1)
    expect(verifySuperAdmin).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('register_for_competition', {
      p_user_id: USER_ID,
      p_competition_id: COMPETITION_ID,
    })
  })

  it('returns a conflict when the locked database workflow says registration is closed', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'Registration has closed for this competition.' },
    })

    const response = res()
    await handler(req(), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/closed/i)
    expect(from).not.toHaveBeenCalled()
  })
})
