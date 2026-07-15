import { randomUUID } from 'node:crypto'
import { waitUntil } from '@vercel/functions'

let lastWarnAt = 0

function sentryDsn() {
  return process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN || ''
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      type: error.name || 'Error',
      value: error.message,
      stacktrace: error.stack
        ? { frames: error.stack.split('\n').slice(1).map(line => ({ function: line.trim() })).reverse() }
        : undefined,
    }
  }

  return {
    type: 'Error',
    value: typeof error === 'string' ? error : JSON.stringify(error ?? 'Unknown error'),
  }
}

function parseDsn(dsn) {
  try {
    const url = new URL(dsn)
    const projectId = url.pathname.replace(/^\/+/, '')
    if (!projectId) return null
    return {
      key: url.username,
      host: url.host,
      projectId,
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    }
  } catch {
    return null
  }
}

async function sendSentryEnvelope(error, context, extra = {}) {
  const dsn = sentryDsn()
  if (!dsn) return

  const parsed = parseDsn(dsn)
  if (!parsed?.key) return

  const eventId = randomUUID().replace(/-/g, '')
  const now = new Date().toISOString()
  const exception = normalizeError(error)
  const event = {
    event_id: eventId,
    timestamp: now,
    platform: 'javascript',
    level: 'error',
    logger: 'alsa-portal-api',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    server_name: process.env.VERCEL_URL || 'local',
    tags: { context },
    extra,
    exception: { values: [exception] },
  }

  const envelope = [
    JSON.stringify({ event_id: eventId, dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n')

  const response = await fetch(parsed.envelopeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=alsa-portal-api/1.0`,
    },
    body: envelope,
    signal: AbortSignal.timeout(3_000),
  })
  if (!response.ok) {
    throw new Error(`Sentry rejected the event with HTTP ${response.status}`)
  }
}

export function captureServerException(error, context = 'api', extra = {}) {
  if (process.env.NODE_ENV === 'test') return
  const dsn = sentryDsn()
  if (!dsn) return

  const delivery = sendSentryEnvelope(error, context, extra).catch(err => {
    const now = Date.now()
    if (now - lastWarnAt < 60_000) return
    lastWarnAt = now
    console.error('[server-telemetry] failed to send Sentry event:', err?.message || err)
  })

  // Vercel may freeze an invocation as soon as its response completes.
  // waitUntil registers this non-critical delivery with the request lifecycle;
  // outside Vercel it safely returns while the promise continues normally.
  waitUntil(delivery)
}
