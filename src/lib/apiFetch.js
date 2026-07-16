import { supabase } from './supabase.js'

async function requestWithSession(path, options, session) {
  const headers = {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(options.headers ?? {}),
  }
  return fetch(path, { ...options, headers })
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
