// Single source of truth for event lifecycle phase. Pure helper — no
// imports — so it works in both client (src/) and server (api/) contexts.
//
//   status = draft                                  → 'locked'
//   status = closed / archived / unknown            → 'closed'
//   status = open and now < reg_close_date (or null) → 'open'
//   reg_close_date <= now < event_starts_at     → 'locked'
//   event_starts_at <= now                      → 'closed'
//
// Both timestamps are nullable: a null reg_close_date means no lock
// boundary (phase stays 'open' indefinitely); a null event_starts_at
// means the locked phase never expires into 'closed'. This matches the
// pre-migration behaviour for any event row that hasn't been configured.
//
// New callers must also select `status`. Timestamp-only objects retain the
// historical date calculation for compatibility, but a missing event fails
// closed instead of being treated as open.

export function eventPhase(event, now = new Date()) {
  if (!event) return 'closed'

  if (Object.prototype.hasOwnProperty.call(event, 'status')) {
    if (event.status === 'draft') return 'locked'
    if (event.status !== 'open') return 'closed'
  }

  const t = now instanceof Date ? now : new Date(now)
  const open = event.reg_open_date ? new Date(event.reg_open_date) : null
  const lock = event.reg_close_date ? new Date(event.reg_close_date) : null
  const start = event.event_starts_at ? new Date(event.event_starts_at) : null
  if (start && t >= start) return 'closed'
  if (open && t < open) return 'locked'
  if (lock && t >= lock) return 'locked'
  return 'open'
}

export const LOCKED_MESSAGE =
  'Registration is locked. Contact the committee for changes.'

export const COMMITTEE_EMAIL = 'committee@lasersport.org.au'
