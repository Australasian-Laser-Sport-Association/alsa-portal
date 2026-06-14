const ALIAS_MAX_LENGTH = 30
const REASON_MIN_LENGTH = 5
const ALIAS_CHANGE_SOURCES = new Set(['admin-users', 'registration-editor'])

export function normaliseAlias(value) {
  if (value == null || typeof value !== 'string') return null
  return value.trim() || null
}

export async function changeProfileAlias({
  supabase,
  targetProfileId,
  newAlias,
  reason,
  changedBy,
  source,
}) {
  const alias = normaliseAlias(newAlias)
  const trimmedReason = typeof reason === 'string' ? reason.trim() : ''

  if (alias && alias.length > ALIAS_MAX_LENGTH) {
    return { data: null, error: 'Alias must be 30 characters or fewer.', status: 400 }
  }
  if (trimmedReason.length < REASON_MIN_LENGTH) {
    return { data: null, error: 'Alias change reason must be at least 5 characters.', status: 400 }
  }
  if (!ALIAS_CHANGE_SOURCES.has(source)) {
    return { data: null, error: 'Invalid alias change source.', status: 400 }
  }

  const { data, error } = await supabase.rpc('change_profile_alias', {
    p_target_profile_id: targetProfileId,
    p_new_alias: alias,
    p_reason: trimmedReason,
    p_changed_by: changedBy,
    p_source: source,
  })

  if (!error) return { data, error: null, status: 200 }
  if (error.code === '23505') {
    return { data: null, error: 'That alias is already taken, please choose another.', status: 409 }
  }
  if (error.code === 'P0002') {
    return { data: null, error: 'User not found', status: 404 }
  }
  return { data: null, error: error.message, status: 500 }
}
