import { describe, expect, it, vi } from 'vitest'
import { sendServerError } from './apiErrors.js'

describe('api error responses', () => {
  it('logs server details but returns a generic response body', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this },
      json(body) { this.body = body; return this },
    }

    try {
      sendServerError(res, { message: 'relation secret_table does not exist' }, 'test-route')
      expect(res.statusCode).toBe(500)
      expect(res.body).toEqual({ error: 'Internal server error' })
      expect(logged).toHaveBeenCalledWith('[test-route]', 'relation secret_table does not exist')
    } finally {
      logged.mockRestore()
    }
  })
})
