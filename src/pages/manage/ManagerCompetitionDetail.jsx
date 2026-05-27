import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { relativeTime } from '../../lib/relativeTime.js'
import CompetitionEditForm from '../../components/competition/CompetitionEditForm.jsx'

// Per-competition detail page for managers. Auth: the page fetches
// /api/superadmin/my-competitions and looks for a row matching :slug. If not
// found (revoked grant, archived competition, typo), shows a "Not authorised
// or competition not found" view. Real edit/registrations/payments surfaces
// ship in later phases — those tabs are intentional placeholders here.

const TABS = [
  { key: 'overview',      label: 'Overview' },
  { key: 'edit',          label: 'Edit Details' },
  { key: 'registrations', label: 'Registrations' },
  { key: 'payments',      label: 'Payments' },
]

function formatDateRange(start, end) {
  if (!start || !end) return '-'
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  const s = new Date(start).toLocaleDateString('en-AU', opts)
  const e = new Date(end).toLocaleDateString('en-AU', opts)
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
      csvCell(Number(r.amount_paid ?? 0).toFixed(2)),
      csvCell(Number(r.amount_owing ?? 0).toFixed(2)),
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
            ? `$${owing.toFixed(2)} AUD`
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
                <p className="text-white text-sm">${paid.toFixed(2)} AUD</p>
              </div>
              <div>
                <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">Amount owing</p>
                <p className="text-white text-sm">${owing.toFixed(2)} AUD</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
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

export default function ManagerCompetitionDetail() {
  const { slug } = useParams()
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
        <Link to="/manage" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
          ← Back to Manager Hub
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
      <Link to="/manage" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
        ← Back to Manager Hub
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

      {tab === 'registrations' && <RegistrationsPanel comp={comp} />}

      {tab === 'payments' && (
        <PlaceholderCard
          title="Payments"
          body="Payment recording and reconciliation ship in the next phase. You will be able to see which players have paid, record manual payments received via bank transfer, and toggle when your event's bank details become visible to registered players."
        />
      )}
    </div>
  )
}
