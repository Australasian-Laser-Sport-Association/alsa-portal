import { useEffect, useState, useCallback } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { useAuth } from '../../lib/useAuth.js'
import { relativeTime } from '../../lib/relativeTime.js'
import CompetitionEditForm from '../../components/competition/CompetitionEditForm.jsx'
import RecordPaymentModal from '../../components/RecordPaymentModal.jsx'
import { dollars } from '../../lib/pricing.js'
import { toLocalDate } from '../../lib/dateFormat'

// Per-competition detail page for managers. Auth: the page fetches
// /api/superadmin/my-competitions and looks for a row matching :slug. If not
// found (revoked grant, archived competition, typo), shows a "Not authorised
// or competition not found" view. Real edit/registrations/payments surfaces
// ship in later phases — those tabs are intentional placeholders here.

const TABS = [
  { key: 'overview',      label: 'Overview' },
  { key: 'edit',          label: 'Edit Details' },
  { key: 'teams',         label: 'Teams' },
  { key: 'registrations', label: 'Registrations' },
  { key: 'payments',      label: 'Payments' },
]

// Distinct '-' empty fallback (not the shared helper's ''); fixed in place so
// only the unsafe date parse becomes day-shift-safe.
function formatDateRange(start, end) {
  if (!start || !end) return '-'
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  const s = toLocalDate(start).toLocaleDateString('en-AU', opts)
  const e = toLocalDate(end).toLocaleDateString('en-AU', opts)
  return s === e ? s : `${s} to ${e}`
}

function formatDateTime(iso) {
  if (!iso) return 'Not scheduled'
  const d = new Date(iso)
  return d.toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function registrationWindowStatus(comp) {
  const now = new Date()
  const open = comp.registration_open_at ? new Date(comp.registration_open_at) : null
  const close = comp.registration_close_at ? new Date(comp.registration_close_at) : null
  if (!open && !close) return { label: 'Not scheduled', tone: 'grey' }
  if (open && now < open) return { label: 'Not yet open', tone: 'amber' }
  if (close && now > close) return { label: 'Closed', tone: 'grey' }
  return { label: 'Open', tone: 'green' }
}

const TONE = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  grey:  'bg-[#374056] text-white border-line',
}

function Pill({ tone, children }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <p className="text-white text-sm">{value || <span className="opacity-40">Not set</span>}</p>
    </div>
  )
}

// Edit Details tab body. Renders the shared CompetitionEditForm with the
// manager's current row as the initial state. Pre-flights canEditAbbreviation
// from the registrations_count field that handleMyCompetitions now annotates
// onto every row.
function EditPanel({ comp, onSaved }) {
  const [savedFlash, setSavedFlash] = useState(false)
  const canEditAbbreviation = (comp.registrations_count ?? 0) === 0

  async function handleSubmit(payload) {
    const saved = await apiFetch(`/api/superadmin/competitions?id=${comp.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    onSaved(saved)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1800)
  }

  return (
    <div className="bg-surface border border-line rounded-2xl p-6 space-y-4">
      {savedFlash && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2">
          <p className="text-green-400 text-xs font-semibold">Changes saved.</p>
        </div>
      )}
      <CompetitionEditForm
        mode="edit"
        initial={comp}
        canEditAbbreviation={canEditAbbreviation}
        onSubmit={handleSubmit}
        onCancel={() => {}}
      />
    </div>
  )
}

// Payment-status pill colour map — mirrors the player hub (CompetitionHub.jsx)
// so the visual language stays consistent across surfaces.
const PAY_PILL = {
  unpaid:   { label: 'Unpaid',   tone: 'red'   },
  partial:  { label: 'Partial',  tone: 'amber' },
  paid:     { label: 'Paid',     tone: 'green' },
  overpaid: { label: 'Overpaid', tone: 'blue'  },
  refunded: { label: 'Refunded', tone: 'grey'  },
}

const PAY_TONE = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  red:   'bg-red-500/15 text-red-400 border-red-500/30',
  blue:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
  grey:  'bg-[#374056] text-white border-line',
}

function PayPill({ status }) {
  const pill = PAY_PILL[status] ?? PAY_PILL.unpaid
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${PAY_TONE[pill.tone]}`}>
      {pill.label}
    </span>
  )
}

// RFC 4180-ish CSV escape: wrap any cell containing comma, quote, or newline
// in double quotes and double up any internal quotes. Returns a string.
function csvCell(value) {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildRegistrationsCsv(rows) {
  const header = [
    'Alias', 'First Name', 'Last Name', 'Email',
    'Team', 'Role',
    'Payment Status', 'Amount Paid', 'Amount Owing', 'Payment Reference',
    'Registered At',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      csvCell(r.profile?.alias),
      csvCell(r.profile?.first_name),
      csvCell(r.profile?.last_name),
      csvCell(r.profile?.email),
      csvCell(r.team?.name),
      csvCell(r.team?.role),
      csvCell(r.payment_status),
      csvCell((Number(r.amount_paid ?? 0) / 100).toFixed(2)),
      csvCell((Number(r.amount_owing ?? 0) / 100).toFixed(2)),
      csvCell(r.payment_reference),
      csvCell(r.registered_at),
    ].join(','))
  }
  return lines.join('\r\n')
}

function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const STATUS_FILTERS = [
  { value: 'all',      label: 'All statuses' },
  { value: 'unpaid',   label: 'Unpaid'       },
  { value: 'partial',  label: 'Partial'      },
  { value: 'paid',     label: 'Paid'         },
  { value: 'overpaid', label: 'Overpaid'     },
  { value: 'refunded', label: 'Refunded'     },
]

// Registrations tab body. Fetches every registration for the competition,
// supports alias/name/payment-reference search + payment-status filter,
// expands rows for full contact + payment detail, and exports the filtered
// view as CSV.
function RegistrationsPanel({ comp }) {
  const [rows, setRows] = useState(null) // null = loading; false = error
  const [errorMsg, setErrorMsg] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/superadmin/competition-registrations?competition_id=${comp.id}`)
      .then(data => { if (!cancelled) setRows(data) })
      .catch(err => {
        if (cancelled) return
        setErrorMsg(err.message || 'Could not load registrations.')
        setRows(false)
      })
    return () => { cancelled = true }
  }, [comp.id])

  if (rows === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (rows === false) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-6">
        <p className="text-white font-bold mb-2">Could not load registrations</p>
        <p className="text-white text-sm opacity-70">{errorMsg ?? 'Please try again.'}</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl px-6 py-12 text-center">
        <p className="text-white text-sm opacity-70">No players have registered for this competition yet.</p>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (status !== 'all' && r.payment_status !== status) return false
    if (!q) return true
    const alias = (r.profile?.alias ?? '').toLowerCase()
    const fname = (r.profile?.first_name ?? '').toLowerCase()
    const lname = (r.profile?.last_name ?? '').toLowerCase()
    const ref = (r.payment_reference ?? '').toLowerCase()
    return alias.includes(q) || fname.includes(q) || lname.includes(q) || ref.includes(q)
  })

  function exportCsv() {
    if (filtered.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(buildRegistrationsCsv(filtered), `${comp.slug}-registrations-${today}.csv`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-white text-xs font-bold uppercase tracking-wider opacity-70">
          {rows.length} registered
        </span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by alias, name, or payment ref"
          className="flex-1 min-w-[200px] bg-surface border border-line rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="bg-surface border border-line rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
        >
          {STATUS_FILTERS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          title={filtered.length === 0 ? 'Nothing to export.' : ''}
          className="text-xs bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold px-3 py-1.5 rounded-lg transition-all"
        >
          Download CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl px-6 py-10 text-center">
          <p className="text-white text-sm opacity-70">No registrations match these filters. Clear filters to see all.</p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full text-sm" style={{ minWidth: '780px' }}>
            <thead>
              <tr className="border-b border-line">
                {['Alias', 'Name', 'Team', 'Status', 'Amount Owing', 'Registered', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-[11px] text-white opacity-50 font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const expanded = expandedId === r.id
                const fullName = [r.profile?.first_name, r.profile?.last_name].filter(Boolean).join(' ')
                const owing = Number(r.amount_owing ?? 0)
                const paid = Number(r.amount_paid ?? 0)
                return (
                  <RegistrationRow
                    key={r.id}
                    r={r}
                    expanded={expanded}
                    fullName={fullName}
                    owing={owing}
                    paid={paid}
                    onToggle={() => setExpandedId(expanded ? null : r.id)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RegistrationRow({ r, expanded, fullName, owing, paid, onToggle }) {
  const team = r.team
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-line last:border-0 hover:bg-line/30 transition-colors cursor-pointer"
      >
        <td className="px-3 py-2.5 whitespace-nowrap">
          {r.profile?.alias
            ? <span className="text-brand font-bold">"{r.profile.alias}"</span>
            : <span className="text-white opacity-40">(no alias)</span>}
        </td>
        <td className="px-3 py-2.5 text-white text-xs whitespace-nowrap">
          {fullName || <span className="opacity-40">-</span>}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {team ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded border border-line flex-shrink-0" style={{ background: team.colour }} />
              <span className="text-white text-xs">{team.name}</span>
              {team.role === 'captain' && (
                <span className="text-[9px] font-bold uppercase text-green-400 border border-green-500/30 bg-green-500/15 rounded px-1 py-0.5">C</span>
              )}
            </span>
          ) : (
            <span className="text-white text-xs opacity-40">No team</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <PayPill status={r.payment_status} />
        </td>
        <td className="px-3 py-2.5 text-white text-xs whitespace-nowrap">
          {owing > 0
            ? `${dollars(owing)} AUD`
            : <span className="text-green-400 font-semibold">Paid</span>}
        </td>
        <td
          className="px-3 py-2.5 text-white text-xs opacity-70 whitespace-nowrap"
          title={new Date(r.registered_at).toLocaleString('en-AU')}
        >
          {relativeTime(r.registered_at)}
        </td>
        <td className="px-3 py-2.5 text-right">
          <svg
            className={`w-4 h-4 text-white opacity-40 inline-block transition-transform align-middle ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="bg-base border-t border-line px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">Email</p>
                <p className="text-white text-sm break-all">
                  {r.profile?.email
                    ? <a href={`mailto:${r.profile.email}`} className="text-brand hover:underline">{r.profile.email}</a>
                    : <span className="opacity-40">Not available</span>}
                </p>
              </div>
              <div>
                <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">Payment reference</p>
                <p className="font-mono text-brand text-base font-bold select-all">
                  {r.payment_reference ?? <span className="opacity-40 font-sans font-normal">-</span>}
                </p>
              </div>
              <div>
                <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">Amount paid</p>
                <p className="text-white text-sm">{dollars(paid)} AUD</p>
              </div>
              <div>
                <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">Amount owing</p>
                <p className="text-white text-sm">{dollars(owing)} AUD</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// Payments tab body. Reuses competition-registrations for the row data
// (it already carries amount_paid / amount_owing / payment_status /
// payment_reference) and opens RecordPaymentModal per-row for write
// operations. Modal posts via apiResource='competition-payment-records';
// the API recomputes amount_paid + payment_status on every mutation.
function PaymentsPanel({ comp }) {
  const [rows, setRows] = useState(null) // null = loading; false = error
  const [errorMsg, setErrorMsg] = useState(null)
  const [paymentModal, setPaymentModal] = useState(null) // { registration, profile, records }

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/superadmin/competition-registrations?competition_id=${comp.id}`)
      setRows(data)
      setErrorMsg(null)
    } catch (err) {
      setErrorMsg(err.message || 'Could not load payments.')
      setRows(false)
    }
  }, [comp.id])

  useEffect(() => { queueMicrotask(load) }, [load])

  // Mount the modal immediately with empty history, then hydrate. Awaiting
  // the GET before setPaymentModal meant any failure (or slow request) made
  // the button feel like a no-op — errorMsg only renders when the whole
  // rows fetch failed (rows === false), not after a successful table load.
  // Optimistic open keeps the click responsive and still lets the manager
  // record a new payment if history is slow or unavailable.
  function openPaymentModal(row) {
    setPaymentModal({
      registration: row,
      profile: row.profile,
      records: [],
    })
    apiFetch(`/api/superadmin/competition-payment-records?competition_registration_id=${row.id}`)
      .then(records => {
        setPaymentModal(prev => {
          if (!prev || prev.registration.id !== row.id) return prev
          return {
            ...prev,
            records: (records ?? []).map(r => ({
              id: r.id,
              amount: r.amount,
              recorded_at: r.recorded_at,
              recorded_by: r.recorded_by,
              bank_reference: r.bank_reference,
              notes: r.notes,
            })),
          }
        })
      })
      .catch(err => {
        setErrorMsg(err.message || 'Could not load payment history.')
      })
  }

  // Modal onChange fires after every POST/PATCH/DELETE. The server's
  // recompute response carries the new amount_paid + payment_status which
  // we merge into the row so the table updates without a full refetch.
  function handlePaymentChange(records, summary) {
    setPaymentModal(prev => prev ? { ...prev, records } : prev)
    setRows(prev => Array.isArray(prev)
      ? prev.map(r => (r.id === summary.registrationId
          ? { ...r, amount_paid: summary.amount_paid, payment_status: summary.payment_status }
          : r))
      : prev)
  }

  if (rows === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (rows === false) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-6">
        <p className="text-white font-bold mb-2">Could not load payments</p>
        <p className="text-white text-sm opacity-70">{errorMsg ?? 'Please try again.'}</p>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl px-6 py-12 text-center">
        <p className="text-white text-sm opacity-70">
          No registrations yet. Payments will appear here once players register.
        </p>
      </div>
    )
  }

  const totalOwed = rows.reduce((s, r) => s + Number(r.amount_owing ?? 0), 0)
  const totalPaid = rows.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0)
  const outstanding = totalOwed - totalPaid

  function downloadPaymentsCsv() {
    const header = ['Alias', 'Name', 'Email', 'Team', 'Payment Status', 'Amount Paid', 'Amount Owing', 'Outstanding', 'Reference']
    const lines = [header.map(csvCell).join(',')]
    for (const r of rows) {
      const paid = Number(r.amount_paid ?? 0)
      const owing = Number(r.amount_owing ?? 0)
      const out = owing - paid
      const name = [r.profile?.first_name, r.profile?.last_name].filter(Boolean).join(' ')
      lines.push([
        csvCell(r.profile?.alias),
        csvCell(name),
        csvCell(r.profile?.email),
        csvCell(r.team?.name),
        csvCell(r.payment_status),
        csvCell((paid / 100).toFixed(2)),
        csvCell((owing / 100).toFixed(2)),
        csvCell((out / 100).toFixed(2)),
        csvCell(r.payment_reference),
      ].join(','))
    }
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(lines.join('\r\n'), `${comp.slug}-payments-${today}.csv`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard label="Total Owed"    value={totalOwed} tone="white" />
        <SummaryCard label="Total Received" value={totalPaid} tone="green" />
        <SummaryCard label="Outstanding"   value={outstanding} tone={outstanding > 0 ? 'amber' : 'green'} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-white text-xs font-bold uppercase tracking-wider opacity-70">
          {rows.length} registration{rows.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={downloadPaymentsCsv}
          className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-3 py-1.5 rounded-lg transition-all"
        >
          Download CSV
        </button>
      </div>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden">
        <table className="w-full text-sm" style={{ minWidth: '880px' }}>
          <thead>
            <tr className="border-b border-line">
              {['Alias', 'Name', 'Team', 'Status', 'Paid', 'Owing', 'Reference', ''].map((h, i) => (
                <th key={i} className="px-3 py-2.5 text-left text-[11px] text-white opacity-50 font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const fullName = [r.profile?.first_name, r.profile?.last_name].filter(Boolean).join(' ')
              const paid = Number(r.amount_paid ?? 0)
              const owing = Number(r.amount_owing ?? 0)
              const actionLabel = paid > 0 ? 'Adjust' : 'Record'
              return (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.profile?.alias
                      ? <span className="text-brand font-bold">"{r.profile.alias}"</span>
                      : <span className="text-white opacity-40">(no alias)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-white text-xs whitespace-nowrap">
                    {fullName || <span className="opacity-40">-</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.team ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="w-3 h-3 rounded border border-line flex-shrink-0" style={{ background: r.team.colour }} />
                        <span className="text-white text-xs">{r.team.name}</span>
                      </span>
                    ) : (
                      <span className="text-white text-xs opacity-40">No team</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><PayPill status={r.payment_status} /></td>
                  <td className="px-3 py-2.5 text-white text-xs whitespace-nowrap">{dollars(paid)}</td>
                  <td className="px-3 py-2.5 text-white text-xs whitespace-nowrap">{dollars(owing)}</td>
                  <td className="px-3 py-2.5 font-mono text-brand text-[11px] whitespace-nowrap select-all">
                    {r.payment_reference ?? <span className="text-white opacity-40 font-sans">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openPaymentModal(r)}
                      className="text-[11px] bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 font-semibold px-3 py-1 rounded-lg transition-colors"
                    >
                      {actionLabel}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {paymentModal && (
        <RecordPaymentModal
          apiResource="competition-payment-records"
          registration={paymentModal.registration}
          profile={paymentModal.profile}
          records={paymentModal.records}
          profMap={{}}
          amountOwingCents={Number(paymentModal.registration.amount_owing ?? 0)}
          onChange={handlePaymentChange}
          onClose={() => setPaymentModal(null)}
        />
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  const TONE_CLASS = {
    white: 'text-white',
    green: 'text-green-400',
    amber: 'text-yellow-400',
  }
  return (
    <div className="bg-surface border border-line rounded-2xl p-4">
      <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <p className={`font-black text-xl ${TONE_CLASS[tone] ?? 'text-white'}`}>{dollars(value)} AUD</p>
    </div>
  )
}

function PlaceholderCard({ title, body }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-6">
      <p className="text-white font-bold mb-2">{title}</p>
      <p className="text-white text-sm opacity-70 leading-relaxed">{body}</p>
    </div>
  )
}

function OverviewPanel({ comp }) {
  const win = registrationWindowStatus(comp)
  return (
    <div className="space-y-5">
      <div className="bg-surface border border-line rounded-2xl p-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-4">Details</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" value={comp.name} />
          <Field label="Slug" value={comp.slug} />
          <Field label="Dates" value={formatDateRange(comp.start_date, comp.end_date)} />
          <Field
            label="Registration window"
            value={
              <span className="inline-flex items-center gap-2">
                <Pill tone={win.tone}>{win.label}</Pill>
              </span>
            }
          />
          <Field label="Registration opens" value={formatDateTime(comp.registration_open_at)} />
          <Field label="Registration closes" value={formatDateTime(comp.registration_close_at)} />
          <Field
            label="Price per player"
            value={comp.price_per_player != null ? `$${Number(comp.price_per_player).toFixed(2)} AUD` : null}
          />
          <Field
            label="Payment info visible to players"
            value={comp.payment_info_visible ? 'Yes' : 'No'}
          />
        </div>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-4">Bank details</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Account name" value={comp.bank_account_name} />
          <Field label="BSB" value={comp.bank_bsb} />
          <Field label="Account number" value={comp.bank_account_number} />
        </div>
        <p className="text-white text-[11px] opacity-50 mt-4">
          These details are for your own reference. Players see them only when "Payment info visible" is on.
        </p>
      </div>
    </div>
  )
}

// Team-status pill. approved/pending/rejected/draft map onto the shared tone
// palette; unknown statuses fall back to grey.
const TEAM_STATUS_TONE = {
  approved: 'green',
  pending:  'amber',
  rejected: 'red',
  draft:    'grey',
}

function TeamStatusPill({ status }) {
  const tone = TEAM_STATUS_TONE[status] ?? 'grey'
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${PAY_TONE[tone]}`}>
      {status ?? 'unknown'}
    </span>
  )
}

// Teams tab body. Lists every team in the competition with its accepted
// members. Committee or the competition's manager can approve/unapprove a
// team and rename it inline. Editing a player's alias is committee-only and
// changes the player's GLOBAL alias (flagged in the UI).
function TeamsPanel({ comp }) {
  const { isAdmin } = useAuth()
  const [teams, setTeams] = useState(null) // null = loading; false = error
  const [errorMsg, setErrorMsg] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busyTeamId, setBusyTeamId] = useState(null)
  const [editingNameId, setEditingNameId] = useState(null)
  const [nameDraft, setNameDraft] = useState('')
  const [editingAliasKey, setEditingAliasKey] = useState(null)
  const [aliasDraft, setAliasDraft] = useState('')
  const [aliasBusy, setAliasBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/superadmin/competition-teams?competition_id=${comp.id}`)
      setTeams(data)
      setErrorMsg(null)
    } catch (err) {
      setErrorMsg(err.message || 'Could not load teams.')
      setTeams(false)
    }
  }, [comp.id])

  useEffect(() => { queueMicrotask(load) }, [load])

  async function setStatus(teamId, approve) {
    setBusyTeamId(teamId)
    setActionError(null)
    try {
      const resource = approve ? 'competition-team-approve' : 'competition-team-unapprove'
      await apiFetch(`/api/superadmin/${resource}`, {
        method: 'POST',
        body: JSON.stringify({ team_id: teamId }),
      })
      await load()
    } catch (err) {
      setActionError(err.message || 'Could not update the team status.')
    } finally {
      setBusyTeamId(null)
    }
  }

  async function saveName(teamId) {
    const name = nameDraft.trim()
    if (!name) return
    setBusyTeamId(teamId)
    setActionError(null)
    try {
      await apiFetch('/api/superadmin/competition-team-rename', {
        method: 'POST',
        body: JSON.stringify({ team_id: teamId, name }),
      })
      setEditingNameId(null)
      setNameDraft('')
      await load()
    } catch (err) {
      setActionError(err.message || 'Could not rename the team.')
    } finally {
      setBusyTeamId(null)
    }
  }

  async function saveAlias(userId) {
    const alias = aliasDraft.trim()
    if (!alias) return
    setAliasBusy(true)
    setActionError(null)
    try {
      await apiFetch('/api/superadmin/competition-player-alias', {
        method: 'PATCH',
        body: JSON.stringify({ competition_id: comp.id, user_id: userId, alias }),
      })
      setEditingAliasKey(null)
      setAliasDraft('')
      await load()
    } catch (err) {
      setActionError(err.message || 'Could not update the alias.')
    } finally {
      setAliasBusy(false)
    }
  }

  if (teams === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (teams === false) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-6">
        <p className="text-white font-bold mb-2">Could not load teams</p>
        <p className="text-white text-sm opacity-70">{errorMsg ?? 'Please try again.'}</p>
      </div>
    )
  }
  if (teams.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl px-6 py-12 text-center">
        <p className="text-white text-sm opacity-70">No teams have been created for this competition yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
          <p className="text-red-400 text-xs font-semibold">{actionError}</p>
        </div>
      )}

      {teams.map(team => {
        const isBusy = busyTeamId === team.id
        const isApproved = team.status === 'approved'
        return (
          <div key={team.id} className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-4 h-4 rounded border border-line flex-shrink-0" style={{ background: team.colour }} />
                {editingNameId === team.id ? (
                  <span className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nameDraft}
                      maxLength={50}
                      onChange={e => setNameDraft(e.target.value)}
                      className="bg-base border border-line rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-brand"
                    />
                    <button
                      type="button"
                      onClick={() => saveName(team.id)}
                      disabled={isBusy || !nameDraft.trim()}
                      className="text-xs bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-2.5 py-1 rounded-lg transition-colors"
                    >
                      {isBusy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingNameId(null); setNameDraft('') }}
                      className="text-xs border border-line text-white opacity-60 hover:opacity-100 font-semibold px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-white font-bold truncate">{team.name}</span>
                    <button
                      type="button"
                      onClick={() => { setEditingNameId(team.id); setNameDraft(team.name); setActionError(null) }}
                      className="text-[11px] text-white opacity-50 hover:opacity-100 underline transition-opacity"
                    >
                      Rename
                    </button>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <TeamStatusPill status={team.status} />
                <button
                  type="button"
                  onClick={() => setStatus(team.id, !isApproved)}
                  disabled={isBusy}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                    isApproved
                      ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400'
                      : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'
                  }`}
                >
                  {isBusy ? 'Working…' : isApproved ? 'Unapprove' : 'Approve'}
                </button>
              </div>
            </div>

            {team.members.length === 0 ? (
              <p className="text-white text-xs opacity-40 pt-2 border-t border-line">No players on this team yet.</p>
            ) : (
              <div className="space-y-1.5 pt-2 border-t border-line">
                {team.members.map(m => {
                  const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown'
                  const isCap = Array.isArray(m.roles) && m.roles.includes('captain')
                  const aliasKey = `${team.id}::${m.user_id}`
                  const editing = editingAliasKey === aliasKey
                  return (
                    <div key={m.user_id} className="flex items-center gap-2 flex-wrap">
                      <span className="text-white text-xs font-medium">{fullName}</span>
                      {m.alias && !editing && <span className="text-brand text-xs">"{m.alias}"</span>}
                      {isCap && (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-brand/10 text-brand border-brand/20">
                          Captain
                        </span>
                      )}
                      {isAdmin && !editing && (
                        <button
                          type="button"
                          onClick={() => { setEditingAliasKey(aliasKey); setAliasDraft(m.alias ?? ''); setActionError(null) }}
                          className="text-[11px] text-white opacity-50 hover:opacity-100 underline transition-opacity"
                        >
                          Edit alias
                        </button>
                      )}
                      {isAdmin && editing && (
                        <span className="flex items-center gap-2 flex-wrap">
                          <input
                            type="text"
                            value={aliasDraft}
                            maxLength={50}
                            onChange={e => setAliasDraft(e.target.value)}
                            placeholder="Alias"
                            className="bg-base border border-line rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand"
                          />
                          <button
                            type="button"
                            onClick={() => saveAlias(m.user_id)}
                            disabled={aliasBusy || !aliasDraft.trim()}
                            className="text-xs bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-2.5 py-1 rounded-lg transition-colors"
                          >
                            {aliasBusy ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingAliasKey(null); setAliasDraft('') }}
                            className="text-xs border border-line text-white opacity-60 hover:opacity-100 font-semibold px-2.5 py-1 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                          <span className="text-[10px] text-yellow-400 opacity-90 w-full">
                            Heads up: this changes the player's global alias everywhere on the portal, not just this competition.
                          </span>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function ManagerCompetitionDetail() {
  const { slug } = useParams()
  const { pathname } = useLocation()
  // The page mounts under both /admin/manage/competitions/:slug (committee,
  // inside AdminLayout) and /manage/competitions/:slug (non-committee
  // managers, inside ManagerLayout). The back link should point at whichever
  // hub the visitor came from.
  const inAdminShell = pathname.startsWith('/admin/')
  const backTo = inAdminShell ? '/admin' : '/manage'
  const backLabel = inAdminShell ? '← Back to Admin Hub' : '← Back to Manager Hub'
  const [comp, setComp] = useState(null)        // null = loading; false = not found
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('overview')

  const load = useCallback(async () => {
    try {
      const list = await apiFetch('/api/superadmin/my-competitions')
      const match = (list ?? []).find(c => c.slug === slug)
      setComp(match ?? false)
      setError(null)
    } catch (err) {
      setError(err.message || 'Could not load competition.')
      setComp(false)
    }
  }, [slug])

  useEffect(() => { queueMicrotask(load) }, [load])

  if (comp === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (comp === false) {
    return (
      <div className="max-w-xl">
        <Link to={backTo} className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
          {backLabel}
        </Link>
        <div className="bg-surface border border-line rounded-2xl p-6">
          <p className="text-white font-bold mb-2">Not authorised or competition not found</p>
          <p className="text-white text-sm opacity-70">
            You do not manage a competition with that URL, or it has been archived. If you think this is a mistake, contact a superadmin.
          </p>
          {error && (
            <p className="text-red-400 text-xs mt-3">{error}</p>
          )}
        </div>
      </div>
    )
  }

  const win = registrationWindowStatus(comp)

  return (
    <div>
      <Link to={backTo} className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
        {backLabel}
      </Link>

      <div className="mb-5">
        <h1 className="text-3xl font-black text-white">{comp.name}</h1>
        <p className="text-white opacity-40 text-[11px] font-mono mt-1">/competitions/{comp.slug}</p>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-white text-xs opacity-80">
          <span>{formatDateRange(comp.start_date, comp.end_date)}</span>
          <span className="opacity-30">·</span>
          <Pill tone={win.tone}>{win.label}</Pill>
          <span className="opacity-30">·</span>
          <span>
            {comp.price_per_player != null
              ? `$${Number(comp.price_per_player).toFixed(2)} AUD per player`
              : 'Price not set'}
          </span>
        </div>
      </div>

      <div className="border-b border-line mb-5 flex flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-white opacity-50 hover:opacity-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewPanel comp={comp} />}

      {tab === 'edit' && (
        <EditPanel
          comp={comp}
          onSaved={saved => setComp({ ...saved, registrations_count: comp.registrations_count })}
        />
      )}

      {tab === 'teams' && <TeamsPanel comp={comp} />}

      {tab === 'registrations' && <RegistrationsPanel comp={comp} />}

      {tab === 'payments' && <PaymentsPanel comp={comp} />}
    </div>
  )
}
