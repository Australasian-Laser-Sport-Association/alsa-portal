import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const storageFrom = vi.fn()
const generateBackupCsvs = vi.fn()
const verifyCommittee = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from, rpc, storage: { from: storageFrom } },
}))

vi.mock('../../src/lib/backup/generateBackupCsvs.js', () => ({ generateBackupCsvs }))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin: vi.fn(),
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./rateLimit.js', () => ({ enforceRateLimit }))

const { default: handler } = await import('../admin/event.js')

function request(method, authorization) {
  return {
    method,
    query: { resource: 'backup-run' },
    headers: authorization ? { authorization } : {},
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('backup-run route authentication and methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    from.mockReset()
    rpc.mockReset()
    storageFrom.mockReset()
    generateBackupCsvs.mockReset()
    process.env.CRON_SECRET = 'test-cron-secret'
    verifyCommittee.mockResolvedValue({ user: { id: 'committee-1' }, error: null })
    enforceRateLimit.mockResolvedValue(true)
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('accepts an authenticated Vercel cron GET and applies the schedule', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        frequency: 'off',
        weekly_day: 0,
        recipient_emails: [],
        last_backup_at: null,
        last_backup_status: null,
      },
      error: null,
    })
    const eqAfterSelect = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq: eqAfterSelect }))
    const eqAfterUpdate = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq: eqAfterUpdate }))
    from.mockReturnValue({ select, update })

    const res = response()
    await handler(request('GET', 'Bearer test-cron-secret'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, skipped: 'disabled' })
    expect(verifyCommittee).not.toHaveBeenCalled()
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.any(Object), res, {
      identifier: 'cron-backup-run',
      limit: 2,
      window: '1 d',
      prefix: 'cron-backup-run',
      requireDistributed: true,
    })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      last_backup_status: expect.stringContaining('frequency is off'),
    }))
  })

  it('rejects a cron GET with missing or invalid credentials', async () => {
    const invalid = response()
    await handler(request('GET', 'Bearer wrong'), invalid)
    expect(invalid.statusCode).toBe(401)

    delete process.env.CRON_SECRET
    const unconfigured = response()
    await handler(request('GET'), unconfigured)
    expect(unconfigured.statusCode).toBe(503)
    expect(from).not.toHaveBeenCalled()
    expect(enforceRateLimit).not.toHaveBeenCalled()
  })

  it('returns the cron limiter response before reading settings or acquiring a lease', async () => {
    enforceRateLimit.mockImplementationOnce(async (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Please try again later.' })
      return false
    })

    const res = response()
    await handler(request('GET', 'Bearer test-cron-secret'), res)

    expect(res.statusCode).toBe(429)
    expect(res.body).toEqual({ error: 'Too many requests. Please try again later.' })
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps manual POST behind committee authentication', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'query failed' } })
    from.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })

    const req = request('POST')
    const res = response()
    await handler(req, res)

    expect(verifyCommittee).toHaveBeenCalledTimes(1)
    expect(enforceRateLimit).toHaveBeenCalledTimes(1)
    expect(enforceRateLimit).toHaveBeenCalledWith(req, res, {
      identifier: 'portal-backup-run',
      limit: 2,
      window: '1 h',
      prefix: 'admin-backup-run',
      requireDistributed: true,
    })
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(res.body)).not.toContain('query failed')
    consoleError.mockRestore()
  })

  it('returns the distributed limiter response before starting a backup', async () => {
    enforceRateLimit.mockImplementationOnce(async (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Please try again later.' })
      return false
    })

    const res = response()
    await handler(request('POST'), res)

    expect(res.statusCode).toBe(429)
    expect(res.body).toEqual({ error: 'Too many requests. Please try again later.' })
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns a safe conflict when another backup owns the database lease', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 1,
        frequency: 'daily',
        weekly_day: 0,
        recipient_emails: [],
        last_backup_at: null,
        last_backup_status: null,
      },
      error: null,
    })
    const eq = vi.fn(() => ({ maybeSingle }))
    from.mockReturnValue({ select: vi.fn(() => ({ eq })) })
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: '55P03',
        hint: 'BACKUP_ALREADY_RUNNING',
        message: 'database details must not be returned',
      },
    })

    const res = response()
    await handler(request('POST'), res)

    expect(rpc).toHaveBeenCalledWith('begin_portal_backup_run', {
      p_run_id: expect.any(String),
      p_object_prefix: expect.any(String),
      p_triggered_by: 'committee-1',
    })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({
      error: 'A portal backup is already running. Wait for it to finish before starting another.',
      code: 'BACKUP_ALREADY_RUNNING',
    })
    expect(JSON.stringify(res.body)).not.toContain('database details')
  })

  it('retains attempted object paths when partial-upload cleanup is unconfirmed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const settings = {
      id: 1,
      frequency: 'daily',
      weekly_day: 0,
      recipient_emails: [],
      last_backup_at: null,
      last_backup_status: null,
    }
    const settingsTable = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: settings, error: null }) })),
      })),
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    }
    const failedQuery = {}
    failedQuery.eq = vi.fn(() => failedQuery)
    failedQuery.not = vi.fn(() => failedQuery)
    failedQuery.limit = vi.fn().mockResolvedValue({ data: [], error: null })
    const backupRunsTable = {
      select: vi.fn(() => failedQuery),
      update: vi.fn(payload => {
        const stageQuery = {}
        stageQuery.eq = vi.fn(() => stageQuery)
        stageQuery.select = vi.fn(() => stageQuery)
        stageQuery.maybeSingle = vi.fn().mockResolvedValue({
          data: { status: 'running', object_paths: payload.object_paths },
          error: null,
        })
        return stageQuery
      }),
    }
    from.mockImplementation(table => (
      table === 'backup_settings' ? settingsTable : backupRunsTable
    ))
    rpc
      .mockResolvedValueOnce({ data: { status: 'running' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'failed' }, error: null })
    generateBackupCsvs.mockResolvedValue({
      registrationsCsv: 'id,name\n1,Ada\n',
      paymentsCsv: 'id,amount\n1,100\n',
      eventsCsv: 'id,year\n1,2026\n',
      assetUploadAuditCsv: 'id,purpose\n1,event-logo\n',
      registrationsCount: 1,
      paymentsCount: 1,
      eventsCount: 1,
      assetUploadAuditCount: 1,
      eventBreakdown: [],
    })
    const upload = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error('upload failed') })
      .mockResolvedValue({ error: null })
    const remove = vi.fn().mockResolvedValue({ error: new Error('cleanup unavailable') })
    storageFrom.mockReturnValue({ upload, remove })

    const res = response()
    await handler(request('POST'), res)

    const prefix = rpc.mock.calls[0][1].p_object_prefix
    const attemptedPaths = [
      'registrations.csv',
      'payments.csv',
      'events.csv',
      'admin-asset-upload-audit.csv',
      'manifest.json',
    ].map(name => `${prefix}/${name}`)
    expect(remove).toHaveBeenCalledWith(attemptedPaths)
    expect(rpc.mock.calls[1]).toEqual([
      'finish_portal_backup_run',
      expect.objectContaining({
        p_status: 'failed',
        p_object_paths: attemptedPaths,
      }),
    ])
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    consoleError.mockRestore()
  })
})
