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

  // Tracks the user id whose profile is currently in-flight or already loaded,
  // so the getSession() recovery and the SIGNED_IN emit don't double-fetch on
  // one boot. Set before the await (marks in-flight); reset to null on error so
  // a later emit can retry, and on SIGNED_OUT so a re-sign-in re-fetches.
  const fetchedForUserId = useRef(null)

  async function fetchProfile(userId, { force = false } = {}) {
    if (!force && fetchedForUserId.current === userId) return
    fetchedForUserId.current = userId
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
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
      if (event === 'SIGNED_IN' && u) {
        fetchProfile(u.id)
      }
      if (event === 'SIGNED_OUT') {
        fetchedForUserId.current = null
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  const userRoles = profile?.roles ?? ['player']
  const isAdmin = isCommittee(profile)
  const isCaptain = userRoles.includes('captain')
  function hasRole(role) { return userRoles.includes(role) }
  function refreshProfile() { if (user) fetchProfile(user.id, { force: true }) }

  return (
    <AuthContext.Provider value={{ user, loading, profileLoading, profileError, signOut, profile, userRoles, isAdmin, isCaptain, hasRole, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
