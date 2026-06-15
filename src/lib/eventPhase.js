// Single source of truth for event lifecycle phase. Pure helper — no
// imports — so it works in both client (src/) and server (api/) contexts.
//
//   now <  reg_close_date  (or null)            → 'open'
//   reg_close_date <= now < event_starts_at     → 'locked'
//   event_starts_at <= now                      → 'closed'
//
// Both timestamps are nullable: a null reg_close_date means no lock
// boundary (phase stays 'open' indefinitely); a null event_starts_at
// means the locked phase never expires into 'closed'. This matches the
// pre-migration behaviour for any event row that hasn't been configured.
//
// The event argument needs only the two timestamp fields:
//   { reg_close_date: string|Date|null, event_starts_at: string|Date|null }

export function eventPhase(event, now = new Date()) {
  if (!event) return 'open'
  const t = now instanceof Date ? now : new Date(now)
  const lock = event.reg_close_date ? new Date(event.reg_close_date) : null
  const start = event.event_starts_at ? new Date(event.event_starts_at) : null
  if (start && t >= start) return 'closed'
  if (lock && t >= lock) return 'locked'
  return 'open'
}

export const LOCKED_MESSAGE =
  'Registration is locked. Contact the committee for changes.'

export const COMMITTEE_EMAIL = 'committee@lasersport.org.au'
