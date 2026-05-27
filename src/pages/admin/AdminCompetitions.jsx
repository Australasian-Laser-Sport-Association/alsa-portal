import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { isSuperAdmin } from '../../lib/roles'
import CompetitionEditForm from '../../components/competition/CompetitionEditForm.jsx'

// Superadmin-only competition management.
//   - List competitions in a table
//   - Create / edit competition via a shared modal (mirrors AdminRegistrations
//     modal style); slug is derived server-side from name, never shown in the
//     create form, shown as read-only URL in the edit form.
//   - Expand a row to manage its managers (grant by alias search, revoke per row)
//   - Archive from inside the edit modal (PATCH archived_at). No unarchive UI.
//
// All writes go through /api/superadmin/* — service-role server-side. Page
// gates itself via useOutletContext(): non-superadmin admins see a "not
// authorised" message rather than the page UI. AdminLayout already filters
// the sidebar entry so this is defence-in-depth.

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


// ── Competition modal (create + edit) ────────────────────────────────────────
// Thin wrapper around the shared CompetitionEditForm. The modal owns the
// overlay chrome, the close button, the archive flow, and the wiring between
// the form's onSubmit and the /api/superadmin/competitions endpoint. The form
// itself owns all field state, validation, and the submit/cancel button row.
function CompetitionFormModal({ initial, onClose, onSaved }) {
  const isEdit = !!initial
  const canEditAbbreviation = !isEdit || (initial?.registrations_count ?? 0) === 0

  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState(null)

  async function handleSubmit(payload) {
    const url = isEdit
      ? `/api/superadmin/competitions?id=${initial.id}`
      : '/api/superadmin/competitions'
    const saved = await apiFetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    })
    onSaved(saved)
  }

  async function archive() {
    setArchiving(true)
    setArchiveError(null)
    try {
      const saved = await apiFetch(`/api/superadmin/competitions?id=${initial.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      })
      onSaved(saved, { archived: true })
    } catch (err) {
      setArchiveError(err.message || 'Could not archive competition.')
      setArchiving(false)
      setArchiveConfirm(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
      <div className="bg-surface border border-line rounded-2xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-white font-bold text-lg">{isEdit ? 'Edit competition' : 'Create competition'}</p>
            {isEdit && (
              <p className="text-white text-[11px] opacity-50 mt-1 font-mono">URL: /competitions/{initial.slug}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-white text-xl leading-none px-2">×</button>
        </div>

        <CompetitionEditForm
          mode={isEdit ? 'edit' : 'create'}
          initial={initial}
          canEditAbbreviation={canEditAbbreviation}
          onSubmit={handleSubmit}
          onCancel={onClose}
        />

        {isEdit && (
          <div className="border-t border-line mt-6 pt-4">
            {archiveError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-3">
                <p className="text-red-400 text-xs">{archiveError}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setArchiveConfirm(true)}
              disabled={archiving}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-semibold px-4 py-2 rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              Archive
            </button>
          </div>
        )}

        {archiveConfirm && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4">
            <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
              <p className="text-white font-bold mb-2">Archive competition?</p>
              <p className="text-white text-sm mb-5 opacity-80">
                Archive <span className="font-semibold">{initial.name}</span>? It will be hidden from the default list. Existing registrations and managers are not affected.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={archive}
                  disabled={archiving}
                  className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
                >
                  {archiving ? 'Archiving...' : 'Archive'}
                </button>
                <button
                  type="button"
                  onClick={() => setArchiveConfirm(false)}
                  disabled={archiving}
                  className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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
  const [editing, setEditing] = useState(null) // row being edited, or null
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

  function handleEdited(updated, opts) {
    setEditing(null)
    if (opts?.archived) {
      // Archived rows leave the default list. Drop from local state and refetch
      // for the authoritative order.
      setCompetitions(prev => prev ? prev.filter(c => c.id !== updated.id) : prev)
      setExpandedId(prev => (prev === updated.id ? null : prev))
    } else {
      setCompetitions(prev => prev ? prev.map(c => (c.id === updated.id ? updated : c)) : prev)
    }
    load()
  }

  // useCallback so the reference is stable across renders. Without this, the
  // ManagerPanel's loadManagers useCallback would re-create every parent
  // render (which happens every time setManagerCounts fires), making its
  // useEffect re-fire and re-fetch managers in an infinite loop. That loop
  // was the source of the visible flicker on the search input + results.
  const handleManagerCount = useCallback((id, count) => {
    setManagerCounts(prev => ({ ...prev, [id]: count }))
  }, [])

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
        <CompetitionFormModal
          initial={null}
          onClose={() => setCreateOpen(false)}
          onSaved={handleCreated}
        />
      )}

      {editing && (
        <CompetitionFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={handleEdited}
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
                {['Name', 'Dates', 'Registration', 'Managers', ''].map((h, i) => (
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
                      <td className="px-4 py-3">
                        <p className="text-white font-semibold">{c.name}</p>
                        <p className="text-white opacity-40 text-[11px] font-mono mt-0.5">/competitions/{c.slug}</p>
                      </td>
                      <td className="px-4 py-3 text-white opacity-70 text-xs whitespace-nowrap">
                        {formatDateRange(c.start_date, c.end_date)}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={winStatus.tone}>{winStatus.label}</Pill>
                      </td>
                      <td className="px-4 py-3 text-white opacity-70 text-xs">
                        {mgrCount === undefined ? '-' : mgrCount}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setEditing(c) }}
                          className="text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 font-semibold px-3 py-1 rounded-lg transition-colors mr-2"
                        >
                          Edit
                        </button>
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
                      <tr key={`${c.id}-panel`}>
                        <td colSpan={5} className="p-0">
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
