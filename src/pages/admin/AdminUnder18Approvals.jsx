import { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/dateFormat'

const inputClass = 'w-full bg-[#191919] border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand/50 transition-colors'
const labelClass = 'block text-xs font-medium text-[#e5e5e5]/50 uppercase tracking-wider mb-1.5'

const CURRENT_YEAR = new Date().getFullYear()
const DEFAULT_YEAR = CURRENT_YEAR + 1   // committee usually working on the upcoming event

const STATUS_META = {
  pending:  { label: 'Pending',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  approved: { label: 'Approved', cls: 'bg-brand/15 text-brand border-brand/30' },
  rejected: { label: 'Rejected', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
}

function profileName(p) {
  if (!p) return 'Unknown player'
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.alias || 'Unnamed player'
}

function profileInitials(p) {
  if (!p) return '?'
  return ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() || (p.alias?.[0]?.toUpperCase() ?? '?')
}

// ---------------------------------------------------------------------------

export default function AdminUnder18Approvals() {
  useOutletContext()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [yearFilter, setYearFilter] = useState(DEFAULT_YEAR)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [yearsAvailable, setYearsAvailable] = useState([])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { loadProfiles() }, [])
  useEffect(() => { load() }, [yearFilter, statusFilter])

  async function loadProfiles() {
    // Committee users can SELECT all profiles via the profiles_select_committee RLS policy.
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, alias, dob')
      .order('first_name', { ascending: true })
    setProfiles(data ?? [])
  }

  async function load() {
    setLoading(true)
    let q = supabase
      .from('under_18_approvals')
      .select('id, user_id, event_year, status, submitted_at, approved_at, approved_by, notes, created_at, updated_at, player:profiles!user_id(first_name, last_name, alias), approver:profiles!approved_by(first_name, last_name, alias)')
      .order('event_year', { ascending: false })
      .order('created_at', { ascending: false })

    if (yearFilter !== 'all') q = q.eq('event_year', yearFilter)
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)

    const { data, error } = await q
    if (error) {
      showToast(`Load failed: ${error.message}`, 'error')
      setRows([])
    } else {
      setRows(data ?? [])
    }

    // Get the available years from the entire table for the picker.
    const { data: yearRows } = await supabase
      .from('under_18_approvals')
      .select('event_year')
    const years = Array.from(new Set([DEFAULT_YEAR, CURRENT_YEAR, ...(yearRows ?? []).map(r => r.event_year)])).filter(Boolean).sort((a, b) => b - a)
    setYearsAvailable(years)

    setLoading(false)
  }

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  }), [rows])

  const selected = rows.find(r => r.id === selectedId) ?? null

  return (
    <div>
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
          toast.type === 'error'
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-brand/10 border-brand/30 text-brand'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-black text-white">Under 18 Approvals</h1>
          <p className="text-xs text-[#e5e5e5]/40 mt-1">Parental-consent status for under-18 players, per tournament year.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          + Add approval record
        </button>
      </div>

      {/* Filters */}
      <div className="bg-surface border border-line rounded-2xl p-4 mb-5 flex flex-col gap-4 xl:flex-row xl:items-end">
        <div className="xl:w-48">
          <label className={labelClass}>Event year</label>
          <select
            className={inputClass}
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
          >
            <option value="all">All years</option>
            {yearsAvailable.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="xl:flex-1">
          <label className={labelClass}>Status</label>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'all', label: 'All' },
              { key: 'pending', label: 'Pending' },
              { key: 'approved', label: 'Approved' },
              { key: 'rejected', label: 'Rejected' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border transition-all ${
                  statusFilter === s.key
                    ? 'bg-brand text-black border-brand'
                    : 'bg-base text-[#e5e5e5]/60 border-line hover:border-brand/40 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {!loading && (
            <p className="text-[10px] uppercase tracking-wider text-[#e5e5e5]/30 mt-2 font-bold">
              Showing {counts.all} · {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
            </p>
          )}
        </div>
      </div>

      {/* List + editor */}
      <div className="flex flex-col xl:flex-row gap-6">
        <div className="w-full xl:w-96 flex-shrink-0 flex flex-col gap-2 max-h-[60vh] xl:max-h-none overflow-y-auto pr-1">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-[#e5e5e5]/30 text-sm text-center py-10 bg-surface border border-line rounded-xl">No approvals match these filters.</p>
          )}
          {rows.map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`text-left px-3 py-3 rounded-xl border transition-all ${
                selectedId === r.id
                  ? 'bg-brand/10 border-brand/30'
                  : 'bg-surface border-line hover:border-brand/20'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand/15 text-brand flex items-center justify-center font-black text-xs flex-shrink-0">
                  {profileInitials(r.player)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white font-bold text-sm truncate">{profileName(r.player)}</p>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border flex-shrink-0 ${STATUS_META[r.status]?.cls}`}>
                      {STATUS_META[r.status]?.label ?? r.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#e5e5e5]/45 mt-0.5">
                    ZLTAC {r.event_year}
                    {r.submitted_at && ` · submitted ${formatDate(r.submitted_at)}`}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <ApprovalEditor
            key={selected.id}
            row={selected}
            onSaved={() => { load(); showToast('Saved.') }}
            onClose={() => setSelectedId(null)}
            showToast={showToast}
          />
        ) : (
          <div className="flex-1 bg-surface border border-line rounded-2xl flex items-center justify-center min-h-[300px]">
            <div className="text-center px-6">
              <div className="w-14 h-14 bg-[#191919] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-[#e5e5e5]/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-[#e5e5e5]/30 text-sm leading-relaxed">
                Select an approval from the list,<br />
                or click <span className="text-brand/60">+ Add approval record</span>.
              </p>
            </div>
          </div>
        )}
      </div>

      {addOpen && (
        <AddApprovalModal
          profiles={profiles}
          existingRows={rows}
          defaultYear={yearFilter === 'all' ? DEFAULT_YEAR : yearFilter}
          onClose={() => setAddOpen(false)}
          onCreated={(id) => { setAddOpen(false); load(); showToast('Approval added.'); setSelectedId(id) }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor for a selected approval row
// ---------------------------------------------------------------------------

function ApprovalEditor({ row, onSaved, onClose, showToast }) {
  const [status, setStatus] = useState(row.status)
  const [notes, setNotes] = useState(row.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)

  async function save() {
    // If transitioning to rejected and not yet confirmed, prompt.
    if (status === 'rejected' && row.status !== 'rejected' && !confirmReject) {
      setConfirmReject(true)
      return
    }

    setSaving(true)
    const patch = { status, notes: notes.trim() || null }

    // Approving: stamp approved_at + approved_by (if not already set)
    if (status === 'approved' && row.status !== 'approved') {
      const { data: { user } } = await supabase.auth.getUser()
      patch.approved_at = new Date().toISOString()
      patch.approved_by = user?.id ?? null
    }
    // Moving away from approved → clear stamp (so the audit trail isn't misleading)
    if (status !== 'approved' && row.status === 'approved') {
      patch.approved_at = null
      patch.approved_by = null
    }

    const { error } = await supabase.from('under_18_approvals').update(patch).eq('id', row.id)
    setSaving(false)
    setConfirmReject(false)

    if (error) {
      showToast(`Save failed: ${error.message}`, 'error')
      return
    }
    onSaved()
  }

  return (
    <div className="flex-1 bg-surface border border-line rounded-2xl flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[#e5e5e5]/40 uppercase tracking-wider">Editing approval</p>
          <p className="text-white font-bold truncate">
            {profileName(row.player)} <span className="text-[#e5e5e5]/40 font-normal">· ZLTAC {row.event_year}</span>
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-[#e5e5e5]/40 hover:text-white">✕ Close</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <label className={labelClass}>Status</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {['pending', 'approved', 'rejected'].map(s => (
              <label key={s} className={`cursor-pointer border rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${
                status === s ? 'border-brand/40 bg-brand/5' : 'border-line bg-base hover:border-line/60'
              }`}>
                <input
                  type="radio"
                  name="approval-status"
                  checked={status === s}
                  onChange={() => { setStatus(s); setConfirmReject(false) }}
                  className="accent-brand"
                />
                <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_META[s].cls}`}>
                  {STATUS_META[s].label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {row.submitted_at && (
          <div className="text-xs text-[#e5e5e5]/40 leading-relaxed">
            <span className="block">Player submitted: {formatDate(row.submitted_at)}</span>
            {row.approved_at && (
              <span className="block mt-0.5">
                {row.status === 'approved' ? 'Approved' : 'Stamped'}: {formatDate(row.approved_at)}
                {row.approver && ` by ${profileName(row.approver)}`}
              </span>
            )}
          </div>
        )}

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            className={`${inputClass} resize-y`}
            rows={5}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Internal notes about this approval (visible to committee only)."
          />
        </div>

        {confirmReject && (
          <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-3 text-xs text-red-400">
            Rejecting this approval means the player is not cleared to play as a minor for this year.
            Click <strong>Save</strong> again to confirm.
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
        >
          {saving ? 'Saving…' : confirmReject ? 'Confirm save' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add modal
// ---------------------------------------------------------------------------

function AddApprovalModal({ profiles, existingRows, defaultYear, onClose, onCreated, showToast }) {
  const [search, setSearch] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [eventYear, setEventYear] = useState(defaultYear)
  const [status, setStatus] = useState('approved')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    return profiles
      .filter(p => {
        const hay = `${p.first_name ?? ''} ${p.last_name ?? ''} ${p.alias ?? ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 8)
  }, [search, profiles])

  const selectedProfile = profiles.find(p => p.id === selectedProfileId) ?? null

  // Duplicate check
  const duplicate = useMemo(() => {
    if (!selectedProfileId || !eventYear) return null
    return existingRows.find(r => r.user_id === selectedProfileId && r.event_year === parseInt(eventYear))
  }, [selectedProfileId, eventYear, existingRows])

  async function save() {
    setError(null)
    if (!selectedProfileId) { setError('Select a player.'); return }
    const yr = parseInt(eventYear)
    if (!Number.isInteger(yr) || yr < 2000 || yr > CURRENT_YEAR + 5) { setError('Enter a plausible event year.'); return }
    if (duplicate) { setError(`This player already has a ${duplicate.status} approval for ${yr}.`); return }

    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      user_id: selectedProfileId,
      event_year: yr,
      status,
      notes: notes.trim() || null,
    }
    if (status === 'approved') {
      payload.approved_at = new Date().toISOString()
      payload.approved_by = user?.id ?? null
    }
    const { data, error: insertError } = await supabase.from('under_18_approvals').insert(payload).select('id').single()
    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    onCreated(data.id)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center px-4 py-12 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface border border-line rounded-2xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-bold">Add approval record</h3>
          <button onClick={onClose} className="text-xs text-[#e5e5e5]/40 hover:text-white">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelClass}>Player *</label>
            {selectedProfile ? (
              <div className="flex items-center justify-between bg-[#191919] border border-line rounded-lg px-3 py-2">
                <span className="text-sm text-white">{profileName(selectedProfile)}</span>
                <button
                  onClick={() => { setSelectedProfileId(null); setSearch('') }}
                  className="text-xs text-[#e5e5e5]/40 hover:text-white"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  className={inputClass}
                  placeholder="Search by name or alias…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search.trim().length >= 2 && (
                  <div className="mt-2 bg-[#191919] border border-line rounded-lg max-h-48 overflow-y-auto">
                    {matches.length === 0 ? (
                      <p className="text-xs text-[#e5e5e5]/30 text-center py-3">No matches.</p>
                    ) : matches.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedProfileId(p.id); setSearch('') }}
                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-line border-b border-line/40 last:border-0"
                      >
                        {profileName(p)}
                        {p.alias && <span className="text-[#e5e5e5]/40 ml-2 text-xs">({p.alias})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Event year *</label>
              <input
                type="number"
                className={inputClass}
                value={eventYear}
                onChange={e => setEventYear(e.target.value)}
                min={2000}
                max={CURRENT_YEAR + 5}
              />
            </div>
            <div>
              <label className={labelClass}>Initial status</label>
              <select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Notes</label>
            <textarea
              className={`${inputClass} resize-y`}
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional context (e.g. emailed form on 2026-05-10)."
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="text-sm text-[#e5e5e5]/60 hover:text-white px-3 py-2">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !!duplicate}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-sm"
          >
            {saving ? 'Saving…' : 'Create approval'}
          </button>
        </div>
      </div>
    </div>
  )
}
