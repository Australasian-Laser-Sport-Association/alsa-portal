// Single source of truth for player-facing payment availability. Pure helper —
// no imports — so it works in both client (src/) and server (api/) contexts,
// mirroring eventPhase.js.
//
// Gate model:
//   - payments_override = 'open'   → force open  (bank details visible)
//   - payments_override = 'closed' → force closed
//   - payments_override = null     → auto: open once reg_close_date has passed
//
// reg_close_date is the registration lock boundary (see eventPhase.js). When it
// passes, registrations lock and payment information becomes available to
// players, unless a committee override says otherwise. Only the bank details
// are gated — payment_reference and amount_owing always render.
//
// Returns:
//   {
//     open:    boolean,
//     opensAt: Date | null,   // populated only when reason === 'auto_closed'
//     reason:  'override_open' | 'override_closed' | 'auto_open' | 'auto_closed' | 'no_date_set'
//   }
//
// Defensive: missing/invalid event or unparseable date → closed + 'no_date_set'.

export function arePaymentsOpen(event, now = new Date()) {
  if (!event || typeof event !== 'object') {
    return { open: false, opensAt: null, reason: 'no_date_set' }
  }

  const override = event.payments_override
  if (override === 'open')   return { open: true,  opensAt: null, reason: 'override_open' }
  if (override === 'closed') return { open: false, opensAt: null, reason: 'override_closed' }

  // Auto mode (override null/absent): follow the registration lock date.
  if (!event.reg_close_date) {
    return { open: false, opensAt: null, reason: 'no_date_set' }
  }

  const lock = new Date(event.reg_close_date)
  if (isNaN(lock.getTime())) {
    return { open: false, opensAt: null, reason: 'no_date_set' }
  }

  const t = now instanceof Date ? now : new Date(now)
  if (t >= lock) return { open: true, opensAt: null, reason: 'auto_open' }
  return { open: false, opensAt: lock, reason: 'auto_closed' }
}
