import { captureServerException } from './serverTelemetry.js'

export function sendServerError(res, error, context = 'api') {
  const message = error?.message ?? error ?? 'Unknown error'
  console.error(`[${context}]`, message)
  captureServerException(error, context)
  return res.status(500).json({ error: 'Internal server error' })
}
