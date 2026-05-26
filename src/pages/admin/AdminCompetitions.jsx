import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { isSuperAdmin } from '../../lib/roles'

// Superadmin-only competition management.
//   - List competitions in a table
//   - Create competition via a modal (mirrors AdminRegistrations modal style)
//   - Expand a row to manage its managers (grant by alias search, revoke per row)
//
// All writes go through /api/superadmin/* — service-role server-side. Page
// gates itself via useOutletContext(): non-superadmin admins see a "not
// authorised" message rather than the page UI. AdminLayout already filters
// the sidebar entry so this is defence-in-depth.

const SLUG_RE = /^[a-z0-9-]+$/

function formatDateRange(start, end) {
  if (!start || !end) return '-'
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  const s = new Date(start).toLocaleDateString('en-AU', opts)
  const e = new Date(end).toLocaleDateString('en-AU', opts)
  return s === e ? s : `${s} to ${e}`
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

function relativeTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.round(d / 30)
  return `${mo} mo ago`
}

const TONE = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  grey:  'bg-[#374056] text-[#e5e5e5]/60 border-line',
}

function Pill({ tone, children }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  )
}


// ── Create competition modal ─────────────────────────────────────────────────
function CreateCompetitionModal({ onClose, onCreated }) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [regOpen, setRegOpen] = useState('')
  const [regClose, setRegClose] = useState('')
  const [price, setPrice] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankBsb, setBankBsb] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [paymentVisible, setPaymentVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError(null)

    if (!slug.trim()) return setError('Slug is required.')
    if (!SLUG_RE.test(slug.trim())) return setError('Slug must be lowercase letters, numbers, and hyphens only.')
    if (!name.trim()) return setError('Name is required.')
    if (!startDate || !endDate) return setError('Start and end dates are required.')
    if (new Date(endDate) < new Date(startDate)) return setError('End date must be on or after start date.')
    if (regOpen && regClose && new Date(regClose) < new Date(regOpen)) {
      return setError('Registration close must be on or after registration open.')
    }

    setSubmitting(true)
    try {
      const created = await apiFetch('/api/superadmin/competitions', {
        method: 'POST',
        body: JSON.stringify({
          slug: slug.trim(),
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
          registration_open_at: regOpen || null,
          registration_close_at: regClose || null,
          price_per_player: price ? Number(price) : null,
          bank_account_name: bankName.trim() || null,
          bank_bsb: bankBsb.trim() || null,
          bank_account_number: bankAccount.trim() || null,
          payment_info_visible: paymentVisible,
        }),
      })
      onCreated(created)
    } catch (err) {
      setError(err.message || 'Could not create competition.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
      <form onSubmit={submit} className="bg-surface border border-line rounded-2xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-white font-bold text-lg">Create competition</p>
          <button type="button" onClick={onClose} className="text-white text-xl leading-none px-2">×</button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="pre-nationals-2027"
              className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
            />
            <p className="text-white text-[11px] mt-1 opacity-60">Lowercase, numbers, hyphens only. Used in URLs and payment references.</p>
          </div>

          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ALSA Pre-Nationals 2027"
              className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">End date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Registration opens</label>
              <input
                type="datetime-local"
                value={regOpen}
                onChange={e => setRegOpen(e.target.value)}
                className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Registration closes</label>
              <input
                type="datetime-local"
                value={regClose}
                onChange={e => setRegClose(e.target.value)}
                className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Price per player (AUD)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="e.g. 75.00"
              className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>

          <div className="bg-base border border-line rounded-xl p-4 space-y-3">
            <p className="text-white text-xs font-bold uppercase tracking-wider">Payment details</p>
            <p className="text-white text-[11px] opacity-60">Visible to registered players only when the toggle below is on.</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Account name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">BSB</label>
                <input
                  type="text"
                  value={bankBsb}
                  onChange={e => setBankBsb(e.target.value)}
                  placeholder="XXX-XXX"
                  className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Account number</label>
              <input
                type="text"
                value={bankAccount}
                onChange={e => setBankAccount(e.target.value)}
                className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={paymentVisible}
                onChange={e => setPaymentVisible(e.target.checked)}
                className="accent-[#00FF41]"
              />
              <span className="text-white text-xs">Payment info visible to registered players</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="submit"
            disabled={submitting}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all"
          >
            {submitting ? 'Creating...' : 'Create competition'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}


// ── Manager panel (inline expanded row) ──────────────────────────────────────
function ManagerPanel({ competition, onCountChanged }) {
  const [managers, setManagers] = useState(null) // null = loading
  const [refreshing, setRefreshing] = useState(false)
  const [revokeConfirm, setRevokeConfirm] = useState(null)
  const [revokeError, setRevokeError] = useState(null)

  // Grant section state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [grantError, setGrantError] = useState(null)
  const [granting, setGranting] = useState(false)

  const loadManagers = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await apiFetch(`/api/superadmin/competition-managers?competition_id=${competition.id}`)
      setManagers(list)
      if (onCountChanged) onCountChanged(competition.id, list.length)
    } catch (err) {
      console.error('[AdminCompetitions] manager list failed:', err)
      setManagers([])
    } finally {
      setRefreshing(false)
    }
  }, [competition.id, onCountChanged])

  useEffect(() => { loadManagers() }, [loadManagers])

  // Debounced alias search.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    const handle = setTimeout(async () => {
      setSearching(true)
      try {
        const list = await apiFetch(`/api/superadmin/profile-search?q=${encodeURIComponent(q)}`)
        setResults(list)
      } catch (err) {
        console.error('[AdminCompetitions] profile search failed:', err)
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [query])

  async function grant(profile) {
    setGranting(true)
    setGrantError(null)
    try {
      await apiFetch('/api/superadmin/competition-managers', {
        method: 'POST',
        body: JSON.stringify({ competition_id: competition.id, user_id: profile.id }),
      })
      setQuery('')
      setResults([])
      await loadManagers()
    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('placeholder profile')) {
        setGrantError("This user hasn't claimed their account yet. They need to claim before they can manage a competition.")
      } else if (msg.includes('already a manager')) {
        setGrantError(`${profile.alias ?? 'that user'} is already a manager of this competition.`)
      } else if (msg.includes('user not found')) {
        setGrantError('User not found. They may have been removed.')
      } else {
        setGrantError(msg || 'Could not grant manager access.')
      }
    } finally {
      setGranting(false)
    }
  }

  async function revoke(userId) {
    setRevokeError(null)
    try {
      await apiFetch(`/api/superadmin/competition-managers?competition_id=${competition.id}&user_id=${userId}`, {
        method: 'DELETE',
      })
      setRevokeConfirm(null)
      await loadManagers()
    } catch (err) {
      setRevokeError(err.message || 'Could not revoke manager access.')
    }
  }

  return (
    <div className="bg-base border-t border-line px-6 py-5">
      {/* Revoke confirm dialog */}
      {revokeConfirm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
            <p className="text-white font-bold mb-2">Revoke manager access?</p>
            <p className="text-white text-sm mb-5 opacity-80">
              Revoke manager access for <span className="font-semibold">{revokeConfirm.alias || 'this user'}</span>? They will lose the ability to manage this competition.
            </p>
            {revokeError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{revokeError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => revoke(revokeConfirm.user_id)}
                className="bg-red-500 hover:bg-red-600 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                Revoke
              </button>
              <button
                onClick={() => { setRevokeConfirm(null); setRevokeError(null) }}
                className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current managers */}
      <div className="mb-6">
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-3">
          Current managers {managers ? `(${managers.length})` : ''}
        </p>
        {managers === null ? (
          <p className="text-white text-xs opacity-60">Loading...</p>
        ) : managers.length === 0 ? (
          <p className="text-white text-xs opacity-60 italic">No managers granted yet.</p>
        ) : (
          <div className="space-y-2">
            {managers.map(m => {
              const fullName = [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(' ')
              const aidShort = m.user_id.split('-')[0].slice(-4).toUpperCase()
              return (
                <div key={m.user_id} className="bg-surface border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-semibold">
                      {m.profile?.alias ? <span className="text-brand">"{m.profile.alias}"</span> : <span className="opacity-50">(no alias)</span>}
                      {fullName && <span className="ml-2">{fullName}</span>}
                      <span className="ml-2 text-white opacity-40 text-[11px] font-mono">ID {aidShort}</span>
                    </p>
                    {m.profile?.email && (
                      <p className="text-white text-[11px] opacity-50 mt-0.5">{m.profile.email}</p>
                    )}
                    <p className="text-white text-[11px] opacity-40 mt-0.5">Granted {relativeTime(m.granted_at)}</p>
                  </div>
                  <button
                    onClick={() => setRevokeConfirm({ user_id: m.user_id, alias: m.profile?.alias })}
                    className="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {refreshing && <p className="text-white text-[11px] opacity-40 mt-2">Refreshing...</p>}
      </div>

      {/* Grant new manager */}
      <div>
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-3">Grant new manager</p>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by alias (minimum 2 characters)..."
          className="w-full bg-surface border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
        />
        {grantError && (
          <div className="mt-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            <p className="text-red-400 text-xs">{grantError}</p>
          </div>
        )}

        {query.trim().length >= 2 && (
          <div className="mt-2 space-y-1">
            {searching && <p className="text-white text-xs opacity-50">Searching...</p>}
            {!searching && results.length === 0 && (
              <p className="text-white text-xs opacity-50 italic">No matching users.</p>
            )}
            {results.map(p => {
              const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ')
              return (
                <button
                  key={p.id}
                  onClick={() => grant(p)}
                  disabled={granting}
                  className="w-full flex items-center justify-between gap-3 bg-surface hover:bg-line/40 border border-line rounded-xl px-3 py-2 text-left transition-colors disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold">
                      {p.alias && <span className="text-brand">"{p.alias}"</span>}
                      {fullName && <span className="ml-2">{fullName}</span>}
                    </p>
                    <p className="text-white text-[11px] opacity-40 mt-0.5 font-mono">ID {p.alsa_id_short.slice(-4)}</p>
                  </div>
                  <span className="text-brand text-xs font-bold">Grant</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


// ── Page ─────────────────────────────────────────────────────────────────────
export default function AdminCompetitions() {
  const { userRoles = [] } = useOutletContext()
  const allowed = isSuperAdmin({ roles: userRoles })

  const [competitions, setCompetitions] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [managerCounts, setManagerCounts] = useState({}) // id -> count

  const load = useCallback(async () => {
    try {
      const list = await apiFetch('/api/superadmin/competitions')
      setCompetitions(list)
      setError(null)
    } catch (err) {
      setError(err.message || 'Could not load competitions.')
      setCompetitions([])
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    // queueMicrotask defers the setState calls inside load() to a microtask,
    // satisfying react-hooks/set-state-in-effect without changing observable
    // behaviour — load() resolves asynchronously either way.
    queueMicrotask(load)
  }, [allowed, load])

  function handleCreated(created) {
    setCreateOpen(false)
    // Optimistic insert at the top so the new row shows immediately, then
    // refetch to get the authoritative order.
    setCompetitions(prev => prev ? [created, ...prev] : [created])
    setExpandedId(created.id)
    load()
  }

  function handleManagerCount(id, count) {
    setManagerCounts(prev => ({ ...prev, [id]: count }))
  }

  if (!allowed) {
    return (
      <div className="max-w-2xl">
        <p className="text-white font-bold text-lg mb-2">Not authorised</p>
        <p className="text-white text-sm opacity-70">
          This area is restricted to superadmins. If you think you should have access, contact a superadmin.
        </p>
      </div>
    )
  }

  return (
    <div>
      {createOpen && (
        <CreateCompetitionModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Competitions</h1>
          <p className="text-white text-sm opacity-50 mt-1">
            Non-ZLTAC events (pre-nationals, etc.). Superadmin only.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-4 py-2 rounded-lg text-sm transition-all"
        >
          + Create Competition
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm"><strong>Error:</strong> {error}</p>
        </div>
      )}

      {competitions === null ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : competitions.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl px-6 py-12 text-center">
          <p className="text-white text-sm opacity-70">No competitions yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          <table className="w-full text-sm" style={{ minWidth: '720px' }}>
            <thead>
              <tr className="border-b border-line">
                {['Slug', 'Name', 'Dates', 'Registration', 'Managers', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs text-white opacity-50 font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {competitions.map(c => {
                const expanded = expandedId === c.id
                const winStatus = registrationWindowStatus(c)
                const mgrCount = managerCounts[c.id]
                return (
                  <>
                    <tr
                      key={c.id}
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      className="border-b border-line last:border-0 hover:bg-line/30 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-brand font-mono text-xs font-bold">{c.slug}</span>
                      </td>
                      <td className="px-4 py-3 text-white font-semibold">{c.name}</td>
                      <td className="px-4 py-3 text-white opacity-70 text-xs whitespace-nowrap">
                        {formatDateRange(c.start_date, c.end_date)}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={winStatus.tone}>{winStatus.label}</Pill>
                      </td>
                      <td className="px-4 py-3 text-white opacity-70 text-xs">
                        {mgrCount === undefined ? '-' : mgrCount}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <svg
                          className={`w-4 h-4 text-white opacity-40 inline-block transition-transform ${expanded ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${c.id}-panel`}>
                        <td colSpan={6} className="p-0">
                          <ManagerPanel competition={c} onCountChanged={handleManagerCount} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
