import { describe, expect, it, vi } from 'vitest'
import { competitionRpcErrorResponse, sendCompetitionRpcError } from './competitionLifecycle.js'

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('competition RPC error mapping', () => {
  it('preserves validation, authorisation, not-found, and conflict semantics', () => {
    expect(competitionRpcErrorResponse({ code: '22023', message: 'bad colour' })).toEqual({
      status: 400,
      error: 'bad colour',
    })
    expect(competitionRpcErrorResponse({ code: '42501', message: 'captain only' }).status).toBe(403)
    expect(competitionRpcErrorResponse({ code: 'P0002', message: 'team missing' }).status).toBe(404)
    expect(competitionRpcErrorResponse({ code: '23505', message: 'already accepted' }).status).toBe(409)
    expect(competitionRpcErrorResponse({ code: '55000', message: 'registration closed' }).status).toBe(409)
  })

  it('does not expose unknown database failures', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = res()
      sendCompetitionRpcError(
        response,
        { code: 'XX000', message: 'secret relation detail' },
        'competition-test',
      )
      expect(response.statusCode).toBe(500)
      expect(response.body).toEqual({ error: 'Internal server error' })
      expect(logged).toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })
})
