import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'

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
        <PlaceholderCard
          title="Edit details"
          body="Editing competition details ships in the next phase. For now, contact a superadmin to change name, dates, registration window, price, bank details, or payment visibility."
        />
      )}

      {tab === 'registrations' && (
        <PlaceholderCard
          title="Registrations"
          body="Player registrations will appear here once the public registration page goes live. Currently in development."
        />
      )}

      {tab === 'payments' && (
        <PlaceholderCard
          title="Payments"
          body="Payment recording and reconciliation ship in the next phase. You will be able to see which players have paid, record manual payments received via bank transfer, and toggle when your event's bank details become visible to registered players."
        />
      )}
    </div>
  )
}
