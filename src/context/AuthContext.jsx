import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isCommittee } from '../lib/roles'
import { AuthContext } from '../lib/useAuth'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data ?? null)
    setProfileLoading(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) {
        fetchProfile(u.id)
      } else {
        setProfileLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (event === 'SIGNED_IN' && u) {
        fetchProfile(u.id)
      }
      if (event === 'SIGNED_OUT') {
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
  function refreshProfile() { if (user) fetchProfile(user.id) }

  return (
    <AuthContext.Provider value={{ user, loading, profileLoading, signOut, profile, userRoles, isAdmin, isCaptain, hasRole, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
