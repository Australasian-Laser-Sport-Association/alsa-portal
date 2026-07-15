import supabaseAdmin from './supabase.js'
import { eventPhase, LOCKED_MESSAGE } from '../../src/lib/eventPhase.js'

// Resolve the current phase for an event by year. Uses service-role to
// bypass RLS — needs read access to status / reg_close_date / event_starts_at on
// events even for anon-facing calls.
export async function getEventPhase(year) {
  if (year == null) return { phase: 'closed', event: null }
  const { data, error } = await supabaseAdmin
    .from('zltac_events')
    .select('status, reg_open_date, reg_close_date, event_starts_at')
    .eq('year', year)
    .maybeSingle()
  if (error) return { phase: 'closed', event: null, error }
  return { phase: eventPhase(data), event: data ?? null }
}

// Guard for player-facing mutation endpoints. Resolves to { ok: true }
// when the event is in 'open' phase, or { error, phase, status } when
// the caller should be rejected with 403.
export async function requireOpenPhase(year) {
  const { phase, error } = await getEventPhase(year)
  if (error) {
    return {
      error: 'The event lifecycle could not be verified. Please try again.',
      phase: 'closed',
      status: 503,
    }
  }
  if (phase === 'open') return { ok: true, phase }
  return { error: LOCKED_MESSAGE, phase, status: 403 }
}
