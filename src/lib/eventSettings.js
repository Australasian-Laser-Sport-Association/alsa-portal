// Helpers for reading per-event policy toggles. Centralised so the same
// rule applies everywhere a check runs.
//
// Defaults preserve pre-toggle behaviour: when a column is null on the
// event row (legacy data, or column not selected), the strictest historical
// interpretation applies — "required". This matches what the per-player
// readiness checks did before these toggles were wired up.

export function isRefTestRequired(event) {
  // Column: zltac_events.require_ref_test (boolean, defaults to true at the
  // schema level). When the event row is null or the column is missing from
  // a select, fall back to "required".
  return event?.require_ref_test !== false
}

export function isCocRequired(event) {
  // Column: zltac_events.require_coc.
  return event?.require_coc !== false
}

export function isPaymentRequired(event) {
  // Column: zltac_events.require_payment. When off, payment status is not
  // part of the "ready" computation and the Payment Details section can be
  // hidden in player-facing UI.
  return event?.require_payment !== false
}
