import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useCurrentEvent() {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase
      .from('zltac_events')
      .select('id, name, year, location, status, logo_url, reg_open_date, reg_close_date, start_date, end_date')
      .in('status', ['open', 'upcoming'])
      .order('status', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        setEvent(error ? null : (data ?? null))
        setLoading(false)
      })
      .catch(() => {
        setEvent(null)
        setLoading(false)
      })
  }, [])
  const eventName = event ? `${event.name} ${event.year}` : 'ZLTAC'
  return { event, eventName, loading }
}
