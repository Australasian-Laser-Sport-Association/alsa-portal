import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'
import {
  PERMANENT_BAN,
  authBanDurationForState,
  readAuthSuspensionState,
  setUserSuspension,
} from '../_lib/suspension.js'
import { changeProfileAlias } from '../_lib/profileChanges.js'
import { sendServerError } from '../_lib/apiErrors.js'
import { captureServerException } from '../_lib/serverTelemetry.js'
import {
  acquireAccountAccessLock,
  canonicalizeAccountAccessTargetId,
  createAccountAccessLockGuard,
  isAccountAccessLockSafetyError,
  releaseAccountAccessLock,
} from '../_lib/accountAccessLock.js'

const PROFILE_LIST_COLUMNS = 'id, first_name, last_name, alias, state, roles, suspended, created_at, home_arena, alsa_position'
const USER_REGISTRATION_COLUMNS = 'id, year, status, side_events, teams(name)'
const USER_PAYMENT_COLUMNS = 'id, amount, status, created_at'
const USER_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']
const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 100
const SEARCH_MAX = 80
const REMOVE_ACCESS_ANONYMIZED_FIELDS = [
  'first_name',
  'last_name',
  'alias',
  'dob',
  'state',
  'home_arena',
  'phone',
  'emergency_contact_name',
  'emergency_contact_phone',
  'alsa_member_id',
  'avatar_url',
  'placeholder_email',
  'email',
  'alsa_position',
]
const REMOVE_ACCESS_STATE_FIELDS = [
  'is_placeholder',
  ...REMOVE_ACCESS_ANONYMIZED_FIELDS,
  'roles',
  'suspended',
  'access_revoked_at',
  'access_revoked_by',
]
const REMOVE_ACCESS_PROFILE_COLUMNS = REMOVE_ACCESS_STATE_FIELDS.join(', ')
const PROFILE_ROLE_ORDER = [
  'superadmin',
  'alsa_committee',
  'zltac_committee',
  'advisor',
  'captain',
  'player',
]
const PROFILE_ROLE_SET = new Set(PROFILE_ROLE_ORDER)

function validateProfileRoles(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > PROFILE_ROLE_ORDER.length) {
    return { error: 'roles must be a non-empty array of canonical roles' }
  }
  if (value.some(role => typeof role !== 'string' || !PROFILE_ROLE_SET.has(role))) {
    return { error: 'roles contains an unknown role' }
  }
  if (new Set(value).size !== value.length) {
    return { error: 'roles must not contain duplicates' }
  }
  if (!value.includes('player')) {
    return { error: 'roles must include the base player role' }
  }
  return { roles: PROFILE_ROLE_ORDER.filter(role => value.includes(role)) }
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function cleanSearchTerm(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .slice(0, SEARCH_MAX)
    .replace(/[^a-z0-9 -]/gi, '')
    .replace(/\s+/g, ' ')
}

function profileSearchFilter(query, term) {
  if (!term) return query
  const pattern = `%${term}%`
  return query.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},alias.ilike.${pattern}`)
}

async function listCaptainIds() {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('captain_id')
    .not('captain_id', 'is', null)
  if (error) return { error }
  return { ids: [...new Set((data ?? []).map(row => row.captain_id).filter(Boolean))] }
}

function applyRoleFilter(query, role, captainIds) {
  if (!role || role === 'all' || role === 'player') return query
  if (role === 'captain') return captainIds.length ? query.in('id', captainIds) : null
  if (role === 'committee') return query.overlaps('roles', ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor'])
  return query.contains('roles', [role])
}

function totalImpactCounts(group) {
  return Object.values(group).reduce((total, count) => total + count, 0)
}

function profileAccessErrorResponse(res, error, context) {
  const message = error?.message ?? ''
  if (/Target profile not found/i.test(message)) {
    return res.status(404).json({ error: 'User not found' })
  }
  if (/At least one active superadmin must remain/i.test(message)) {
    return res.status(409).json({ error: 'At least one active superadmin must remain.' })
  }
  if (/Remove the superadmin role before suspending/i.test(message)) {
    return res.status(409).json({ error: 'Remove the superadmin role before suspending this account.' })
  }
  if (/Account access has been permanently revoked/i.test(message)) {
    return res.status(409).json({ error: 'Account access has been permanently removed.' })
  }
  if (/Forbidden|Only a superadmin|Cannot mutate your own/i.test(message)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  return sendServerError(res, error, context)
}

async function beginAccountAccessMutation(res, metadata) {
  let lock
  try {
    lock = await acquireAccountAccessLock({ targetUserId: metadata.targetUserId })
  } catch (error) {
    lock = { acquired: false, unavailable: true, error }
  }

  if (lock.acquired) {
    try {
      return { lock, guard: createAccountAccessLockGuard(lock) }
    } catch (error) {
      await releaseAccountAccessLock(lock)
      captureServerException(error, 'admin-users:account-access-lock-guard', metadata)
      res.status(503).json({
        error: 'Account access changes are temporarily unavailable. Try again later.',
        code: 'ACCOUNT_ACCESS_LOCK_UNAVAILABLE',
      })
      return null
    }
  }
  if (lock.conflict) {
    res.status(409).json({
      error: 'Another account access change is already in progress. Try again shortly.',
      code: 'ACCOUNT_ACCESS_CHANGE_IN_PROGRESS',
    })
    return null
  }

  const error = lock.error ?? new Error('The account access lock is unavailable.')
  captureServerException(error, 'admin-users:account-access-lock-unavailable', metadata)
  res.status(503).json({
    error: 'Account access changes are temporarily unavailable. Try again later.',
    code: 'ACCOUNT_ACCESS_LOCK_UNAVAILABLE',
  })
  return null
}

async function endAccountAccessMutation(access, metadata) {
  let finish
  try {
    finish = await access.guard.finish()
  } catch (error) {
    finish = { safeToRelease: false, lost: false, timedOut: false, error }
  }
  if (!finish.safeToRelease) {
    captureServerException(
      finish.error ?? new Error('Account access lock safety could not be confirmed.'),
      'admin-users:account-access-lock-retained',
      {
        ...metadata,
        lost: !!finish.lost,
        timedOut: !!finish.timedOut,
        quarantined: !!finish.quarantined,
        quarantineTtlMs: finish.quarantineTtlMs ?? null,
        quarantineError: finish.quarantineError?.message,
      },
    )
    return
  }

  let result
  try {
    result = await releaseAccountAccessLock(access.lock)
  } catch (error) {
    result = { released: false, lost: false, error }
  }
  if (result.error || result.lost) {
    captureServerException(
      result.error ?? new Error('Account access lock ownership expired before release.'),
      'admin-users:account-access-lock-release',
      metadata,
    )
  }
}

function sameProfileValue(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function removeAccessCommitted(profile) {
  return !!profile
    && !!profile.access_revoked_at
    && !!profile.access_revoked_by
    && profile.suspended === true
    && Array.isArray(profile.roles)
    && profile.roles.length === 1
    && profile.roles[0] === 'player'
    && REMOVE_ACCESS_ANONYMIZED_FIELDS.every(field => profile[field] === null)
}

function removeAccessPriorStateConfirmed(profile, previousProfile) {
  return !!profile && REMOVE_ACCESS_STATE_FIELDS.every(
    field => sameProfileValue(profile[field], previousProfile[field]),
  )
}

async function readRemoveAccessState(userId, runOperation) {
  try {
    return await runOperation(
      'profile-remove-access-reconciliation-read',
      () => supabaseAdmin
        .from('profiles')
        .select(REMOVE_ACCESS_PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle(),
    )
  } catch (error) {
    if (isAccountAccessLockSafetyError(error)) throw error
    return { data: null, error }
  }
}

function sendAccountAccessReconciliationRequired(res, error, context, metadata) {
  console.error(`[${context}]`, error.message)
  captureServerException(error, context, metadata)
  return res.status(503).json({
    error: 'Account access could not be reconciled automatically. Escalate to a superadmin before retrying.',
    code: 'ACCOUNT_ACCESS_RECONCILIATION_REQUIRED',
  })
}

function sendAccountAccessSafetyFailure(res, error, metadata) {
  const context = 'admin-users:account-access-lock-safety'
  captureServerException(error, context, metadata)
  return res.status(503).json({
    error: 'Account access state is indeterminate after a lock safety failure. Do not retry until an administrator has reconciled it.',
    code: error.code ?? 'ACCOUNT_ACCESS_LOCK_LOST',
  })
}

async function mutateProfileAccess(actorId, targetId, action, payload = {}) {
  return supabaseAdmin.rpc('admin_mutate_profile_access', {
    p_actor_id: actorId,
    p_target_id: targetId,
    p_action: action,
    p_payload: payload,
  })
}

// Build the same impact snapshot for both the confirmation preview and the
// delete itself. Categories reflect database behaviour after migration 53000:
// account-owned acknowledgements and under-18 workflow rows are deleted,
// SET NULL links are detached, and NO ACTION audit links block the delete
// unless their own row is cascading.
export async function buildDeletionImpact(userId) {
  const countOf = (table, column, { excludeEqual, excludeIn } = {}) => {
    let query = supabaseAdmin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, userId)
    if (excludeEqual) query = query.neq(excludeEqual, userId)
    if (excludeIn?.values?.length) {
      query = query.not(excludeIn.column, 'in', `(${excludeIn.values.join(',')})`)
    }
    return query
  }

  // payment_records are owned by registrations rather than profiles. Account
  // type is part of the gate so the preview cannot enable hard deletion for a
  // real portal account that happens to have no child rows.
  const [profileResult, registrationResult] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('is_placeholder')
      .eq('id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('zltac_registrations')
      .select('id')
      .eq('user_id', userId),
  ])
  if (profileResult.error) return { error: profileResult.error }
  if (registrationResult.error) return { error: registrationResult.error }

  const registrationIds = (registrationResult.data ?? []).map(row => row.id)
  const zero = () => Promise.resolve({ count: 0, error: null })
  const queries = {
    deleted: [
      ['competition_registrations', countOf('competition_registrations', 'user_id')],
      ['payments', countOf('payments', 'user_id')],
      ['payment_records', registrationIds.length
        ? supabaseAdmin
          .from('payment_records')
          .select('*', { count: 'exact', head: true })
          .in('registration_id', registrationIds)
        : zero()],
      ['referee_test_results', countOf('referee_test_results', 'user_id')],
      ['referee_test_attempts', countOf('referee_test_attempts', 'user_id')],
      ['team_members', countOf('team_members', 'user_id')],
      ['competition_managers', countOf('competition_managers', 'user_id')],
      ['alsa_memberships', countOf('alsa_memberships', 'profile_id')],
      ['alsa_lifetime_members', countOf('alsa_lifetime_members', 'profile_id')],
      ['side_event_roster_slots', countOf('zltac_side_event_roster_members', 'member_id')],
      ['legal_acceptances', countOf('legal_acceptances', 'user_id')],
      ['under_18_approvals', countOf('under_18_approvals', 'user_id')],
    ],
    detached: [
      ['teams_captained', countOf('teams', 'captain_id')],
      ['teams_managed', countOf('teams', 'manager_id')],
      ['doubles_player_1_slots', countOf('doubles_pairs', 'player1_id')],
      ['doubles_player_2_slots', countOf('doubles_pairs', 'player2_id')],
      ['triples_player_1_slots', countOf('triples_teams', 'player1_id')],
      ['triples_player_2_slots', countOf('triples_teams', 'player2_id')],
      ['triples_player_3_slots', countOf('triples_teams', 'player3_id')],
      ['profiles_created', countOf('profiles', 'created_by_admin_id', {
        excludeEqual: 'id',
      })],
      ['legal_documents_uploaded', countOf('legal_documents', 'uploaded_by')],
      ['under_18_decisions_reviewed', countOf('under_18_approvals', 'approved_by')],
      ['payment_records_recorded', countOf('payment_records', 'recorded_by', {
        excludeIn: { column: 'registration_id', values: registrationIds },
      })],
      ['payment_history_changes', countOf('payment_records_history', 'changed_by')],
      ['profile_alias_changes', countOf('profile_change_audit', 'changed_by')],
      ['lifetime_memberships_granted', countOf('alsa_lifetime_members', 'granted_by', {
        excludeEqual: 'profile_id',
      })],
    ],
    blockers: [
      ['code_of_conduct_overrides_set', countOf('zltac_registrations', 'admin_override_coc_set_by', {
        excludeEqual: 'user_id',
      })],
      ['media_release_overrides_set', countOf('zltac_registrations', 'admin_override_media_set_by', {
        excludeEqual: 'user_id',
      })],
      ['referee_test_overrides_set', countOf('zltac_registrations', 'admin_override_ref_test_set_by', {
        excludeEqual: 'user_id',
      })],
      ['under_18_overrides_set', countOf('zltac_registrations', 'admin_override_u18_set_by', {
        excludeEqual: 'user_id',
      })],
      ['alsa_memberships_created', countOf('alsa_memberships', 'created_by', {
        excludeEqual: 'profile_id',
      })],
      ['competitions_created', countOf('competitions', 'created_by')],
      ['competition_manager_grants', countOf('competition_managers', 'granted_by', {
        excludeEqual: 'user_id',
      })],
      ['team_invitations_sent', countOf('team_members', 'invited_by', {
        excludeEqual: 'user_id',
      })],
      ['admin_content_mutations_authored', countOf('admin_content_mutation_audit', 'actor_id')],
      ['admin_asset_uploads_recorded', countOf('admin_asset_upload_audit', 'actor_id')],
    ],
  }

  const pending = []
  for (const [category, entries] of Object.entries(queries)) {
    for (const [key, query] of entries) pending.push({ category, key, query })
  }

  const settled = await Promise.all(pending.map(item => item.query))
  const errors = settled.map(result => result.error).filter(Boolean)
  if (errors.length) return { error: { message: errors.map(error => error.message).join(' | ') } }

  const impact = {
    deleted: { zltac_registrations: registrationIds.length },
    detached: {},
    blockers: {},
  }
  pending.forEach((item, index) => {
    impact[item.category][item.key] = settled[index].count ?? 0
  })
  impact.totals = {
    deleted: totalImpactCounts(impact.deleted),
    detached: totalImpactCounts(impact.detached),
    blockers: totalImpactCounts(impact.blockers),
  }
  // Hard deletion is only safe for a truly empty placeholder. The caller adds
  // the placeholder check because this inventory deliberately describes data
  // impact independently of account type. Any registration, payment,
  // membership, certification, acknowledgement, team link, or audit reference
  // requires the non-destructive Remove access workflow instead.
  impact.can_delete = profileResult.data?.is_placeholder === true
    && Object.values(impact.totals).every(total => total === 0)

  return { data: impact }
}

async function buildUsersPage(req) {
  const page = parsePositiveInt(req.query.page, 1)
  const pageSize = parsePositiveInt(req.query.pageSize, PAGE_SIZE_DEFAULT, { max: PAGE_SIZE_MAX })
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const search = cleanSearchTerm(req.query.search)
  const role = typeof req.query.role === 'string' ? req.query.role : 'all'
  const state = typeof req.query.state === 'string' ? req.query.state : 'all'

  let captainIds = []
  if (role === 'captain') {
    const captainResult = await listCaptainIds()
    if (captainResult.error) return { error: captainResult.error }
    captainIds = captainResult.ids
    if (captainIds.length === 0) {
      return {
        data: { profiles: [], registrations: [], teams: [], page, pageSize, total: 0, states: USER_STATES },
      }
    }
  }

  let query = supabaseAdmin
    .from('profiles')
    .select(PROFILE_LIST_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  query = profileSearchFilter(query, search)
  if (state !== 'all') query = query.eq('state', state)
  query = applyRoleFilter(query, role, captainIds)
  if (!query) {
    return {
      data: { profiles: [], registrations: [], teams: [], page, pageSize, total: 0, states: USER_STATES },
    }
  }

  const { data: profiles, error, count } = await query
  if (error) return { error }

  const userIds = (profiles ?? []).map(profile => profile.id)
  if (userIds.length === 0) {
    return {
      data: { profiles: [], registrations: [], teams: [], page, pageSize, total: count ?? 0, states: USER_STATES },
    }
  }

  const [
    { data: registrations, error: regErr },
    { data: teams, error: teamErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('zltac_registrations')
      .select('user_id, year')
      .in('user_id', userIds),
    supabaseAdmin
      .from('teams')
      .select('id, name, captain_id')
      .in('captain_id', userIds),
  ])

  const err = regErr ?? teamErr
  if (err) return { error: err }
  return {
    data: {
      profiles: profiles ?? [],
      registrations: registrations ?? [],
      teams: teams ?? [],
      page,
      pageSize,
      total: count ?? 0,
      states: USER_STATES,
    },
  }
}

export default async function handler(req, res) {
  const rawId = req.query.id
  const id = rawId ? canonicalizeAccountAccessTargetId(rawId) : null
  if (rawId && !id) {
    return res.status(400).json({ error: 'id must be a valid UUID' })
  }

  // Single-user operations when ?id is present
  if (id) {
    if (req.method === 'GET') {
      // Impact preview for the hard delete: counts of the rows a delete would
      // destroy via the profiles cascade. Superadmin only, like DELETE itself.
      if (req.query.action === 'deletion-impact') {
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })

        const impact = await buildDeletionImpact(id)
        if (impact.error) return sendServerError(res, impact.error, 'admin-users:deletion-impact')
        return res.json(impact.data)
      }

      const { error } = await verifyCommittee(req)
      if (error) return res.status(statusForAuthError(error)).json({ error })

      const [
        { data: registrations, error: e1 },
        { data: payments, error: e2 },
      ] = await Promise.all([
        supabaseAdmin
          .from('zltac_registrations')
          .select(USER_REGISTRATION_COLUMNS)
          .eq('user_id', id)
          .order('year', { ascending: false }),
        supabaseAdmin
          .from('payments')
          .select(USER_PAYMENT_COLUMNS)
          .eq('user_id', id)
          .order('created_at', { ascending: false }),
      ])

      const errs = [e1, e2].filter(Boolean)
      if (errs.length) return sendServerError(res, errs[0], 'admin-users:history')
      return res.json({ registrations, payments })
    }

    if (req.method === 'PATCH') {
      const { user: caller, error } = await verifyCommittee(req)
      if (error) return res.status(statusForAuthError(error)).json({ error })
      const body = req.body ?? {}

      // Block self-action: callers must not edit their own roles or suspended
      // state via this endpoint. Covers self-promotion, self-demotion lockout,
      // self-suspend lockout, and self-reset (reset rewrites roles too).
      if (canonicalizeAccountAccessTargetId(caller.id) === id) {
        return res.status(403).json({ error: 'Cannot edit your own account via this endpoint' })
      }

      if (body.action === 'reset') {
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        const { error: resetErr } = await mutateProfileAccess(caller.id, id, 'reset')
        if (resetErr) return profileAccessErrorResponse(res, resetErr, 'admin-users:reset')
        return res.json({ ok: true })
      } else if (body.action === 'remove-access') {
        // Anonymise AND revoke login. The non-destructive alternative to a
        // hard delete: the profiles row survives, so no FK cascade fires and
        // the member's records are kept.
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        const lockMetadata = {
          actorId: caller.id,
          targetUserId: id,
          action: 'remove-access',
        }
        const accessLock = await beginAccountAccessMutation(res, lockMetadata)
        if (!accessLock) return
        const runOperation = accessLock.guard.run

        try {
          const { data: target, error: targetErr } = await runOperation(
            'profile-remove-access-target-read',
            () => supabaseAdmin
              .from('profiles')
              .select(REMOVE_ACCESS_PROFILE_COLUMNS)
              .eq('id', id)
              .maybeSingle(),
          )
          if (targetErr) return sendServerError(res, targetErr, 'admin-users:remove-access-target')
          if (!target) return res.status(404).json({ error: 'User not found' })

          // Placeholders have no auth.users row, so there is no login to
          // revoke. A 404 from the auth API (real profile whose auth user is
          // already gone) is treated the same way: nothing to ban, still
          // anonymise. Other errors are read back because the Auth mutation
          // may have committed before its HTTP response was lost.
          let authChanged = false
          let previousAuthState = {
            exists: false,
            suspended: null,
            bannedUntil: null,
            error: null,
          }
          if (!target.is_placeholder) {
            previousAuthState = await readAuthSuspensionState({
              supabase: supabaseAdmin,
              userId: id,
              runOperation,
              operationLabel: 'auth-remove-access-preflight-read',
            })
            if (previousAuthState.error) {
              return sendAccountAccessReconciliationRequired(
                res,
                new Error(
                  'The existing authentication ban state could not be read safely.',
                  { cause: previousAuthState.error },
                ),
                'admin-users:remove-access-auth-preflight',
                {
                  ...lockMetadata,
                  authPreflightError: previousAuthState.error.message,
                },
              )
            }

            if (previousAuthState.exists) {
              let banErr
              try {
                const result = await runOperation(
                  'auth-remove-access-ban',
                  () => supabaseAdmin.auth.admin.updateUserById(id, {
                    ban_duration: PERMANENT_BAN,
                  }),
                )
                banErr = result.error
              } catch (error) {
                if (isAccountAccessLockSafetyError(error)) throw error
                banErr = error
              }
              if (banErr && banErr.status !== 404) {
                const reconciliation = await readAuthSuspensionState({
                  supabase: supabaseAdmin,
                  userId: id,
                  runOperation,
                  operationLabel: 'auth-remove-access-reconciliation-read',
                })
                if (!reconciliation.error && reconciliation.exists === false) {
                  previousAuthState = reconciliation
                  banErr = null
                } else if (!reconciliation.error && reconciliation.suspended === true) {
                  authChanged = true
                  banErr = null
                } else if (!reconciliation.error && reconciliation.exists === true) {
                  return sendServerError(res, banErr, 'admin-users:remove-access-auth')
                } else {
                  const reconciliationError = reconciliation.error
                    ?? new Error('The authentication ban state could not be determined.')
                  return sendAccountAccessReconciliationRequired(
                    res,
                    new Error(
                      'The authentication ban result could not be reconciled automatically.',
                      { cause: reconciliationError },
                    ),
                    'admin-users:remove-access-auth-reconciliation-required',
                    {
                      ...lockMetadata,
                      authError: banErr?.message,
                      authReconciliationError: reconciliationError.message,
                    },
                  )
                }
              }
              authChanged = authChanged || (!banErr && previousAuthState.exists)
              if (banErr?.status === 404) {
                previousAuthState = {
                  exists: false,
                  suspended: null,
                  bannedUntil: null,
                  error: null,
                }
                authChanged = false
              }
            }
          }

          let removeErr
          try {
            const result = await runOperation(
              'profile-remove-access-mutation',
              () => mutateProfileAccess(caller.id, id, 'remove-access'),
            )
            removeErr = result.error
          } catch (error) {
            if (isAccountAccessLockSafetyError(error)) throw error
            removeErr = error
          }
          if (removeErr) {
            const reconciliation = await readRemoveAccessState(id, runOperation)
            if (!reconciliation.error && removeAccessCommitted(reconciliation.data)) {
              return res.json({ ok: true, reconciled: true })
            }

            const priorStateConfirmed = !reconciliation.error
              && removeAccessPriorStateConfirmed(reconciliation.data, target)
            if (!priorStateConfirmed) {
              const reconciliationError = reconciliation.error
                ?? new Error('The remove-access profile state could not be determined.')
              const cause = new Error(
                'The remove-access result could not be reconciled automatically.',
                { cause: reconciliationError },
              )
              return sendAccountAccessReconciliationRequired(
                res,
                cause,
                'admin-users:remove-access-reconciliation-required',
                {
                  ...lockMetadata,
                  profileError: removeErr?.message,
                  reconciliationError: reconciliationError.message,
                },
              )
            }

            if (authChanged) {
              let restoreErr
              try {
                const rollbackBanDuration = authBanDurationForState(previousAuthState)
                const result = await runOperation(
                  'auth-remove-access-rollback',
                  () => supabaseAdmin.auth.admin.updateUserById(id, {
                    ban_duration: rollbackBanDuration,
                  }),
                )
                restoreErr = result.error
              } catch (error) {
                if (isAccountAccessLockSafetyError(error)) throw error
                restoreErr = error
              }
              if (restoreErr) {
                return sendAccountAccessReconciliationRequired(
                  res,
                  new Error('Profile mutation failed and the authentication ban could not be restored.'),
                  'admin-users:remove-access-rollback',
                  {
                    ...lockMetadata,
                    profileError: removeErr?.message,
                    rollbackError: restoreErr?.message,
                  },
                )
              }
            }
            return profileAccessErrorResponse(res, removeErr, 'admin-users:remove-access')
          }
          return res.json({ ok: true })
        } catch (error) {
          if (isAccountAccessLockSafetyError(error)) {
            return sendAccountAccessSafetyFailure(res, error, lockMetadata)
          }
          return sendServerError(res, error, 'admin-users:remove-access-unexpected')
        } finally {
          await endAccountAccessMutation(accessLock, lockMetadata)
        }
      } else if (Array.isArray(body.roles)) {
        // Any change to roles requires superadmin (committee alone cannot
        // promote/demote other users, nor grant 'superadmin' to anyone).
        // This subsumes the explicit "reject roles containing 'superadmin'
        // unless caller is superadmin" rule.
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        const roleValidation = validateProfileRoles(body.roles)
        if (roleValidation.error) return res.status(400).json({ error: roleValidation.error })
        const payload = { roles: roleValidation.roles }
        if (Object.prototype.hasOwnProperty.call(body, 'alsa_position')) {
          const pos = typeof body.alsa_position === 'string' ? body.alsa_position.trim() : ''
          payload.alsa_position = pos || null
        }
        const { error: roleErr } = await mutateProfileAccess(caller.id, id, 'roles', payload)
        if (roleErr) return profileAccessErrorResponse(res, roleErr, 'admin-users:roles')
        return res.json({ ok: true })
      } else if (typeof body.suspended === 'boolean') {
        const lockMetadata = {
          actorId: caller.id,
          targetUserId: id,
          action: body.suspended ? 'suspend' : 'restore',
        }
        const accessLock = await beginAccountAccessMutation(res, lockMetadata)
        if (!accessLock) return
        const runOperation = accessLock.guard.run

        try {
          const { data: target, error: targetErr } = await runOperation(
            'profile-suspension-target-read',
            () => supabaseAdmin
              .from('profiles')
              .select('roles, suspended, is_placeholder, access_revoked_at')
              .eq('id', id)
              .maybeSingle(),
          )
          if (targetErr) return sendServerError(res, targetErr, 'admin-users:suspension-target')
          if (!target) return res.status(404).json({ error: 'User not found' })
          if (target.access_revoked_at) {
            return res.status(409).json({ error: 'Account access has been permanently removed.' })
          }
          if (body.suspended && (target.roles ?? []).includes('superadmin')) {
            return res.status(409).json({
              error: 'Remove the superadmin role before suspending this account.',
            })
          }
          const result = await setUserSuspension({
            supabase: supabaseAdmin,
            userId: id,
            suspended: body.suspended,
            previousSuspended: target.suspended,
            isPlaceholder: target.is_placeholder,
            accessRevokedAt: target.access_revoked_at,
            actorId: caller.id,
            runOperation,
          })
          if (result.error) {
            if (result.reconciliationRequired) {
              const context = 'admin-users:suspension-reconciliation-required'
              console.error(`[${context}]`, result.cause?.message ?? result.error)
              captureServerException(result.cause ?? new Error(result.error), context, {
                actorId: caller.id,
                targetUserId: id,
                requestedSuspended: body.suspended,
                previousSuspended: target.suspended,
                authPreflightError: result.authPreflightError?.message,
                authError: result.authError?.message,
                authReconciliationError: result.authReconciliationError?.message,
                profileError: result.profileError?.message,
                rollbackError: result.rollbackError?.message,
                reconciliationError: result.reconciliationError?.message,
              })
              return res.status(503).json({
                error: 'Account access could not be reconciled automatically. Escalate to a superadmin before retrying.',
                code: 'ACCOUNT_ACCESS_RECONCILIATION_REQUIRED',
              })
            }
            return profileAccessErrorResponse(
              res,
              result.cause ?? new Error(result.error),
              'admin-users:suspension',
            )
          }
          return res.json({ ok: true })
        } catch (error) {
          if (isAccountAccessLockSafetyError(error)) {
            return sendAccountAccessSafetyFailure(res, error, lockMetadata)
          }
          return sendServerError(res, error, 'admin-users:suspension-unexpected')
        } finally {
          await endAccountAccessMutation(accessLock, lockMetadata)
        }
      } else if (Object.prototype.hasOwnProperty.call(body, 'alias')) {
        // Authority: editing the alias of a target whose roles include
        // 'superadmin' requires superadmin (mirrors the suspend guard). The
        // whole-endpoint self-block above already prevents editing your own row.
        const { data: target, error: targetErr } = await supabaseAdmin
          .from('profiles')
          .select('roles, access_revoked_at')
          .eq('id', id)
          .maybeSingle()
        if (targetErr) return sendServerError(res, targetErr, 'admin-users:alias-target')
        if (!target) return res.status(404).json({ error: 'User not found' })
        if (target.access_revoked_at) {
          return res.status(409).json({ error: 'Account access has been permanently removed.' })
        }
        if ((target.roles ?? []).includes('superadmin')) {
          const { error: superErr } = await verifySuperAdmin(req)
          if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        }

        const result = await changeProfileAlias({
          supabase: supabaseAdmin,
          targetProfileId: id,
          newAlias: body.alias,
          reason: body.alias_change_reason,
          changedBy: caller.id,
          source: 'admin-users',
        })
        if (result.error) {
          if (result.status >= 500) {
            return sendServerError(res, new Error(result.error), 'admin-users:alias')
          }
          return res.status(result.status).json({ error: result.error })
        }
        return res.json({ ok: true, alias: result.data?.alias ?? null })
      } else {
        return res.status(400).json({ error: 'roles, suspended, or action is required' })
      }
    }

    if (req.method === 'DELETE') {
      // Hard delete is restricted to empty placeholder profiles. Real portal
      // accounts and any profile with governance, financial, membership,
      // certification, registration, or legal history must use Remove access
      // so the profile key and its evidence remain intact.
      const { user: caller, error: superErr } = await verifySuperAdmin(req)
      if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
      if (caller.id === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' })
      }

      const { data: target, error: targetErr } = await supabaseAdmin
        .from('profiles')
        .select('is_placeholder')
        .eq('id', id)
        .maybeSingle()
      if (targetErr) return sendServerError(res, targetErr, 'admin-users:delete-target')
      if (!target) return res.status(404).json({ error: 'User not found' })

      const FK_BLOCK_MESSAGE = 'This account has retained history and cannot be hard-deleted. Use Remove access instead.'
      const REAL_ACCOUNT_MESSAGE = 'Portal accounts cannot be hard-deleted. Use Remove access to disable login and anonymise personal details.'
      const isFkViolation = (e) =>
        e?.code === '23503' || /foreign key|violates.*constraint/i.test(e?.message ?? '')

      const impact = await buildDeletionImpact(id)
      if (impact.error) return sendServerError(res, impact.error, 'admin-users:delete-impact')
      if (!target.is_placeholder) {
        return res.status(409).json({ error: REAL_ACCOUNT_MESSAGE, impact: impact.data })
      }
      if (!impact.data.can_delete) {
        return res.status(409).json({ error: FK_BLOCK_MESSAGE, impact: impact.data })
      }

      try {
        const { error: delErr } = await supabaseAdmin.from('profiles').delete().eq('id', id)
        if (delErr) {
          if (isFkViolation(delErr)) return res.status(409).json({ error: FK_BLOCK_MESSAGE })
          return sendServerError(res, delErr, 'admin-users:delete')
        }
      } catch (err) {
        if (isFkViolation(err)) return res.status(409).json({ error: FK_BLOCK_MESSAGE })
        return sendServerError(res, err, 'admin-users:delete-exception')
      }
      return res.json({ deleted: true, impact: impact.data })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Bulk GET: no ?id
  const { error } = await verifyCommittee(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

  if (req.method === 'GET') {
    const { data, error: listErr } = await buildUsersPage(req)
    if (listErr) return sendServerError(res, listErr, 'admin-users:list')
    return res.json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
