import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const verifyCommittee = vi.fn()
const verifySuperAdmin = vi.fn()
const deleteUser = vi.fn()
const updateUserById = vi.fn()
const rpc = vi.fn()
const setUserSuspension = vi.fn()
const readAuthSuspensionState = vi.fn()
const authBanDurationForState = vi.fn()
const captureServerException = vi.fn()
const acquireAccountAccessLock = vi.fn()
const createAccountAccessLockGuard = vi.fn()
const isAccountAccessLockSafetyError = vi.fn()
const releaseAccountAccessLock = vi.fn()
const canonicalizeAccountAccessTargetId = vi.fn(value => {
  if (typeof value !== 'string') return null
  const canonical = value.trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(canonical)
    ? canonical
    : null
})
const guardRun = vi.fn()
const guardFinish = vi.fn()
const ACCESS_LOCK = {
  acquired: true,
  backend: 'test',
  key: 'lock',
  token: 'token',
  ttlMs: 120_000,
}
const ACCESS_GUARD = { run: guardRun, finish: guardFinish }
const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PLACEHOLDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TEST_QUERY_IDS = {
  'user-1': TARGET_ID,
  'placeholder-1': PLACEHOLDER_ID,
}

vi.mock('./supabase.js', () => ({
  default: { from, rpc, auth: { admin: { deleteUser, updateUserById } } },
}))

vi.mock('./auth.js', () => ({
  verifyCommittee,
  verifySuperAdmin,
  statusForAuthError: vi.fn(() => 401),
}))

vi.mock('./suspension.js', () => ({
  PERMANENT_BAN: '876000h',
  authBanDurationForState,
  readAuthSuspensionState,
  setUserSuspension,
}))

vi.mock('./serverTelemetry.js', () => ({ captureServerException }))

vi.mock('./accountAccessLock.js', () => ({
  acquireAccountAccessLock,
  canonicalizeAccountAccessTargetId,
  createAccountAccessLockGuard,
  isAccountAccessLockSafetyError,
  releaseAccountAccessLock,
}))

vi.mock('./profileChanges.js', () => ({
  changeProfileAlias: vi.fn(),
}))

const { default: handler } = await import('../admin/users.js')

function queryResult(result) {
  const query = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    eq: vi.fn(() => query),
    neq: vi.fn(() => query),
    in: vi.fn(() => query),
    contains: vi.fn(() => query),
    overlaps: vi.fn(() => query),
    or: vi.fn(() => query),
    not: vi.fn(() => query),
    update: vi.fn(() => query),
    delete: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then(resolve) {
      return Promise.resolve(result).then(resolve)
    },
  }
  return query
}

function req(query = {}, method = 'GET', body = {}) {
  const normalizedQuery = query.id
    ? { ...query, id: TEST_QUERY_IDS[query.id] ?? query.id }
    : query
  return { method, query: normalizedQuery, headers: {}, body }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function removeAccessProfile(overrides = {}) {
  return {
    is_placeholder: false,
    first_name: 'Ada',
    last_name: 'Player',
    alias: 'AdaPlayer',
    dob: '1990-01-01',
    state: 'NSW',
    home_arena: 'Arena',
    phone: '0400000000',
    emergency_contact_name: 'Grace',
    emergency_contact_phone: '0400000001',
    alsa_member_id: 'ALSA-1',
    avatar_url: 'avatars/ada.png',
    placeholder_email: null,
    email: 'ada@example.test',
    alsa_position: 'Member',
    roles: ['player'],
    suspended: false,
    access_revoked_at: null,
    access_revoked_by: null,
    ...overrides,
  }
}

function committedRemoveAccessProfile() {
  return removeAccessProfile({
    first_name: null,
    last_name: null,
    alias: null,
    dob: null,
    state: null,
    home_arena: null,
    phone: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    alsa_member_id: null,
    avatar_url: null,
    placeholder_email: null,
    email: null,
    alsa_position: null,
    roles: ['player'],
    suspended: true,
    access_revoked_at: '2026-07-14T00:00:00.000Z',
    access_revoked_by: 'committee-1',
  })
}

describe('admin users list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyCommittee.mockResolvedValue({ user: { id: 'committee-1' }, error: null })
    verifySuperAdmin.mockResolvedValue({ user: { id: 'superadmin-1' }, error: null })
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    setUserSuspension.mockResolvedValue({ error: null })
    readAuthSuspensionState.mockResolvedValue({
      exists: true,
      suspended: false,
      bannedUntil: null,
      error: null,
    })
    authBanDurationForState.mockImplementation(state => state?.suspended ? 'prior-ban' : 'none')
    updateUserById.mockResolvedValue({ error: null })
    acquireAccountAccessLock.mockResolvedValue(ACCESS_LOCK)
    createAccountAccessLockGuard.mockReturnValue(ACCESS_GUARD)
    isAccountAccessLockSafetyError.mockImplementation(error => (
      error?.code === 'ACCOUNT_ACCESS_LOCK_LOST'
      || error?.code === 'ACCOUNT_ACCESS_OPERATION_TIMEOUT'
    ))
    guardRun.mockImplementation((_label, operation) => operation())
    guardFinish.mockResolvedValue({
      safeToRelease: true,
      lost: false,
      timedOut: false,
      error: null,
    })
    releaseAccountAccessLock.mockResolvedValue({ released: true, lost: false, error: null })
  })

  it('returns one paginated page and enriches only those users', async () => {
    const profilesQuery = queryResult({
      data: [
        { id: 'user-1', roles: ['player'], created_at: '2026-01-02' },
        { id: 'user-2', roles: ['player'], created_at: '2026-01-01' },
      ],
      error: null,
      count: 125,
    })
    const regsQuery = queryResult({ data: [{ user_id: 'user-1', year: 2026 }], error: null })
    const teamsQuery = queryResult({ data: [{ id: 'team-1', name: 'Alpha', captain_id: 'user-2' }], error: null })
    from
      .mockReturnValueOnce(profilesQuery)
      .mockReturnValueOnce(regsQuery)
      .mockReturnValueOnce(teamsQuery)

    const response = res()
    await handler(req({ page: '2', pageSize: '25' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.total).toBe(125)
    expect(response.body.page).toBe(2)
    expect(response.body.pageSize).toBe(25)
    expect(profilesQuery.range).toHaveBeenCalledWith(25, 49)
    expect(regsQuery.in).toHaveBeenCalledWith('user_id', ['user-1', 'user-2'])
    expect(teamsQuery.in).toHaveBeenCalledWith('captain_id', ['user-1', 'user-2'])
  })

  it('cleans search text before building the PostgREST or filter', async () => {
    const profilesQuery = queryResult({ data: [], error: null, count: 0 })
    from.mockReturnValueOnce(profilesQuery)

    const response = res()
    await handler(req({ search: 'adam),roles.cs.{superadmin}' }), response)

    expect(response.statusCode).toBe(200)
    const filter = profilesQuery.or.mock.calls[0][0]
    expect(filter).not.toContain(')')
    expect(filter).not.toContain('{')
    expect(filter).not.toContain('}')
  })

  it('short-circuits captain filter when no captains exist', async () => {
    const captainQuery = queryResult({ data: [], error: null })
    from.mockReturnValueOnce(captainQuery)

    const response = res()
    await handler(req({ role: 'captain' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.profiles).toEqual([])
    expect(response.body.total).toBe(0)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('rejects a malformed single-user id before authorisation or data access', async () => {
    const response = res()

    await handler(req({ id: 'not-a-uuid' }, 'PATCH', { suspended: true }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual({ error: 'id must be a valid UUID' })
    expect(verifyCommittee).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
    expect(acquireAccountAccessLock).not.toHaveBeenCalled()
  })

  it.each([
    [['player', 'made_up_role'], /unknown role/i],
    [['player', 'player'], /duplicates/i],
    [['alsa_committee'], /base player role/i],
  ])('rejects a non-canonical role update: %j', async (roles, message) => {
    const response = res()
    await handler(req({ id: 'user-1' }, 'PATCH', { roles }), response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toMatch(message)
    expect(from).not.toHaveBeenCalled()
  })

  it('sends a validated canonical role change through the governance RPC', async () => {
    verifyCommittee.mockResolvedValue({ user: { id: 'superadmin-1' }, error: null })
    const response = res()

    await handler(req(
      { id: 'user-1' },
      'PATCH',
      { roles: ['player', 'zltac_committee'], alsa_position: ' Secretary ' },
    ), response)

    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('admin_mutate_profile_access', {
      p_actor_id: 'superadmin-1',
      p_target_id: TARGET_ID,
      p_action: 'roles',
      p_payload: {
        roles: ['zltac_committee', 'player'],
        alsa_position: 'Secretary',
      },
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('maps the database last-superadmin guard to a stable conflict', async () => {
    verifyCommittee.mockResolvedValue({ user: { id: 'superadmin-1' }, error: null })
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'At least one active superadmin must remain. internal detail' },
    })
    const response = res()

    await handler(req(
      { id: 'user-1' },
      'PATCH',
      { roles: ['player'] },
    ), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toBe('At least one active superadmin must remain.')
  })

  it('maps a database tombstone guard to a stable non-reopening conflict', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Account access has been permanently revoked.' },
    })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'reset' }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({ error: 'Account access has been permanently removed.' })
  })

  it('requires removing superadmin before suspending the account', async () => {
    const targetQuery = queryResult({
      data: { roles: ['superadmin', 'player'], suspended: false, is_placeholder: false },
      error: null,
    })
    from.mockReturnValueOnce(targetQuery)
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { suspended: true }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/Remove the superadmin role/i)
    expect(updateUserById).not.toHaveBeenCalled()
    expect(acquireAccountAccessLock).toHaveBeenCalledWith({ targetUserId: TARGET_ID })
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
  })

  it('acquires the target lock before reading prior suspension state', async () => {
    const targetQuery = queryResult({
      data: { roles: ['player'], suspended: false, is_placeholder: false },
      error: null,
    })
    from.mockReturnValueOnce(targetQuery)
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { suspended: true }), response)

    expect(response.statusCode).toBe(200)
    expect(acquireAccountAccessLock.mock.invocationCallOrder[0])
      .toBeLessThan(from.mock.invocationCallOrder[0])
    expect(setUserSuspension).toHaveBeenCalledWith(expect.objectContaining({
      userId: TARGET_ID,
      previousSuspended: false,
      suspended: true,
      runOperation: guardRun,
    }))
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
  })

  it('canonicalizes a target UUID before locking and querying it', async () => {
    const targetQuery = queryResult({
      data: {
        roles: ['player'],
        suspended: false,
        is_placeholder: false,
        access_revoked_at: null,
      },
      error: null,
    })
    from.mockReturnValueOnce(targetQuery)
    const response = res()

    await handler(req(
      { id: `  ${TARGET_ID.toUpperCase()}  ` },
      'PATCH',
      { suspended: true },
    ), response)

    expect(response.statusCode).toBe(200)
    expect(acquireAccountAccessLock).toHaveBeenCalledWith({ targetUserId: TARGET_ID })
    expect(targetQuery.eq).toHaveBeenCalledWith('id', TARGET_ID)
    expect(setUserSuspension).toHaveBeenCalledWith(expect.objectContaining({ userId: TARGET_ID }))
  })

  it('rejects suspension restore for a tombstoned profile before changing Auth', async () => {
    const targetQuery = queryResult({
      data: {
        roles: ['player'],
        suspended: true,
        is_placeholder: false,
        access_revoked_at: '2026-07-14T00:00:00.000Z',
      },
      error: null,
    })
    from.mockReturnValueOnce(targetQuery)
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { suspended: false }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({ error: 'Account access has been permanently removed.' })
    expect(setUserSuspension).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
  })

  it('returns 503 and retains the lease when ownership is lost mid-mutation', async () => {
    const lockError = Object.assign(new Error('lease replaced'), {
      code: 'ACCOUNT_ACCESS_LOCK_LOST',
    })
    guardRun.mockRejectedValueOnce(lockError)
    guardFinish.mockResolvedValueOnce({
      safeToRelease: false,
      lost: true,
      timedOut: false,
      error: lockError,
    })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { suspended: true }), response)

    expect(response.statusCode).toBe(503)
    expect(response.body).toEqual({
      error: 'Account access state is indeterminate after a lock safety failure. Do not retry until an administrator has reconciled it.',
      code: 'ACCOUNT_ACCESS_LOCK_LOST',
    })
    expect(setUserSuspension).not.toHaveBeenCalled()
    expect(releaseAccountAccessLock).not.toHaveBeenCalled()
    expect(captureServerException).toHaveBeenCalledWith(
      lockError,
      'admin-users:account-access-lock-safety',
      { actorId: 'committee-1', targetUserId: TARGET_ID, action: 'suspend' },
    )
    expect(captureServerException).toHaveBeenCalledWith(
      lockError,
      'admin-users:account-access-lock-retained',
      {
        actorId: 'committee-1',
        targetUserId: TARGET_ID,
        action: 'suspend',
        lost: true,
        timedOut: false,
        quarantined: false,
        quarantineTtlMs: null,
        quarantineError: undefined,
      },
    )
  })

  it('returns a safe conflict without reading state when the target lock is held', async () => {
    acquireAccountAccessLock.mockResolvedValue({
      acquired: false,
      conflict: true,
      unavailable: false,
      error: null,
    })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { suspended: true }), response)

    expect(response.statusCode).toBe(409)
    expect(response.body).toEqual({
      error: 'Another account access change is already in progress. Try again shortly.',
      code: 'ACCOUNT_ACCESS_CHANGE_IN_PROGRESS',
    })
    expect(from).not.toHaveBeenCalled()
    expect(setUserSuspension).not.toHaveBeenCalled()
  })

  it('fails closed with telemetry when the distributed target lock is unavailable', async () => {
    const lockError = new Error('redis offline')
    acquireAccountAccessLock.mockResolvedValue({
      acquired: false,
      conflict: false,
      unavailable: true,
      error: lockError,
    })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { suspended: false }), response)

    expect(response.statusCode).toBe(503)
    expect(response.body).toEqual({
      error: 'Account access changes are temporarily unavailable. Try again later.',
      code: 'ACCOUNT_ACCESS_LOCK_UNAVAILABLE',
    })
    expect(captureServerException).toHaveBeenCalledWith(
      lockError,
      'admin-users:account-access-lock-unavailable',
      { actorId: 'committee-1', targetUserId: TARGET_ID, action: 'restore' },
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('uses the same target lock for remove-access Auth and profile mutations', async () => {
    const targetQuery = queryResult({ data: { is_placeholder: false }, error: null })
    from.mockReturnValueOnce(targetQuery)
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'remove-access' }), response)

    expect(response.statusCode).toBe(200)
    expect(acquireAccountAccessLock).toHaveBeenCalledWith({ targetUserId: TARGET_ID })
    expect(updateUserById).toHaveBeenCalledWith(TARGET_ID, { ban_duration: '876000h' })
    expect(rpc).toHaveBeenCalledWith('admin_mutate_profile_access', {
      p_actor_id: 'committee-1',
      p_target_id: TARGET_ID,
      p_action: 'remove-access',
      p_payload: {},
    })
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
  })

  it('continues remove-access when the Auth ban committed before its response was lost', async () => {
    const authError = new Error('auth response lost')
    from.mockReturnValueOnce(queryResult({ data: removeAccessProfile(), error: null }))
    updateUserById.mockResolvedValueOnce({ error: authError })
    readAuthSuspensionState
      .mockResolvedValueOnce({
        exists: true,
        suspended: false,
        bannedUntil: null,
        error: null,
      })
      .mockResolvedValueOnce({
        exists: true,
        suspended: true,
        bannedUntil: '2126-01-01T00:00:00.000Z',
        error: null,
      })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'remove-access' }), response)

    expect(response.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('admin_mutate_profile_access', {
      p_actor_id: 'committee-1',
      p_target_id: TARGET_ID,
      p_action: 'remove-access',
      p_payload: {},
    })
    expect(updateUserById).toHaveBeenCalledTimes(1)
  })

  it('fails closed when an ambiguous remove-access Auth ban cannot be read back', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const authError = new Error('auth response lost')
    const authReadError = new Error('auth read unavailable')
    from.mockReturnValueOnce(queryResult({ data: removeAccessProfile(), error: null }))
    updateUserById.mockResolvedValueOnce({ error: authError })
    readAuthSuspensionState
      .mockResolvedValueOnce({
        exists: true,
        suspended: false,
        bannedUntil: null,
        error: null,
      })
      .mockResolvedValueOnce({
        exists: null,
        suspended: null,
        bannedUntil: null,
        error: authReadError,
      })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'remove-access' }), response)

    expect(response.statusCode).toBe(503)
    expect(response.body).toEqual({
      error: 'Account access could not be reconciled automatically. Escalate to a superadmin before retrying.',
      code: 'ACCOUNT_ACCESS_RECONCILIATION_REQUIRED',
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(captureServerException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/could not be reconciled/i) }),
      'admin-users:remove-access-auth-reconciliation-required',
      {
        actorId: 'committee-1',
        targetUserId: TARGET_ID,
        action: 'remove-access',
        authError: 'auth response lost',
        authReconciliationError: 'auth read unavailable',
      },
    )
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
    consoleError.mockRestore()
  })

  it('keeps Auth banned when remove-access committed before its response was lost', async () => {
    const target = removeAccessProfile()
    from
      .mockReturnValueOnce(queryResult({ data: target, error: null }))
      .mockReturnValueOnce(queryResult({ data: committedRemoveAccessProfile(), error: null }))
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'remove-access' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ ok: true, reconciled: true })
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(updateUserById).toHaveBeenCalledWith(TARGET_ID, { ban_duration: '876000h' })
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
  })

  it('does not lift the Auth ban when remove-access reconciliation is indeterminate', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const readError = new Error('profile read unavailable')
    from
      .mockReturnValueOnce(queryResult({ data: removeAccessProfile(), error: null }))
      .mockReturnValueOnce(queryResult({ data: null, error: readError }))
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'remove-access' }), response)

    expect(response.statusCode).toBe(503)
    expect(response.body).toEqual({
      error: 'Account access could not be reconciled automatically. Escalate to a superadmin before retrying.',
      code: 'ACCOUNT_ACCESS_RECONCILIATION_REQUIRED',
    })
    expect(updateUserById).toHaveBeenCalledTimes(1)
    expect(captureServerException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/could not be reconciled/i) }),
      'admin-users:remove-access-reconciliation-required',
      {
        actorId: 'committee-1',
        targetUserId: TARGET_ID,
        action: 'remove-access',
        profileError: 'response lost',
        reconciliationError: 'profile read unavailable',
      },
    )
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
    consoleError.mockRestore()
  })

  it('rolls Auth back only after remove-access confirms the prior profile state', async () => {
    const target = removeAccessProfile()
    from
      .mockReturnValueOnce(queryResult({ data: target, error: null }))
      .mockReturnValueOnce(queryResult({ data: { ...target }, error: null }))
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'database rejected mutation' } })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'remove-access' }), response)

    expect(updateUserById).toHaveBeenNthCalledWith(1, TARGET_ID, { ban_duration: '876000h' })
    expect(updateUserById).toHaveBeenNthCalledWith(2, TARGET_ID, { ban_duration: 'none' })
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
  })

  it('preserves the actual Auth ban when profile suspension state has drifted', async () => {
    const target = removeAccessProfile({ suspended: false })
    readAuthSuspensionState.mockResolvedValueOnce({
      exists: true,
      suspended: true,
      bannedUntil: '2026-07-14T01:00:00.000Z',
      error: null,
    })
    authBanDurationForState.mockReturnValueOnce('3600s')
    from
      .mockReturnValueOnce(queryResult({ data: target, error: null }))
      .mockReturnValueOnce(queryResult({ data: { ...target }, error: null }))
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'database rejected mutation' } })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { action: 'remove-access' }), response)

    expect(updateUserById).toHaveBeenNthCalledWith(1, TARGET_ID, { ban_duration: '876000h' })
    expect(authBanDurationForState).toHaveBeenCalledWith(expect.objectContaining({
      suspended: true,
      bannedUntil: '2026-07-14T01:00:00.000Z',
    }))
    expect(updateUserById).toHaveBeenNthCalledWith(2, TARGET_ID, { ban_duration: '3600s' })
    expect(releaseAccountAccessLock).toHaveBeenCalledWith(ACCESS_LOCK)
  })

  it('returns a distinct retry-safe error and telemetry when suspension reconciliation fails', async () => {
    const targetQuery = queryResult({
      data: { roles: ['player'], suspended: false, is_placeholder: false },
      error: null,
    })
    from.mockReturnValueOnce(targetQuery)
    const cause = new Error('Auth rollback failed')
    setUserSuspension.mockResolvedValue({
      error: cause.message,
      cause,
      reconciliationRequired: true,
      profileError: { message: 'profile failed' },
      rollbackError: { message: 'rollback failed' },
    })
    const response = res()

    await handler(req({ id: 'user-1' }, 'PATCH', { suspended: true }), response)

    expect(response.statusCode).toBe(503)
    expect(response.body).toEqual({
      error: 'Account access could not be reconciled automatically. Escalate to a superadmin before retrying.',
      code: 'ACCOUNT_ACCESS_RECONCILIATION_REQUIRED',
    })
    expect(captureServerException).toHaveBeenCalledWith(
      cause,
      'admin-users:suspension-reconciliation-required',
      {
        actorId: 'committee-1',
        targetUserId: TARGET_ID,
        requestedSuspended: true,
        previousSuspended: false,
        authPreflightError: undefined,
        authError: undefined,
        authReconciliationError: undefined,
        profileError: 'profile failed',
        rollbackError: 'rollback failed',
        reconciliationError: undefined,
      },
    )
  })

  it('builds deletion impact without querying the dropped event_registrations table', async () => {
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') {
        return queryResult({ data: [{ id: 'registration-1' }], error: null })
      }
      return queryResult({ count: 0, error: null })
    })

    const response = res()
    await handler(req({ id: 'user-1', action: 'deletion-impact' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.deleted.zltac_registrations).toBe(1)
    expect(response.body.totals).toEqual({
      deleted: 1,
      detached: 0,
      blockers: 0,
    })
    expect(response.body.can_delete).toBe(false)
    expect(from).not.toHaveBeenCalledWith('event_registrations')
  })

  it('separates deleted rows, detached links, and blockers', async () => {
    from.mockImplementation(table => {
      if (table === 'zltac_registrations') {
        return queryResult({ data: [{ id: 'registration-1' }], count: 0, error: null })
      }
      if (table === 'legal_acceptances') return queryResult({ count: 2, error: null })
      if (table === 'under_18_approvals') return queryResult({ count: 1, error: null })
      if (table === 'referee_test_attempts') return queryResult({ count: 3, error: null })
      if (table === 'teams') return queryResult({ count: 2, error: null })
      if (table === 'competitions') return queryResult({ count: 1, error: null })
      if (table === 'admin_content_mutation_audit') {
        return queryResult({ count: 4, error: null })
      }
      if (table === 'admin_asset_upload_audit') {
        return queryResult({ count: 5, error: null })
      }
      return queryResult({ count: 0, error: null })
    })

    const response = res()
    await handler(req({ id: 'user-1', action: 'deletion-impact' }), response)

    expect(response.statusCode).toBe(200)
    expect(response.body.deleted).toMatchObject({
      zltac_registrations: 1,
      referee_test_attempts: 3,
      legal_acceptances: 2,
      under_18_approvals: 1,
    })
    expect(response.body.detached).toMatchObject({
      teams_captained: 2,
      teams_managed: 2,
    })
    expect(response.body.blockers.competitions_created).toBe(1)
    expect(response.body.blockers.admin_content_mutations_authored).toBe(4)
    expect(response.body.blockers.admin_asset_uploads_recorded).toBe(5)
    expect(response.body.can_delete).toBe(false)
  })

  it('refuses hard deletion before calling auth when audit blockers exist', async () => {
    from.mockImplementation(table => {
      if (table === 'profiles') {
        return queryResult({ data: { is_placeholder: false }, count: 0, error: null })
      }
      if (table === 'zltac_registrations') return queryResult({ data: [], count: 0, error: null })
      if (table === 'competitions') return queryResult({ count: 1, error: null })
      return queryResult({ count: 0, error: null })
    })

    const response = res()
    await handler(req({ id: 'user-1' }, 'DELETE'), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.impact.can_delete).toBe(false)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses hard deletion of a real portal account even when it has no child rows', async () => {
    from.mockImplementation(table => {
      if (table === 'profiles') {
        return queryResult({ data: { is_placeholder: false }, count: 0, error: null })
      }
      if (table === 'zltac_registrations') return queryResult({ data: [], count: 0, error: null })
      return queryResult({ count: 0, error: null })
    })

    const response = res()
    await handler(req({ id: 'user-1' }, 'DELETE'), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.error).toMatch(/Remove access/i)
    expect(response.body.impact.can_delete).toBe(false)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('hard-deletes only a truly empty placeholder profile', async () => {
    const profileQueries = []
    from.mockImplementation(table => {
      if (table === 'profiles') {
        const query = queryResult({ data: { is_placeholder: true }, count: 0, error: null })
        profileQueries.push(query)
        return query
      }
      if (table === 'zltac_registrations') return queryResult({ data: [], count: 0, error: null })
      return queryResult({ count: 0, error: null })
    })

    const response = res()
    await handler(req({ id: 'placeholder-1' }, 'DELETE'), response)

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({ deleted: true, impact: { can_delete: true } })
    expect(profileQueries.some(query => query.delete.mock.calls.length > 0)).toBe(true)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('preserves a placeholder when any registration or evidence exists', async () => {
    from.mockImplementation(table => {
      if (table === 'profiles') {
        return queryResult({ data: { is_placeholder: true }, count: 0, error: null })
      }
      if (table === 'zltac_registrations') {
        return queryResult({ data: [{ id: 'registration-1' }], count: 0, error: null })
      }
      return queryResult({ count: 0, error: null })
    })

    const response = res()
    await handler(req({ id: 'placeholder-1' }, 'DELETE'), response)

    expect(response.statusCode).toBe(409)
    expect(response.body.impact).toMatchObject({
      can_delete: false,
      deleted: { zltac_registrations: 1 },
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
