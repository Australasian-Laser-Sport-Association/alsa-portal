import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate } from '../../lib/dateFormat'
import Dialog from '../../components/Dialog'

function isCurrent(period) {
  if (!period) return false
  const today = new Date().toISOString().slice(0, 10)
  return period.starts_at <= today && period.ends_at > today
}

function initials(p) {
  return ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() || (p.alias?.[0]?.toUpperCase() ?? '?')
}

function memberName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.alias || 'Unknown'
}

// ── Period modal (create / edit) ──────────────────────────────────────────────
function PeriodModal({ open, period, onClose, onSaved }) {
  const editing = !!period
  const [label, setLabel] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setLabel(period?.label ?? '')
    setStartsAt(period?.starts_at ?? '')
    setEndsAt(period?.ends_at ?? '')
    setError(null)
  }, [open, period])

  if (!open) return null

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body = { label: label.trim(), starts_at: startsAt, ends_at: endsAt }
      if (editing) {
        const { period: updated } = await apiFetch(`/api/admin/alsa?resource=periods&id=${period.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        onSaved(updated)
      } else {
        const { period: created } = await apiFetch('/api/admin/alsa?resource=periods', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        onSaved(created)
      }
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} variant="center" size="sm" closeOnBackdrop className="p-6">
        <Dialog.Title as="h3" className="text-white font-bold mb-4">{editing ? 'Edit period' : 'Add new period'}</Dialog.Title>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Label</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. 2026/27"
              className="w-full bg-base border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Starts</label>
              <input
                type="date"
                value={startsAt}
                onChange={e => setStartsAt(e.target.value)}
                className="w-full bg-base border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Ends</label>
              <input
                type="date"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
                className="w-full bg-base border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
          </div>
        </div>
        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving || !label.trim() || !startsAt || !endsAt}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg text-xs">
            {saving ? 'Saving…' : (editing ? 'Save' : 'Create')}
          </button>
          <button onClick={onClose}
            className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg text-xs">
            Cancel
          </button>
        </div>
    </Dialog>
  )
}

// ── Grant modal ──────────────────────────────────────────────────────────────
function GrantModal({ open, profile, periods, defaultPeriodId, onClose, onGranted }) {
  const [periodId, setPeriodId] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setPeriodId(defaultPeriodId ?? '')
    setPaymentRef('')
    setNotes('')
    setError(null)
  }, [open, defaultPeriodId])

  if (!open || !profile) return null

  async function grant() {
    setSaving(true)
    setError(null)
    try {
      const { membership } = await apiFetch('/api/admin/alsa?resource=members', {
        method: 'POST',
        body: JSON.stringify({
          profile_id: profile.id,
          period_id: periodId,
          payment_reference: paymentRef.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })
      onGranted(membership)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} variant="center" size="sm" closeOnBackdrop className="p-6">
        <Dialog.Title as="h3" className="text-white font-bold mb-1">Grant membership</Dialog.Title>
        <p className="text-[#e5e5e5]/60 text-xs mb-4">{memberName(profile)}{profile.alias && ` "${profile.alias}"`}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Period</label>
            <select
              value={periodId}
              onChange={e => setPeriodId(e.target.value)}
              className="w-full bg-base border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            >
              <option value="">Select a period…</option>
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.starts_at} → {p.ends_at}){isCurrent(p) ? ' · current' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Payment reference (optional)</label>
            <input
              type="text"
              value={paymentRef}
              onChange={e => setPaymentRef(e.target.value)}
              placeholder="e.g. bank ref, receipt #"
              className="w-full bg-base border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-base border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand resize-none"
            />
          </div>
        </div>
        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={grant} disabled={saving || !periodId}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg text-xs">
            {saving ? 'Granting…' : 'Grant membership'}
          </button>
          <button onClick={onClose}
            className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg text-xs">
            Cancel
          </button>
        </div>
    </Dialog>
  )
}

// ── Membership row ────────────────────────────────────────────────────────────
function MembershipRow({ row, onRemove }) {
  const p = row.profiles ?? {}
  const period = row.period ?? {}
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-line/50 last:border-0">
      <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-[10px] flex-shrink-0">
        {initials(p)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold">
          {memberName(p)}
          {p.alias && <span className="text-brand text-xs ml-2">"{p.alias}"</span>}
        </p>
        <p className="text-[#e5e5e5]/60 text-xs">
          {period.label} · expires {formatDate(period.ends_at, 'short')}
          {row.payment_reference && <span className="ml-2 text-[#e5e5e5]/60">· {row.payment_reference}</span>}
        </p>
        {row.notes && <p className="text-[#e5e5e5]/60 text-[11px] mt-0.5 italic">{row.notes}</p>}
      </div>
      <button
        onClick={() => onRemove(row)}
        className="text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
      >
        Remove
      </button>
    </div>
  )
}

function Section({ title, count, color, rows, onRemove, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-surface border border-line rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-line/20 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <h2 className={`text-sm font-bold uppercase tracking-wider ${color}`}>{title}</h2>
          <span className="text-xs text-[#e5e5e5]/60 font-semibold bg-line/40 px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
        <svg className={`w-4 h-4 text-[#e5e5e5]/60 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-line">
          {rows.length === 0
            ? <p className="px-5 py-6 text-center text-[#e5e5e5]/60 text-sm">None</p>
            : rows.map(r => <MembershipRow key={r.id} row={r} onRemove={onRemove} />)
          }
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
function LifetimeRow({ row, onRemove }) {
  const p = row.profiles ?? {}
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-line/50 last:border-0">
      <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand font-black text-[10px] flex-shrink-0">
        {initials(p)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold">
          {memberName(p)}
          {p.alias && <span className="text-brand text-xs ml-2">"{p.alias}"</span>}
        </p>
        <p className="text-[#e5e5e5]/60 text-xs">
          Lifetime member
          {row.granted_at && <span className="ml-2">since {formatDate(row.granted_at, 'short')}</span>}
        </p>
        {row.notes && <p className="text-[#e5e5e5]/60 text-[11px] mt-0.5 italic">{row.notes}</p>}
      </div>
      <button
        onClick={() => onRemove(row)}
        className="text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
      >
        Remove
      </button>
    </div>
  )
}

function LifetimeSection({ rows, onRemove }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="bg-surface border border-brand/30 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-brand/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-brand">Lifetime Members</h2>
          <span className="text-xs text-[#e5e5e5]/60 font-semibold bg-line/40 px-2 py-0.5 rounded-full">
            {rows.length}
          </span>
        </div>
        <svg className={`w-4 h-4 text-[#e5e5e5]/60 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-line">
          {rows.length === 0
            ? <p className="px-5 py-6 text-center text-[#e5e5e5]/60 text-sm">No lifetime members selected yet.</p>
            : rows.map(r => <LifetimeRow key={r.profile_id} row={r} onRemove={onRemove} />)
          }
        </div>
      )}
    </div>
  )
}

export default function AdminMembers() {
  const [periods, setPeriods] = useState([])
  const [memberships, setMemberships] = useState({ active: [], recently_expired: [], long_expired: [] })
  const [lifetimeMembers, setLifetimeMembers] = useState([])
  const [allProfiles, setAllProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodsListOpen, setPeriodsListOpen] = useState(false)

  const [search, setSearch] = useState('')
  const [periodModalOpen, setPeriodModalOpen] = useState(false)
  const [editingPeriod, setEditingPeriod] = useState(null)
  const [grantTarget, setGrantTarget] = useState(null)
  const [removeConfirm, setRemoveConfirm] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [{ periods: ps }, mems, lifetime, { profiles }] = await Promise.all([
        apiFetch('/api/admin/alsa?resource=periods'),
        apiFetch('/api/admin/alsa?resource=members'),
        apiFetch('/api/admin/alsa?resource=lifetime-members'),
        apiFetch('/api/admin/users'),
      ])
      setPeriods(ps ?? [])
      setMemberships({
        active: mems.active ?? [],
        recently_expired: mems.recently_expired ?? [],
        long_expired: mems.long_expired ?? [],
      })
      setLifetimeMembers(lifetime.lifetime_members ?? [])
      setAllProfiles(profiles ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const currentPeriod = useMemo(() => periods.find(isCurrent) ?? null, [periods])

  const activeMemberProfileIds = useMemo(
    () => new Set(memberships.active.map(m => m.profile_id)),
    [memberships.active]
  )

  const lifetimeMemberProfileIds = useMemo(
    () => new Set(lifetimeMembers.map(m => m.profile_id)),
    [lifetimeMembers]
  )

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    return allProfiles
      .filter(p => {
        const hay = `${p.first_name ?? ''} ${p.last_name ?? ''} ${p.alias ?? ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 10)
  }, [search, allProfiles])

  function openCreatePeriod() { setEditingPeriod(null); setPeriodModalOpen(true) }
  function openEditPeriod(p) { setEditingPeriod(p); setPeriodModalOpen(true) }

  async function removeMembership(row) {
    try {
      await apiFetch(`/api/admin/alsa?resource=members&id=${row.id}`, { method: 'DELETE' })
      setRemoveConfirm(null)
      await loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  async function addLifetimeMember(profile) {
    try {
      await apiFetch('/api/admin/alsa?resource=lifetime-members', {
        method: 'POST',
        body: JSON.stringify({ profile_id: profile.id }),
      })
      await loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  async function removeLifetimeMember(row) {
    try {
      await apiFetch(`/api/admin/alsa?resource=lifetime-members&profile_id=${encodeURIComponent(row.profile_id)}`, {
        method: 'DELETE',
      })
      await loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  async function deletePeriod(p) {
    if (!confirm(`Delete period "${p.label}"? This is blocked if any memberships still reference it.`)) return
    try {
      await apiFetch(`/api/admin/alsa?resource=periods&id=${p.id}`, { method: 'DELETE' })
      await loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black text-white">ALSA Members</h1>
        <p className="text-[#e5e5e5]/60 text-sm mt-1">Paid annual membership of the incorporated association.</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-5">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Current period card */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1">Current period</p>
                {currentPeriod ? (
                  <>
                    <p className="text-white text-xl font-black">{currentPeriod.label}</p>
                    <p className="text-[#e5e5e5]/60 text-sm">
                      {formatDate(currentPeriod.starts_at, 'short')} → {formatDate(currentPeriod.ends_at, 'short')}
                    </p>
                  </>
                ) : (
                  <p className="text-[#e5e5e5]/60 text-sm italic">No active period — create one to start granting memberships.</p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {currentPeriod && (
                  <button onClick={() => openEditPeriod(currentPeriod)}
                    className="text-xs border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-3 py-2 rounded-lg transition-colors">
                    Edit period
                  </button>
                )}
                <button onClick={openCreatePeriod}
                  className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-3 py-2 rounded-lg transition-colors">
                  Add new period
                </button>
              </div>
            </div>

            <button
              onClick={() => setPeriodsListOpen(o => !o)}
              className="mt-4 text-xs text-[#e5e5e5]/60 hover:text-white transition-colors flex items-center gap-1"
            >
              <svg className={`w-3 h-3 transition-transform ${periodsListOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              View all periods ({periods.length})
            </button>
            {periodsListOpen && (
              <div className="mt-3 border-t border-line pt-3 space-y-1">
                {periods.length === 0 ? (
                  <p className="text-[#e5e5e5]/60 text-xs">No periods yet.</p>
                ) : periods.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-line/30">
                    <div className="text-sm">
                      <span className="text-white font-semibold">{p.label}</span>
                      <span className="text-[#e5e5e5]/60 ml-2">
                        {formatDate(p.starts_at, 'short')} → {formatDate(p.ends_at, 'short')}
                      </span>
                      {isCurrent(p) && <span className="ml-2 text-[10px] text-brand font-bold uppercase">Current</span>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEditPeriod(p)}
                        className="text-[10px] text-[#e5e5e5]/60 hover:text-white px-2 py-1 rounded">
                        Edit
                      </button>
                      <button onClick={() => deletePeriod(p)}
                        className="text-[10px] text-red-400/50 hover:text-red-400 px-2 py-1 rounded">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search + Grant */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <p className="text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-2">Grant a membership</p>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by alias or name (min. 2 chars)…"
              className="w-full bg-base border border-line rounded-xl px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand"
            />
            {search.trim().length >= 2 && (
              <div className="mt-3 border border-line rounded-xl overflow-hidden">
                {searchResults.length === 0 ? (
                  <p className="px-4 py-3 text-[#e5e5e5]/60 text-sm">No matches.</p>
                ) : searchResults.map(p => {
                  const alreadyActive = activeMemberProfileIds.has(p.id)
                  const alreadyLifetime = lifetimeMemberProfileIds.has(p.id)
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/50 last:border-0">
                      <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand text-[10px] font-black flex-shrink-0">
                        {initials(p)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold">
                          {memberName(p)}
                          {p.alias && <span className="text-brand text-xs ml-2">"{p.alias}"</span>}
                        </p>
                        {alreadyActive && <p className="text-emerald-400 text-[10px] font-bold uppercase tracking-wide">Already an active member</p>}
                        {alreadyLifetime && <p className="text-brand text-[10px] font-bold uppercase tracking-wide">Lifetime member</p>}
                      </div>
                      <div className="flex-shrink-0 flex gap-2">
                        <button
                          onClick={() => setGrantTarget(p)}
                          className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-bold px-3 py-1.5 rounded-lg"
                        >
                          Grant
                        </button>
                        <button
                          onClick={() => addLifetimeMember(p)}
                          disabled={alreadyLifetime}
                          className="text-xs bg-brand/10 hover:bg-brand/20 disabled:opacity-40 text-brand font-bold px-3 py-1.5 rounded-lg"
                        >
                          {alreadyLifetime ? 'Lifetime' : 'Mark lifetime'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Member sections */}
          <LifetimeSection rows={lifetimeMembers} onRemove={removeLifetimeMember} />
          <Section title="Active" count={memberships.active.length} color="text-emerald-400"
            rows={memberships.active} onRemove={setRemoveConfirm} defaultOpen={true} />
          <Section title="Recently expired" count={memberships.recently_expired.length} color="text-yellow-400"
            rows={memberships.recently_expired} onRemove={setRemoveConfirm} defaultOpen={false} />
          <Section title="Long expired" count={memberships.long_expired.length} color="text-[#e5e5e5]/60"
            rows={memberships.long_expired} onRemove={setRemoveConfirm} defaultOpen={false} />
        </div>
      )}

      <PeriodModal
        open={periodModalOpen}
        period={editingPeriod}
        onClose={() => setPeriodModalOpen(false)}
        onSaved={() => loadAll()}
      />

      <GrantModal
        open={!!grantTarget}
        profile={grantTarget}
        periods={periods}
        defaultPeriodId={currentPeriod?.id}
        onClose={() => setGrantTarget(null)}
        onGranted={() => loadAll()}
      />

      {/* Remove confirm */}
      {removeConfirm && (
        <Dialog open onClose={() => setRemoveConfirm(null)} variant="center" size="sm" closeOnBackdrop className="p-6">
          <Dialog.Title as="p" className="text-white font-bold mb-2">Remove membership?</Dialog.Title>
            <p className="text-[#e5e5e5]/60 text-sm mb-5">
              Remove <span className="text-white font-semibold">{memberName(removeConfirm.profiles ?? {})}</span>'s
              {' '}membership for <span className="text-white font-semibold">{removeConfirm.period?.label}</span>?
            </p>
            <div className="flex gap-2">
              <button onClick={() => removeMembership(removeConfirm)}
                className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-lg text-xs">
                Yes, remove
              </button>
              <button onClick={() => setRemoveConfirm(null)}
                className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg text-xs">
                Cancel
              </button>
            </div>
        </Dialog>
      )}
    </div>
  )
}
