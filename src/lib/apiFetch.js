import { supabase } from './supabase.js'

const NETWORK_ERROR_MESSAGE = 'Unable to reach the portal. Check your internet connection. If the problem continues, temporarily disable any ad blockers, script blockers, or other content-blocking extensions for this site, or add the site to their allowlist, then try again.'

async function requestWithSession(path, options, session) {
  const headers = {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(options.headers ?? {}),
  }
  try {
    return await fetch(path, { ...options, headers })
  } catch (error) {
    if (error?.name === 'TypeError' || error?.name === 'NetworkError') {
      throw new Error(NETWORK_ERROR_MESSAGE, { cause: error })
    }
    throw error
  }
}

async function errorFromResponse(res) {
  const body = await res.json().catch(() => ({ error: res.statusText }))
  return body.error ?? res.statusText
}

export async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  let res = await requestWithSession(path, options, session)

  if (res.status === 401) {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession()
    if (refreshed?.access_token && refreshed.access_token !== session?.access_token) {
      res = await requestWithSession(path, options, refreshed)
    }
  }

  if (!res.ok) {
    const message = await errorFromResponse(res)
    if (res.status === 401) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      throw new Error('Your session expired. Please sign in again.')
    }
    throw new Error(message)
  }
  return res.json()
}
