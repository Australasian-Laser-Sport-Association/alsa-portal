// auth.admin ban_duration uses Go duration syntax. Approximately 100 years is
// effectively permanent, while 'none' explicitly lifts a ban.
export const PERMANENT_BAN = '876600h'

export async function setUserSuspension({ supabase, userId, suspended, previousSuspended, isPlaceholder }) {
  let authChanged = false

  if (!isPlaceholder) {
    const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: suspended ? PERMANENT_BAN : 'none',
    })
    if (authError && authError.status !== 404) {
      return { error: `Could not ${suspended ? 'suspend' : 'restore'} login: ${authError.message}` }
    }
    authChanged = !authError
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ suspended })
    .eq('id', userId)

  if (profileError) {
    // Auth and Postgres cannot share a transaction. Restore the prior Auth ban
    // state on a profile-write failure so the two sources do not silently drift.
    if (authChanged) {
      await supabase.auth.admin.updateUserById(userId, {
        ban_duration: previousSuspended ? PERMANENT_BAN : 'none',
      })
    }
    return { error: profileError.message }
  }

  return { error: null }
}

