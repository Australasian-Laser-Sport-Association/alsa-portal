import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isCommittee } from '../lib/roles'
import { AuthContext } from '../lib/useAuth'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  // Tracks the user id whose profile is currently in-flight or already loaded,
  // so the getSession() recovery and the SIGNED_IN emit don't double-fetch on
  // one boot. Set before the await (marks in-flight); reset to null on error so
  // a later emit can retry, and on SIGNED_OUT so a re-sign-in re-fetches.
  const fetchedForUserId = useRef(null)

  async function fetchProfile(userId, { force = false } = {}) {
    if (!force && fetchedForUserId.current === userId) return
    fetchedForUserId.current = userId
    // Explicit column list (not select('*')) so privileged/audit columns
    // (alsa_position, is_placeholder, placeholder_email, created_by_admin_id,
    // alsa_member_id, updated_at) and the new `email`
    // mirror don't ride along in the client context. email in particular is
    // omitted deliberately — the user's own email is read from the auth session
    // (useAuth().user.email), not from the profile row. This is exactly the set
    // consumed off the context `profile` across all useAuth() consumers.
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, alias, dob, phone, state, home_arena, emergency_contact_name, emergency_contact_phone, avatar_url, roles, suspended, created_at')
      .eq('id', userId)
      .single()
    if (error) {
      // A transient load failure must not collapse to a null profile — that
      // would flicker a committee member down to a plain player. Keep the
      // last-known profile and surface the failure via profileError instead.
      // Clear the dedup marker so the next emit (or refreshProfile) retries.
      console.error('[AuthContext fetchProfile]', error)
      fetchedForUserId.current = null
      setProfileError(error)
      setProfileLoading(false)
      return
    }
    if (data?.suspended) {
      fetchedForUserId.current = null
      setProfile(null)
      setProfileError(new Error('Account suspended'))
      setProfileLoading(false)
      await supabase.auth.signOut({ scope: 'local' })
      return
    }
    setProfileError(null)
    setProfile(data ?? null)
    setProfileLoading(false)
  }

  useEffect(() => {
    // Keep the user reference stable across redundant emits: only replace it
    // when the identity (id) actually changes, so [user]-dependent effects
    // don't re-fire on every duplicate INITIAL_SESSION / SIGNED_IN / token
    // refresh. Real sign-in (null→user), sign-out (user→null), and user switch
    // (id change) all still produce a new reference.
    const setUserStable = u => setUser(prev => (prev?.id === u?.id ? prev : u))

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUserStable(u)
      setLoading(false)
      if (u) {
        fetchProfile(u.id)
      } else {
        setProfileLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      setUserStable(u)
      if (event === 'PASSWORD_RECOVERY' && u) {
        setPasswordRecovery(true)
      }
      if (event === 'SIGNED_IN' && u) {
        fetchProfile(u.id)
      }
      if (event === 'SIGNED_OUT') {
        fetchedForUserId.current = null
        setProfile(null)
        setPasswordRecovery(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  const userRoles = profile?.roles ?? ['player']
  const isAdmin = isCommittee(profile)
  function hasRole(role) { return userRoles.includes(role) }
  function refreshProfile() { return user ? fetchProfile(user.id, { force: true }) : Promise.resolve() }
  function clearPasswordRecovery() { setPasswordRecovery(false) }

  return (
    <AuthContext.Provider value={{ user, loading, profileLoading, profileError, signOut, profile, userRoles, isAdmin, hasRole, refreshProfile, passwordRecovery, clearPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  )
}
