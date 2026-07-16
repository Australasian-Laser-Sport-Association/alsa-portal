import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Shared module-level cache for the single open ZLTAC event. Previously each
// consumer (NavBar, Footer, ActiveEventBanner, Welcome) ran its own
// status='open' query — three identical ones per page from the layout alone.
// Now all consumers share one fetch: concurrent mounts dedupe onto the same
// in-flight promise, and a consumer mounting after the cache is warm reads it
// synchronously (loading:false immediately). The cache is invalidated and
// refetched on the 'alsa:event-changed' window event the admin dispatches.

const EVENT_COLUMNS =
  'id, name, year, location, status, logo_url, reg_open_date, reg_close_date, start_date, end_date'

let cachedEvent = null
let loaded = false
let inFlight = null
let listenerAttached = false
const subscribers = new Set()

function notify() {
  for (const cb of subscribers) cb()
}

function fetchOpenEvent() {
  // In-flight dedup: concurrent mounts share one query.
  if (inFlight) return inFlight
  inFlight = supabase
    .from('public_zltac_events')
    .select(EVENT_COLUMNS)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle()
    .then(({ data, error }) => {
      cachedEvent = error ? null : (data ?? null)
      loaded = true
      inFlight = null
      notify()
    })
    .catch(() => {
      cachedEvent = null
      loaded = true
      inFlight = null
      notify()
    })
  return inFlight
}

// Admin event changes dispatch 'alsa:event-changed'. Mark the cache stale
// (loading flips back to true, mirroring the old per-hook setLoading(true)),
// keep the last-known event on screen until the refetch resolves, then refetch.
function handleEventChanged() {
  loaded = false
  inFlight = null
  notify()
  fetchOpenEvent()
}

export function useCurrentEvent() {
  const [, forceRender] = useState(0)

  useEffect(() => {
    // Attach the invalidation listener once for the app lifetime. The cache is
    // a singleton, so a single shared listener replaces the per-mount add/remove.
    if (!listenerAttached) {
      listenerAttached = true
      window.addEventListener('alsa:event-changed', handleEventChanged)
    }
    const cb = () => forceRender(n => n + 1)
    subscribers.add(cb)
    if (!loaded) fetchOpenEvent()
    return () => { subscribers.delete(cb) }
  }, [])

  const event = cachedEvent
  const eventName = event ? `${event.name} ${event.year}` : 'ZLTAC'
  return { event, eventName, loading: !loaded }
}
