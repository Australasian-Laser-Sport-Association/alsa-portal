import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useCurrentEvent() {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    function load() {
      setLoading(true)
      supabase
        .from('zltac_events')
        .select('id, name, year, location, status, logo_url, reg_open_date, reg_close_date, start_date, end_date')
        .eq('status', 'open')
        .limit(1)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return
          setEvent(error ? null : (data ?? null))
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setEvent(null)
          setLoading(false)
        })
    }
    load()
    window.addEventListener('alsa:event-changed', load)
    return () => {
      cancelled = true
      window.removeEventListener('alsa:event-changed', load)
    }
  }, [])
  const eventName = event ? `${event.name} ${event.year}` : 'ZLTAC'
  return { event, eventName, loading }
}
