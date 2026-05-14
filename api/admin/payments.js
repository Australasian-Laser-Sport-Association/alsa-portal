import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'

// Re-sum payment_records for a registration and derive payment status.
// payment_records affect amount_paid only — amount_owing is driven by
// registration changes, not payments, so no recompute is needed here.
async function buildResponse(registrationId) {
  const [{ data: reg, error: regErr }, { data: records, error: recErr }] = await Promise.all([
    supabaseAdmin.from('zltac_registrations').select('id, amount_owing').eq('id', registrationId).maybeSingle(),
    supabaseAdmin.from('payment_records')
      .select('id, registration_id, amount, recorded_at, recorded_by, bank_reference, notes')
      .eq('registration_id', registrationId)
      .order('recorded_at', { ascending: false }),
  ])
  if (regErr) return { error: regErr.message }
  if (recErr) return { error: recErr.message }
  if (!reg) return { error: 'Registration not found' }

  const amountOwing = reg.amount_owing ?? 0
  const amountPaid = (records ?? []).reduce((s, r) => s + r.amount, 0)
  const balance = amountOwing - amountPaid
  const status =
    balance < 0 ? 'overpaid'
    : balance === 0 ? 'paid'
    : amountPaid > 0 ? 'partial'
    : 'unpaid'

  return {
    summary: { registrationId, amountOwing, amountPaid, balance, status },
    records: records ?? [],
  }
}

function validAmount(v) {
  return Number.isInteger(v) && v !== 0
}

export default async function handler(req, res) {
  const { user, error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (req.method === 'POST') {
    const { registrationId, amountCents, datePaid, bankReference, notes } = req.body ?? {}
    if (!registrationId) return res.status(400).json({ error: 'registrationId is required' })
    if (!validAmount(amountCents)) return res.status(400).json({ error: 'amountCents must be a non-zero integer' })

    const { error: insErr } = await supabaseAdmin.from('payment_records').insert({
      registration_id: registrationId,
      amount: amountCents,
      recorded_at: datePaid || new Date().toISOString(),
      recorded_by: user.id,
      bank_reference: bankReference?.trim() || null,
      notes: notes?.trim() || null,
    })
    if (insErr) return res.status(500).json({ error: insErr.message })

    const result = await buildResponse(registrationId)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  if (req.method === 'PATCH') {
    const { id, amountCents, datePaid, bankReference, notes } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    if (!validAmount(amountCents)) return res.status(400).json({ error: 'amountCents must be a non-zero integer' })

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('payment_records').select('registration_id').eq('id', id).maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (!existing) return res.status(404).json({ error: 'Payment record not found' })

    const { error: updErr } = await supabaseAdmin.from('payment_records').update({
      amount: amountCents,
      recorded_at: datePaid || new Date().toISOString(),
      bank_reference: bankReference?.trim() || null,
      notes: notes?.trim() || null,
    }).eq('id', id)
    if (updErr) return res.status(500).json({ error: updErr.message })

    const result = await buildResponse(existing.registration_id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  if (req.method === 'DELETE') {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('payment_records').select('registration_id').eq('id', id).maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (!existing) return res.status(404).json({ error: 'Payment record not found' })

    const { error: delErr } = await supabaseAdmin.from('payment_records').delete().eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    const result = await buildResponse(existing.registration_id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
