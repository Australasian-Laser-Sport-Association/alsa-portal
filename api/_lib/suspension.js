import { isAccountAccessLockSafetyError } from './accountAccessLock.js'

// auth.admin ban_duration uses Go duration syntax. Approximately 100 years is
// effectively permanent, while 'none' explicitly lifts a ban.
export const PERMANENT_BAN = '876600h'

async function executeOperation(runOperation, label, operation) {
  return runOperation ? runOperation(label, operation) : operation()
}

export async function readAuthSuspensionState({
  supabase,
  userId,
  now = Date.now(),
  runOperation,
  operationLabel = 'auth-suspension-state-read',
}) {
  let result
  try {
    result = await executeOperation(
      runOperation,
      operationLabel,
      () => supabase.auth.admin.getUserById(userId),
    )
  } catch (error) {
    if (isAccountAccessLockSafetyError(error)) throw error
    return { exists: null, suspended: null, bannedUntil: null, error }
  }

  if (result.error?.status === 404 || (!result.error && !result.data?.user)) {
    return { exists: false, suspended: null, bannedUntil: null, error: null }
  }
  if (result.error) {
    return { exists: null, suspended: null, bannedUntil: null, error: result.error }
  }

  const bannedUntil = result.data.user.banned_until
  if (bannedUntil == null || bannedUntil === '') {
    return { exists: true, suspended: false, bannedUntil: null, error: null }
  }
  const expiresAt = Date.parse(bannedUntil)
  if (!Number.isFinite(expiresAt)) {
    return {
      exists: true,
      suspended: null,
      bannedUntil,
      error: new Error('The authentication ban state is invalid.'),
    }
  }
  return { exists: true, suspended: expiresAt > now, bannedUntil, error: null }
}

export function authBanDurationForState(state, now = Date.now()) {
  if (!state?.exists || !state.suspended) return 'none'
  const expiresAt = Date.parse(state.bannedUntil)
  if (!Number.isFinite(expiresAt)) {
    throw new Error('The previous authentication ban expiry is invalid.')
  }
  const remainingMs = expiresAt - now
  return remainingMs > 0 ? `${Math.max(1, Math.ceil(remainingMs / 1000))}s` : 'none'
}

async function readSuspendedState(supabase, userId, runOperation) {
  try {
    return await executeOperation(
      runOperation,
      'profile-suspension-reconciliation-read',
      () => supabase
        .from('profiles')
        .select('suspended')
        .eq('id', userId)
        .maybeSingle(),
    )
  } catch (error) {
    if (isAccountAccessLockSafetyError(error)) throw error
    return { data: null, error }
  }
}

export async function setUserSuspension({
  supabase,
  userId,
  suspended,
  previousSuspended,
  isPlaceholder,
  accessRevokedAt,
  actorId,
  runOperation,
  now = Date.now,
}) {
  if (accessRevokedAt) {
    const cause = new Error('Account access has been permanently revoked.')
    return { error: cause.message, cause, accessRevoked: true }
  }

  let authChanged = false
  let previousAuthState = {
    exists: false,
    suspended: null,
    bannedUntil: null,
    error: null,
  }

  if (!isPlaceholder) {
    previousAuthState = await readAuthSuspensionState({
      supabase,
      userId,
      now: now(),
      runOperation,
      operationLabel: 'auth-suspension-preflight-read',
    })
    if (previousAuthState.error) {
      const cause = new Error(
        'The existing authentication suspension state could not be read safely.',
        { cause: previousAuthState.error },
      )
      return {
        error: cause.message,
        cause,
        authPreflightError: previousAuthState.error,
        reconciliationRequired: true,
      }
    }

    if (previousAuthState.exists) {
      let authError
      try {
        const result = await executeOperation(
          runOperation,
          'auth-suspension-update',
          () => supabase.auth.admin.updateUserById(userId, {
            ban_duration: suspended ? PERMANENT_BAN : 'none',
          }),
        )
        authError = result.error
      } catch (error) {
        if (isAccountAccessLockSafetyError(error)) throw error
        authError = error
      }
      if (authError && authError.status !== 404) {
        // Auth updates can commit before their HTTP response is lost. Re-read
        // the ban state before either aborting or advancing to the profile write.
        const reconciliation = await readAuthSuspensionState({
          supabase,
          userId,
          now: now(),
          runOperation,
          operationLabel: 'auth-suspension-reconciliation-read',
        })
        if (!reconciliation.error && reconciliation.exists === false) {
          previousAuthState = reconciliation
          authError = null
        } else if (!reconciliation.error && reconciliation.suspended === suspended) {
          authChanged = true
          authError = null
        } else if (!reconciliation.error && reconciliation.exists === true) {
          return {
            error: `Could not ${suspended ? 'suspend' : 'restore'} login: ${authError.message}`,
            cause: authError,
          }
        } else {
          const reconciliationError = reconciliation.error
            ?? new Error('The authentication suspension state could not be determined.')
          const cause = new Error(
            'The authentication suspension result could not be reconciled automatically.',
            { cause: reconciliationError },
          )
          return {
            error: cause.message,
            cause,
            authError,
            authReconciliationError: reconciliationError,
            reconciliationRequired: true,
          }
        }
      }
      authChanged = authChanged || (!authError && previousAuthState.exists)
    }
  }

  let profileError = null
  try {
    const result = await executeOperation(
      runOperation,
      'profile-suspension-update',
      () => actorId
        ? supabase.rpc('admin_mutate_profile_access', {
          p_actor_id: actorId,
          p_target_id: userId,
          p_action: 'suspension',
          p_payload: { suspended },
        })
        : supabase
          .from('profiles')
          .update({ suspended })
          .eq('id', userId),
    )
    profileError = result.error
  } catch (error) {
    if (isAccountAccessLockSafetyError(error)) throw error
    profileError = error
  }

  if (profileError) {
    // An RPC error does not prove the transaction rolled back: the commit may
    // have succeeded and only the HTTP response may have been lost. Re-read
    // the authoritative profile before deciding whether Auth must be restored.
    const reconciliation = await readSuspendedState(supabase, userId, runOperation)
    if (!reconciliation.error && reconciliation.data?.suspended === suspended) {
      return { error: null, reconciled: true, profileError }
    }

    const priorStateConfirmed = !reconciliation.error
      && reconciliation.data?.suspended === previousSuspended
    if (!priorStateConfirmed) {
      const reconciliationError = reconciliation.error
        ?? new Error('The target profile suspension state could not be determined.')
      const cause = new Error(
        'The profile suspension result could not be reconciled automatically.',
        { cause: reconciliationError },
      )
      return {
        error: cause.message,
        cause,
        profileError,
        reconciliationError,
        reconciliationRequired: true,
      }
    }

    // The prior database state is confirmed. Restore the actual Auth state
    // captured before this saga, including any independent finite ban.
    if (authChanged) {
      let rollbackError = null
      try {
        const rollbackBanDuration = authBanDurationForState(previousAuthState, now())
        const result = await executeOperation(
          runOperation,
          'auth-suspension-rollback',
          () => supabase.auth.admin.updateUserById(userId, {
            ban_duration: rollbackBanDuration,
          }),
        )
        rollbackError = result.error
      } catch (error) {
        if (isAccountAccessLockSafetyError(error)) throw error
        rollbackError = error
      }

      if (rollbackError) {
        const cause = new Error(
          'The profile suspension change failed and the previous authentication state could not be restored.',
          { cause: rollbackError },
        )
        return {
          error: cause.message,
          cause,
          profileError,
          rollbackError,
          reconciliationRequired: true,
        }
      }
    }
    return {
      error: profileError?.message ?? 'Profile suspension update failed.',
      cause: profileError,
    }
  }

  return { error: null }
}
