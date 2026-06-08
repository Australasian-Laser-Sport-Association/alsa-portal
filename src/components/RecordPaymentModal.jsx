import { useState } from 'react'
import { apiFetch } from '../lib/apiFetch.js'
import { dollars } from '../lib/pricing.js'
import { formatDate } from '../lib/dateFormat'

const today = () => new Date().toISOString().slice(0, 10)

function toCents(dollarStr) {
  const n = parseFloat(dollarStr)
  if (Number.isNaN(n)) return null
  return Math.round(n * 100)
}

// apiResource selects the backend wiring:
//   'event'                       → ZLTAC: POST /api/admin/event?resource=payments
//                                   (positive amountCents + type='payment'|'refund')
//   'competition-payment-records' → pre-nats: POST /api/superadmin/competition-payment-records
//                                   (signed amount_dollars; refund-reason folded into notes)
// amountOwingCents lets pre-nats callers pass the integer-cents value derived
// from their dollar-stored parent. ZLTAC callers omit it and the modal falls
// back to registration.amount_owing (already cents on that path).
export default function RecordPaymentModal({
  registration,
  profile,
  records,
  profMap,
  onChange,
  onClose,
  apiResource = 'event',
  amountOwingCents,
}) {
  const isCompetition = apiResource === 'competition-payment-records'
  const apiUrl = isCompetition
    ? '/api/superadmin/competition-payment-records'
    : '/api/admin/event?resource=payments'
  const [newForm, setNewForm] = useState({ amount: '', datePaid: today(), bankRef: '', notes: '', reason: '' })
  // Refund flow state. refundMode flips on the first "Record Refund" click and
  // reveals the Reason field. confirmingRefund gates the actual submit behind
  // an inline "Confirm refund of $X for [player]?" strip.
  const [refundMode, setRefundMode] = useState(false)
  const [confirmingRefund, setConfirmingRefund] = useState(false)
  const [editForm, setEditForm] = useState(null) // { id, amount, datePaid, bankRef, notes } | null
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Pre-nats parents store dollars; the panel converts and passes
  // amountOwingCents so this internal cents-based math stays unchanged.
  const amountOwing = amountOwingCents ?? registration.amount_owing ?? 0
  const amountPaid = records.reduce((s, r) => s + r.amount, 0)
  const balance = amountOwing - amountPaid
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Unknown'

  function resolveRecorder(id) {
    const p = id ? profMap[id] : null
    if (!p) return '—'
    return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.alias || '—'
  }

  function validatePositiveAmount() {
    const cents = toCents(newForm.amount)
    if (cents === null || cents <= 0) {
      setError('Amount must be a positive dollar value.')
      return null
    }
    return cents
  }

  async function postRecord(cents, type) {
    setSaving(true)
    try {
      let body
      if (isCompetition) {
        // Pre-nats: signed dollars, no type field, refund reason folded
        // into notes. Server stores amount as signed cents.
        const trimmedNotes = newForm.notes?.trim() ?? ''
        const trimmedReason = newForm.reason?.trim() ?? ''
        const notes = type === 'refund' && trimmedReason
          ? (trimmedNotes ? `Refund — ${trimmedReason} · ${trimmedNotes}` : `Refund — ${trimmedReason}`)
          : (trimmedNotes || null)
        const signedCents = type === 'refund' ? -cents : cents
        body = {
          competition_registration_id: registration.id,
          amount_dollars: signedCents / 100,
          recorded_at: newForm.datePaid || today(),
          bank_reference: newForm.bankRef,
          notes,
        }
      } else {
        body = {
          registrationId: registration.id,
          amountCents: cents,
          datePaid: newForm.datePaid || today(),
          bankReference: newForm.bankRef,
          notes: newForm.notes,
          type,
          reason: type === 'refund' ? newForm.reason : undefined,
        }
      }
      const { records: fresh, summary } = await apiFetch(apiUrl, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      onChange(fresh, summary)
      setNewForm({ amount: '', datePaid: today(), bankRef: '', notes: '', reason: '' })
      setRefundMode(false)
      setConfirmingRefund(false)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  // "Record Payment" button — always submits as a payment, even if refundMode
  // had been toggled. Clears refund state so the modal returns to its normal
  // payment-default shape on success.
  async function clickRecordPayment(e) {
    e?.preventDefault?.()
    setError('')
    setConfirmingRefund(false)
    const cents = validatePositiveAmount()
    if (cents == null) return
    await postRecord(cents, 'payment')
  }

  // "Record Refund" button — multi-step:
  //   1. First click → flip into refundMode (reveals Reason field).
  //   2. With refundMode on but empty reason → inline error.
  //   3. With reason filled and no pending confirmation → show confirm strip.
  //   4. Confirmation strip's confirm button → submits as refund.
  async function clickRecordRefund(e) {
    e?.preventDefault?.()
    setError('')
    const cents = validatePositiveAmount()
    if (cents == null) return

    if (!refundMode) {
      setRefundMode(true)
      return
    }
    if (!newForm.reason.trim()) {
      setError('Reason is required for refunds.')
      return
    }
    if (!confirmingRefund) {
      setConfirmingRefund(true)
      return
    }
    await postRecord(cents, 'refund')
  }

  function cancelRefundConfirm() {
    setConfirmingRefund(false)
  }

  async function submitEdit(e) {
    e.preventDefault()
    setError('')
    const cents = toCents(editForm.amount)
    if (cents === null || cents === 0) { setError('Amount must be a non-zero dollar value.'); return }
    setSaving(true)
    try {
      // The edit form holds a signed dollar string (refunds display as
      // negative). cents is already signed. Pre-nats path expects id as a
      // query param and signed dollars in the body; ZLTAC path uses
      // amountCents inline.
      let url, body
      if (isCompetition) {
        url = `${apiUrl}?id=${encodeURIComponent(editForm.id)}`
        body = {
          amount_dollars: cents / 100,
          recorded_at: editForm.datePaid || today(),
          bank_reference: editForm.bankRef,
          notes: editForm.notes,
        }
      } else {
        url = apiUrl
        body = {
          id: editForm.id,
          amountCents: cents,
          datePaid: editForm.datePaid || today(),
          bankReference: editForm.bankRef,
          notes: editForm.notes,
        }
      }
      const { records: fresh, summary } = await apiFetch(url, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      onChange(fresh, summary)
      setEditForm(null)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function confirmDelete(id) {
    setError('')
    setSaving(true)
    try {
      const url = isCompetition ? `${apiUrl}?id=${encodeURIComponent(id)}` : apiUrl
      const init = isCompetition
        ? { method: 'DELETE' }
        : { method: 'DELETE', body: JSON.stringify({ id }) }
      const { records: fresh, summary } = await apiFetch(url, init)
      onChange(fresh, summary)
      setDeleteConfirmId(null)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  function startEdit(rec) {
    setDeleteConfirmId(null)
    setEditForm({
      id: rec.id,
      amount: (rec.amount / 100).toFixed(2),
      datePaid: (rec.recorded_at ?? '').slice(0, 10) || today(),
      bankRef: rec.bank_reference ?? '',
      notes: rec.notes ?? '',
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-lg my-auto">
        {/* Header */}
        <div className="p-6 border-b border-line">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-white font-bold text-lg">Record Payment or Refund</h2>
              <p className="text-[#e5e5e5]/50 text-sm mt-0.5">
                {name}{profile?.alias ? <span className="text-brand"> ({profile.alias})</span> : ''}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-[#e5e5e5]/40 hover:text-white text-2xl leading-none">×</button>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40">Payment Reference</p>
              <p className="text-white font-mono text-sm mt-0.5 select-all">{registration.payment_reference ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40">Amount Owing</p>
              <p className="text-white font-bold text-sm mt-0.5">{dollars(amountOwing)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40">Paid to Date</p>
              <p className="text-white font-bold text-sm mt-0.5">{dollars(amountPaid)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40">Balance Remaining</p>
              <p className={`font-black text-sm mt-0.5 ${balance > 0 ? 'text-red-400' : balance < 0 ? 'text-blue-400' : 'text-green-400'}`}>
                {dollars(balance)}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* New payment / refund form */}
        <form onSubmit={clickRecordPayment} className="p-6 border-b border-line space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40">
            New Payment or Refund
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#e5e5e5]/50 mb-1">Amount (AUD) *</label>
              <input
                type="number" min="0.01" step="0.01" required
                value={newForm.amount}
                onChange={e => { setNewForm(f => ({ ...f, amount: e.target.value })); setConfirmingRefund(false) }}
                placeholder="0.00"
                className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs text-[#e5e5e5]/50 mb-1">Date</label>
              <input
                type="date"
                value={newForm.datePaid}
                onChange={e => setNewForm(f => ({ ...f, datePaid: e.target.value }))}
                className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 mb-1">Bank Reference</label>
            <input
              type="text"
              value={newForm.bankRef}
              onChange={e => setNewForm(f => ({ ...f, bankRef: e.target.value }))}
              placeholder="What showed on the bank statement"
              className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 mb-1">Notes</label>
            <textarea
              rows={2}
              value={newForm.notes}
              onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand resize-none"
            />
          </div>

          {/* Reason field — revealed once "Record Refund" is clicked. Required
              for refund submissions; ignored for payments. */}
          {refundMode && (
            <div>
              <label className="block text-xs text-[#e5e5e5]/50 mb-1">
                Refund reason *
              </label>
              <input
                type="text"
                value={newForm.reason}
                onChange={e => { setNewForm(f => ({ ...f, reason: e.target.value })); setConfirmingRefund(false) }}
                placeholder="e.g. Cancelled side event, Overpaid"
                autoFocus
                className="w-full bg-base border border-red-500/40 rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-red-400"
              />
            </div>
          )}

          {/* Two-button row. The default form submit (Enter key) maps to
              Record Payment, matching its `type="submit"`. */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || confirmingRefund}
              onClick={clickRecordPayment}
              className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm transition-colors"
            >
              {saving && !confirmingRefund ? 'Saving…' : 'Record Payment'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={clickRecordRefund}
              className="bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 disabled:opacity-50 text-red-400 font-bold py-2.5 rounded-xl text-sm transition-colors"
            >
              {!refundMode
                ? 'Record Refund'
                : confirmingRefund
                  ? (saving ? 'Saving…' : 'Confirm refund')
                  : 'Record Refund'}
            </button>
          </div>

          {/* Confirmation strip — shown only after a valid refund click. */}
          {confirmingRefund && (
            <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
              <p className="text-xs text-red-400">
                Confirm refund of <strong>{dollars(toCents(newForm.amount) ?? 0)}</strong> for <strong>{name}</strong>?
              </p>
              <button
                type="button"
                onClick={cancelRefundConfirm}
                className="text-xs text-[#e5e5e5]/60 hover:text-white font-semibold px-2 py-1 rounded transition-colors flex-shrink-0"
              >
                Cancel
              </button>
            </div>
          )}
        </form>

        {/* History */}
        <div className="p-6">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40 mb-3">
            Payment History ({records.length})
          </p>
          {records.length === 0 ? (
            <p className="text-[#e5e5e5]/30 text-sm">No payments recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {records.map(rec => (
                editForm?.id === rec.id ? (
                  <form key={rec.id} onSubmit={submitEdit} className="bg-base border border-brand/40 rounded-xl p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number" step="0.01" required value={editForm.amount}
                        onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                        className="bg-surface border border-line rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                      />
                      <input
                        type="date" value={editForm.datePaid}
                        onChange={e => setEditForm(f => ({ ...f, datePaid: e.target.value }))}
                        className="bg-surface border border-line rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                      />
                    </div>
                    <input
                      type="text" value={editForm.bankRef} placeholder="Bank reference"
                      onChange={e => setEditForm(f => ({ ...f, bankRef: e.target.value }))}
                      className="w-full bg-surface border border-line rounded-lg px-2 py-1.5 text-sm text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand"
                    />
                    <textarea
                      rows={2} value={editForm.notes} placeholder="Notes"
                      onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                      className="w-full bg-surface border border-line rounded-lg px-2 py-1.5 text-sm text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit" disabled={saving}
                        className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button" onClick={() => setEditForm(null)}
                        className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-1.5 rounded-lg text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div key={rec.id} className="bg-base border border-line rounded-xl p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-bold text-sm ${rec.amount < 0 ? 'text-blue-400' : 'text-white'}`}>
                          {dollars(rec.amount)}
                          <span className="text-[#e5e5e5]/40 font-normal text-xs ml-2">{formatDate(rec.recorded_at, 'short')}</span>
                        </p>
                        {rec.bank_reference && <p className="text-[#e5e5e5]/50 text-xs mt-1">Ref: {rec.bank_reference}</p>}
                        {rec.notes && <p className="text-[#e5e5e5]/50 text-xs mt-0.5">{rec.notes}</p>}
                        <p className="text-[#e5e5e5]/30 text-[10px] mt-1">Recorded by {resolveRecorder(rec.recorded_by)}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(rec)}
                          className="text-xs text-[#e5e5e5]/50 hover:text-white hover:bg-line font-semibold px-2 py-1 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => { setEditForm(null); setDeleteConfirmId(rec.id) }}
                          className="text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2 py-1 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {deleteConfirmId === rec.id && (
                      <div className="mt-2 pt-2 border-t border-line flex items-center justify-between gap-3">
                        <span className="text-[#e5e5e5]/60 text-xs">Delete this payment?</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => confirmDelete(rec.id)} disabled={saving}
                            className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold px-3 py-1 rounded text-xs transition-colors"
                          >
                            {saving ? '…' : 'Delete'}
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-3 py-1 rounded text-xs transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
