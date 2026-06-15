import supabaseAdmin from './supabase.js'

// Single source of truth for competition_registrations.amount_paid and
// payment_status. Sibling to computeAmountOwing.js (ZLTAC's amount_owing
// recompute helper).
//
// UNIT NOTE: as of the Batch-3 cents migration, payment_records.amount AND the
// parent's amount_paid / amount_owing are ALL integer cents. This helper is now
// cents end-to-end — no dollars boundary remains here.
//
// Status thresholds (exact integer-cents comparison):
//   amount_paid <= 0                       -> 'unpaid'
//   0 < amount_paid < amount_owing         -> 'partial'
//   amount_paid == amount_owing            -> 'paid'
//   amount_paid > amount_owing             -> 'overpaid'
//
// 'refunded' is a reserved manual state. If the current status is
// 'refunded', this helper preserves it and does NOT update the row — a
// future cancel/refund flow owns that transition.
export async function computeCompetitionAmountPaid(competitionRegistrationId) {
  if (!competitionRegistrationId) return { error: 'competitionRegistrationId is required' }

  // Load current parent state. Needed for amount_owing comparison + the
  // 'refunded' short-circuit. amount_owing is integer cents.
  const { data: reg, error: regErr } = await supabaseAdmin
    .from('competition_registrations')
    .select('id, amount_owing, amount_paid, payment_status')
    .eq('id', competitionRegistrationId)
    .maybeSingle()
  if (regErr) return { error: regErr.message }
  if (!reg) return { error: 'Competition registration not found' }

  // Refunded short-circuit. Preserve the manual state; do not recompute.
  // amount_paid is already cents, returned verbatim.
  if (reg.payment_status === 'refunded') {
    return { amount_paid: reg.amount_paid ?? 0, payment_status: 'refunded', skipped: true }
  }

  // Sum the ledger in cents.
  const { data: rows, error: sumErr } = await supabaseAdmin
    .from('payment_records')
    .select('amount')
    .eq('competition_registration_id', competitionRegistrationId)
  if (sumErr) return { error: sumErr.message }
  const amountPaid = (rows ?? []).reduce((acc, r) => acc + (r.amount ?? 0), 0)

  // Both operands are integer cents, so === is an exact comparison.
  const amountOwing = reg.amount_owing ?? 0

  let status
  if (amountPaid <= 0) status = 'unpaid'
  else if (amountPaid < amountOwing) status = 'partial'
  else if (amountPaid === amountOwing) status = 'paid'
  else status = 'overpaid'

  const { error: updErr } = await supabaseAdmin
    .from('competition_registrations')
    .update({ amount_paid: amountPaid, payment_status: status })
    .eq('id', competitionRegistrationId)
  if (updErr) return { error: updErr.message }

  return { amount_paid: amountPaid, payment_status: status }
}
