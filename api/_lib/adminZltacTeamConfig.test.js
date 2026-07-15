import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const verifyCommittee = vi.fn()
const verifySuperAdmin = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({ default: { from, rpc } }))
vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin,
  statusForAuthError: vi.fn(() => 401),
}))
vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

const { default: handler } = await import('../admin/event.js')

const ACTOR_ID = '123e4567-e89b-42d3-a456-426614174001'
const TEAM_ID = '123e4567-e89b-42d3-a456-426614174002'
const CAPTAIN_ID = '123e4567-e89b-42d3-a456-426614174003'

function req(resource, method, body) {
  return {
    method,
    query: { resource },
    headers: { authorization: 'Bearer committee-token' },
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

describe('committee ZLTAC team configuration boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: ACTOR_ID }, error: null })
    verifySuperAdmin.mockResolvedValue({ user: { id: ACTOR_ID }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  it('moves captain/team settings through the event-first RPC', async () => {
    const updated = { id: TEAM_ID, captain_id: CAPTAIN_ID, status: 'draft' }
    rpc.mockResolvedValueOnce({ data: updated, error: null })

    const response = res()
    await handler(req('team-settings', 'PATCH', {
      teamId: TEAM_ID,
      captain_id: CAPTAIN_ID,
      name: 'Atomic Team',
    }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, team: updated })
    expect(rpc).toHaveBeenCalledWith('committee_update_zltac_team', {
      p_actor_id: ACTOR_ID,
      p_team_id: TEAM_ID,
      p_changes: { captain_id: CAPTAIN_ID, name: 'Atomic Team' },
      p_mode: 'settings',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('reviews status through the same locked RPC', async () => {
    rpc.mockResolvedValueOnce({ data: { id: TEAM_ID, status: 'approved' }, error: null })

    const response = res()
    await handler(req('team-review', 'POST', { teamId: TEAM_ID, action: 'approve' }), response)

    expect(response.body).toEqual({ ok: true, status: 'approved' })
    expect(rpc).toHaveBeenCalledWith('committee_update_zltac_team', {
      p_actor_id: ACTOR_ID,
      p_team_id: TEAM_ID,
      p_changes: { status: 'approved', rejection_reason: null },
      p_mode: 'review',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects status changes through generic team settings', async () => {
    const response = res()
    await handler(req('team-settings', 'PATCH', {
      teamId: TEAM_ID,
      status: 'approved',
    }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(/dedicated review action/i)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('maps closed or archived event denial without a fallback write', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: 'Archived event teams are immutable.' },
    })

    const response = res()
    await handler(req('team-settings', 'PATCH', {
      teamId: TEAM_ID,
      name: 'Late Edit',
    }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/immutable/i)
    expect(from).not.toHaveBeenCalled()
  })

  it('does not expose unexpected database failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'sensitive database detail' },
    })

    const response = res()
    await handler(req('team-settings', 'PATCH', {
      teamId: TEAM_ID,
      name: 'Atomic Team',
    }), response)

    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual({ error: 'Internal server error' })
    consoleError.mockRestore()
  })
})
