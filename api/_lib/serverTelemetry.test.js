import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const waitUntil = vi.fn()

vi.mock('@vercel/functions', () => ({ waitUntil }))

const originalNodeEnv = process.env.NODE_ENV
const originalSentryDsn = process.env.SENTRY_DSN
const originalBrowserSentryDsn = process.env.VITE_SENTRY_DSN
const originalFetch = globalThis.fetch

describe('server telemetry delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NODE_ENV = 'production'
    process.env.SENTRY_DSN = 'https://public-key@errors.example.test/123'
    delete process.env.VITE_SENTRY_DSN
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalSentryDsn === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = originalSentryDsn
    if (originalBrowserSentryDsn === undefined) delete process.env.VITE_SENTRY_DSN
    else process.env.VITE_SENTRY_DSN = originalBrowserSentryDsn
    globalThis.fetch = originalFetch
  })

  it('registers Sentry delivery with the Vercel request lifecycle', async () => {
    const { captureServerException } = await import('./serverTelemetry.js')

    captureServerException(new Error('controlled failure'), 'test-context', { safe: true })

    expect(waitUntil).toHaveBeenCalledTimes(1)
    const delivery = waitUntil.mock.calls[0][0]
    expect(delivery).toBeInstanceOf(Promise)
    await delivery

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('https://errors.example.test/api/123/envelope/')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/x-sentry-envelope')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('does nothing when no Sentry DSN is configured', async () => {
    delete process.env.SENTRY_DSN
    delete process.env.VITE_SENTRY_DSN
    const { captureServerException } = await import('./serverTelemetry.js')

    captureServerException(new Error('not delivered'))

    expect(waitUntil).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does not send telemetry during tests', async () => {
    process.env.NODE_ENV = 'test'
    const { captureServerException } = await import('./serverTelemetry.js')

    captureServerException(new Error('test failure'))

    expect(waitUntil).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('contains provider rejection inside the tracked delivery', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch.mockResolvedValue({ ok: false, status: 429 })
    const { captureServerException } = await import('./serverTelemetry.js')

    captureServerException(new Error('controlled rejection'))
    await waitUntil.mock.calls[0][0]

    expect(consoleError).toHaveBeenCalledWith(
      '[server-telemetry] failed to send Sentry event:',
      'Sentry rejected the event with HTTP 429',
    )
    consoleError.mockRestore()
  })
})
