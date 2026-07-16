import { sendServerError } from './apiErrors.js'

const BAD_REQUEST_CODES = new Set(['22007', '22023', '22P02', '23514'])
const CONFLICT_CODES = new Set(['23503', '23505', '55000'])

export function competitionRpcErrorResponse(error) {
  const code = error?.code
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : null

  if (BAD_REQUEST_CODES.has(code)) {
    return { status: 400, error: message ?? 'Invalid competition request.' }
  }
  if (code === '42501') {
    return { status: 403, error: message ?? 'Not authorised.' }
  }
  if (code === 'P0002') {
    return { status: 404, error: message ?? 'Competition record not found.' }
  }
  if (CONFLICT_CODES.has(code)) {
    return { status: 409, error: message ?? 'Competition state has changed. Refresh and try again.' }
  }
  return null
}

export function sendCompetitionRpcError(res, error, context) {
  const mapped = competitionRpcErrorResponse(error)
  if (!mapped) return sendServerError(res, error, context)
  return res.status(mapped.status).json({ error: mapped.error })
}
