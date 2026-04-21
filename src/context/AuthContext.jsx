import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

async function ensureProfile(user) {
  const { id: userId } = user

  // Guarantee a profile row exists with base player role
  await supabase
    .from('profiles')
    .upsert({ id: userId, roles: ['player'] }, { onConflict: 'id', ignoreDuplicates: true })

  // Retry any pending profile data from registration
  const pendingRaw = localStorage.getItem('pending_profile')
  if (pendingRaw) {
    try {
      const pending = JSON.parse(pendingRaw)
      if (pending.userId === userId) {
        console.log('[AuthContext] Retrying pending profile save for', userId)
        const { userId: _uid, ...profileData } = pending
        const { error } = await supabase
          .from('profiles')
          .upsert(profileData, { onConflict: 'id' })
        if (!error) {
          localStorage.removeItem('pending_profile')
          console.log('[AuthContext] Pending profile data saved and cleared')
        } else {
          console.error('[AuthContext] Pending profile retry failed:', error.message)
        }
      }
    } catch (e) {
      console.error('[AuthContext] Could not parse pending_profile from localStorage:', e)
      localStorage.removeItem('pending_profile')
    }
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) {
        ensureProfile(u)
        fetchProfile(u.id)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (event === 'SIGNED_IN' && u) {
        ensureProfile(u)
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
  const isAdmin = userRoles.some(r => ['superadmin', 'zltac_committee', 'alsa_committee'].includes(r))
  const isCaptain = userRoles.includes('captain')
  function hasRole(role) { return userRoles.includes(role) }
  function refreshProfile() { if (user) fetchProfile(user.id) }

  return (
    <AuthContext.Provider value={{ user, loading, signOut, profile, userRoles, isAdmin, isCaptain, hasRole, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
