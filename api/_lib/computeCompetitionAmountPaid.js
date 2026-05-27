import supabaseAdmin from './supabase.js'

// Single source of truth for competition_registrations.amount_paid and
// payment_status. Sibling to computeAmountOwing.js (ZLTAC's amount_owing
// recompute helper).
//
// UNIT NOTE: payment_records.amount is integer cents. The parent's
// amount_paid / amount_owing are numeric(8,2) dollars. This helper does
// the cents -> dollars conversion at the boundary.
//
// Status thresholds:
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
  // 'refunded' short-circuit.
  const { data: reg, error: regErr } = await supabaseAdmin
    .from('competition_registrations')
    .select('id, amount_owing, payment_status')
    .eq('id', competitionRegistrationId)
    .maybeSingle()
  if (regErr) return { error: regErr.message }
  if (!reg) return { error: 'Competition registration not found' }

  // Refunded short-circuit. Preserve the manual state; do not recompute.
  if (reg.payment_status === 'refunded') {
    return { amount_paid: reg.amount_paid ?? 0, payment_status: 'refunded', skipped: true }
  }

  // Sum the ledger in cents.
  const { data: rows, error: sumErr } = await supabaseAdmin
    .from('payment_records')
    .select('amount')
    .eq('competition_registration_id', competitionRegistrationId)
  if (sumErr) return { error: sumErr.message }
  const sumCents = (rows ?? []).reduce((acc, r) => acc + (r.amount ?? 0), 0)

  // Convert to dollars. numeric(8,2) is stored as a string by Postgres but
  // can accept a number; we send a number rounded to 2 decimal places.
  const amountPaid = Math.round(sumCents) / 100
  const amountOwing = Number(reg.amount_owing ?? 0)

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
