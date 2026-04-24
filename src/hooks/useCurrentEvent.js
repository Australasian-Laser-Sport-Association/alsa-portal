import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useCurrentEvent() {
  const [event, setEvent] = useState(undefined) // undefined = loading, null = none
  useEffect(() => {
    supabase
      .from('zltac_events')
      .select('id, name, year, location, logo_url, reg_open_date, reg_close_date')
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => setEvent(error ? null : (data ?? null)))
      .catch(() => setEvent(null))
  }, [])
  const eventName = event ? `${event.name} ${event.year}` : 'ZLTAC'
  return { event, eventName, loading: event === undefined }
}
