// Currency formatting helper. (Event/side-event fees are now event-driven —
// stored per-event in the DB — so the former hardcoded pricing tables here
// were dead and have been removed; only this formatter remains.)

export function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`
}
