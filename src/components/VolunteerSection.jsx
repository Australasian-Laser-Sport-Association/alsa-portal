import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { eventPhase, COMMITTEE_EMAIL } from '../lib/eventPhase'
import Dialog from './Dialog'

// Shared volunteer opt-in section, used in both the registration form
// (mode="registration", registrationId=null → parent submits via onChange after
// creating the registration row) and the Player Hub (mode="hub",
// registrationId set → self-contained, persists via /api/volunteer-signup).
//
// Lock behaviour mirrors the server (api/volunteer-signup.js is the source of
// truth). A signup created before the rego-lock is read-only after lock; a
// post-lock opt-in stays editable until rego-close. Phase 4: each offered role
// carries an approval status (pending/approved/declined); decided rows are
// locked from player edits and an approved role blocks opting out.

const DEFAULT_CAVEAT = 'Note: Not all volunteers will be utilised. Selection is based on the operational capacity of the ZLTAC event.'
const MAX_NOTES = 1000

function StatusBadge({ status }) {
  if (status === 'approved') {
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-green-500/15 text-green-400 border-green-500/30 whitespace-nowrap">✓ Approved</span>
  }
  if (status === 'declined') {
    return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-red-500/15 text-red-400 border-red-500/30 whitespace-nowrap">✗ Declined</span>
  }
  if (status === 'pending') {
    return <span className="inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[#374056] text-[#e5e5e5]/50 border-line whitespace-nowrap">Pending</span>
  }
  return null
}

export default function VolunteerSection({ registrationId = null, eventId, mode = 'hub', teamId = null, onChange, bare = false }) {
  const [loading, setLoading] = useState(true)
  const [roles, setRoles] = useState([]) // all roles (active + inactive), sorted
  const [caveat, setCaveat] = useState(DEFAULT_CAVEAT)
  const [requiredPerTeam, setRequiredPerTeam] = useState(false)
  const [countPerTeam, setCountPerTeam] = useState(null)
  const [committeeEmail, setCommitteeEmail] = useState(COMMITTEE_EMAIL)
  const [phase, setPhase] = useState('open')
  const [regCloseDate, setRegCloseDate] = useState(null)

  const [isVolunteering, setIsVolunteering] = useState(false)
  const [selectedRoleIds, setSelectedRoleIds] = useState([])
  const [roleStatus, setRoleStatus] = useState({}) // { role_id: 'pending'|'approved'|'declined' }
  const [notes, setNotes] = useState('')
  const [hasExistingSignup, setHasExistingSignup] = useState(false)
  const [signupCreatedAt, setSignupCreatedAt] = useState(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [confirmOptOut, setConfirmOptOut] = useState(false)
  const [approvedWithdrawNotice, setApprovedWithdrawNotice] = useState(false)

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: ev }, { data: roleData }, { data: settings }] = await Promise.all([
        supabase.from('zltac_events').select('reg_close_date, event_starts_at, committee_email').eq('id', eventId).maybeSingle(),
        supabase.from('volunteer_roles').select('*').order('sort_order', { ascending: true }),
        supabase.from('event_volunteer_settings').select('*').eq('event_id', eventId).maybeSingle(),
      ])
      if (cancelled) return
      setPhase(eventPhase(ev))
      setRegCloseDate(ev?.reg_close_date ?? null)
      setCommitteeEmail(ev?.committee_email || COMMITTEE_EMAIL)
      setRoles(roleData ?? [])
      setCaveat(settings?.caveat_message || DEFAULT_CAVEAT)
      setRequiredPerTeam(!!settings?.required_per_team)
      setCountPerTeam(settings?.count_per_team ?? null)

      if (registrationId) {
        try {
          const { signup } = await apiFetch(`/api/volunteer-signup?registration_id=${registrationId}`)
          if (cancelled) return
          if (signup) {
            const sigRoles = signup.roles ?? []
            setIsVolunteering(true)
            setSelectedRoleIds(sigRoles.map(r => r.role_id))
            setRoleStatus(Object.fromEntries(sigRoles.map(r => [r.role_id, r.status])))
            setNotes(signup.notes ?? '')
            setHasExistingSignup(true)
            setSignupCreatedAt(signup.created_at ?? null)
          }
        } catch {
          // 404 = no signup yet; other errors are non-fatal for display.
        }
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [eventId, registrationId])

  // Report state up in registration mode — the parent submits it after the
  // registration row is created. (PlayerHub doesn't pass onChange.)
  useEffect(() => {
    onChange?.({ isVolunteering, role_ids: selectedRoleIds, notes })
  }, [isVolunteering, selectedRoleIds, notes]) // eslint-disable-line react-hooks/exhaustive-deps

  const lockState = phase === 'closed'
    ? 'closed'
    : phase === 'locked'
      ? (hasExistingSignup && signupCreatedAt && regCloseDate && new Date(signupCreatedAt) < new Date(regCloseDate) ? 'locked-existing' : 'locked-new-allowed')
      : 'open'
  const readOnly = lockState === 'locked-existing' || lockState === 'closed'

  const roleMap = Object.fromEntries(roles.map(r => [r.id, r]))
  const approvedRoleNames = Object.entries(roleStatus)
    .filter(([, s]) => s === 'approved')
    .map(([id]) => roleMap[id]?.name)
    .filter(Boolean)
  const hasApproved = approvedRoleNames.length > 0

  // Show every active role plus any decided role already on the signup (so a
  // since-deactivated approved/declined role still renders with its status).
  const displayRoles = roles.filter(r => r.is_active || roleStatus[r.id])

  function isDecided(id) {
    return roleStatus[id] === 'approved' || roleStatus[id] === 'declined'
  }

  function toggleVolunteering(v) {
    setError(''); setMsg('')
    if (!v) {
      // An approved role can't be self-withdrawn — mirror the server 403.
      if (hasApproved) { setApprovedWithdrawNotice(true); return }
      if (hasExistingSignup) { setConfirmOptOut(true); return }
      setIsVolunteering(false); setSelectedRoleIds([]); setRoleStatus({}); setNotes('')
      return
    }
    setApprovedWithdrawNotice(false)
    setIsVolunteering(true)
    if (selectedRoleIds.length === 0) {
      const def = roles.find(r => r.is_default && r.is_active)
      if (def) setSelectedRoleIds([def.id])
    }
  }

  function toggleRole(id) {
    if (isDecided(id)) return // decided rows are locked
    setError(''); setApprovedWithdrawNotice(false)
    setSelectedRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    if (selectedRoleIds.length === 0) { setError('Select at least one role.'); return }
    setSaving(true); setError(''); setMsg('')
    try {
      const { signup } = await apiFetch(`/api/volunteer-signup?registration_id=${registrationId}`, {
        method: 'PUT',
        body: JSON.stringify({ role_ids: selectedRoleIds, notes }),
      })
      const sigRoles = signup?.roles ?? []
      setHasExistingSignup(true)
      setSignupCreatedAt(signup?.created_at ?? signupCreatedAt)
      setSelectedRoleIds(sigRoles.map(r => r.role_id))
      setRoleStatus(Object.fromEntries(sigRoles.map(r => [r.role_id, r.status])))
      setMsg('Volunteer details saved.')
    } catch (err) {
      setError(err.message || 'Could not save volunteer details.')
    } finally {
      setSaving(false)
    }
  }

  async function optOut() {
    setSaving(true); setError('')
    try {
      await apiFetch(`/api/volunteer-signup?registration_id=${registrationId}`, { method: 'DELETE' })
      setIsVolunteering(false); setSelectedRoleIds([]); setRoleStatus({}); setNotes('')
      setHasExistingSignup(false); setSignupCreatedAt(null)
      setConfirmOptOut(false)
      setMsg('Volunteer application removed.')
    } catch (err) {
      setError(err.message || 'Could not remove volunteer application.')
    } finally {
      setSaving(false)
    }
  }

  if (!eventId) return null

  if (loading) {
    const spinner = (
      <div className="flex items-center justify-center py-6">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
    if (bare) return spinner
    return (
      <div className="bg-surface border border-line rounded-2xl p-5">
        {spinner}
      </div>
    )
  }

  const showRoles = isVolunteering
  const showSave = mode === 'hub' && !readOnly

  const body = (
    <>
      <p className="text-[#e5e5e5]/40 text-xs mb-4">
        ZLTAC runs on volunteers. Opt in and tell us which roles you'd help with. Selection is at the committee's discretion.
      </p>

      {/* Prominent approved line */}
      {hasApproved && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-green-300">
            <span className="font-bold">✓ You're approved as:</span>{' '}
            <span className="inline-flex flex-wrap gap-1.5 align-middle">
              {approvedRoleNames.map(name => (
                <span key={name} className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-green-500/15 text-green-400 border-green-500/30">{name}</span>
              ))}
            </span>
          </p>
        </div>
      )}

      {/* Caveat — always visible */}
      <div className="bg-base border border-line rounded-xl px-4 py-3 mb-4">
        <p className="text-[#e5e5e5]/55 text-xs leading-relaxed">{caveat}</p>
      </div>

      {/* Per-team requirement note (informational; live tally lands in phase 5) */}
      {teamId && requiredPerTeam && countPerTeam > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-2.5 mb-4">
          <p className="text-blue-300 text-xs">
            Teams are asked to provide {countPerTeam} volunteer{countPerTeam === 1 ? '' : 's'} for this event.
          </p>
        </div>
      )}

      {/* Lock-state banner */}
      {lockState === 'locked-existing' && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-2.5 mb-4">
          <p className="text-yellow-300 text-xs font-semibold">
            🔒 Volunteer details are locked. To make changes, contact{' '}
            <a href={`mailto:${committeeEmail}`} className="underline hover:text-yellow-100">{committeeEmail}</a>.
          </p>
        </div>
      )}
      {lockState === 'locked-new-allowed' && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-2.5 mb-4">
          <p className="text-blue-300 text-xs">
            Registration is locked, but new volunteer applications are still welcome until registration closes.
          </p>
        </div>
      )}
      {lockState === 'closed' && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-2.5 mb-4">
          <p className="text-yellow-300 text-xs font-semibold">Volunteer applications for this event are closed.</p>
        </div>
      )}

      {/* Opt-in toggle */}
      <label className={`flex items-start gap-3 ${readOnly ? 'cursor-default' : 'cursor-pointer'} bg-base border border-line rounded-xl p-4`}>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => toggleVolunteering(!isVolunteering)}
          className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 disabled:opacity-40 ${isVolunteering ? 'bg-brand' : 'bg-line'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isVolunteering ? 'translate-x-5' : ''}`} />
        </button>
        <div>
          <p className="text-sm font-semibold text-white">I want to volunteer at this event.</p>
          <p className="text-xs text-[#e5e5e5]/40 mt-0.5">You can pick one or more roles below.</p>
        </div>
      </label>

      {/* Approved-role withdraw notice (replaces the opt-out confirm) */}
      {approvedWithdrawNotice && (
        <div className="mt-3 rounded-xl px-4 py-2.5 text-sm bg-yellow-500/10 border border-yellow-500/30 text-yellow-300">
          You're approved as: <span className="font-semibold">{approvedRoleNames.join(', ')}</span>. To withdraw, contact{' '}
          <a href={`mailto:${committeeEmail}`} className="underline hover:text-yellow-100">{committeeEmail}</a>.
        </div>
      )}

      {/* Roles + notes */}
      {showRoles && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/30 mb-3">Roles you'd help with</p>
            {displayRoles.length === 0 ? (
              <p className="text-[#e5e5e5]/40 text-xs">No volunteer roles are available for this event yet.</p>
            ) : (
              <div className="space-y-2">
                {displayRoles.map(r => {
                  const checked = selectedRoleIds.includes(r.id)
                  const status = roleStatus[r.id]
                  const decided = isDecided(r.id)
                  const declined = status === 'declined'
                  const disabled = readOnly || decided
                  return (
                    <label key={r.id}
                      title={decided ? 'Decision made — contact committee to change.' : undefined}
                      className={`flex items-start gap-3 rounded-xl p-3 border transition-colors ${checked ? 'border-brand/40 bg-brand/5' : 'border-line bg-base'} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleRole(r.id)}
                        className="mt-0.5 accent-[#00FF41] w-3.5 h-3.5 flex-shrink-0 disabled:opacity-40"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm font-semibold ${declined ? 'text-[#e5e5e5]/40 line-through' : 'text-white'}`}>
                            {r.name}
                            <span className="text-[#e5e5e5]/30 font-mono text-[10px] ml-2 no-underline">{r.code}</span>
                          </p>
                          {status && <StatusBadge status={status} />}
                        </div>
                        {r.short_description && <p className="text-xs text-[#e5e5e5]/45 mt-0.5">{r.short_description}</p>}
                        {r.requires_experience && r.experience_notes && (
                          <p className="text-[11px] text-[#e5e5e5]/30 italic mt-1">Experience: {r.experience_notes}</p>
                        )}
                        {decided && (
                          <p className="text-[10px] text-[#e5e5e5]/30 mt-1">Decision made — contact committee to change.</p>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/30 mb-1.5">
              Notes <span className="text-[#e5e5e5]/25 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              maxLength={MAX_NOTES}
              disabled={readOnly}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anything the committee should know — availability, preferences, relevant experience…"
              className="w-full bg-base border border-line rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors resize-y disabled:opacity-50"
            />
            {!readOnly && <p className="text-[10px] text-[#e5e5e5]/25 mt-1 text-right">{notes.length}/{MAX_NOTES}</p>}
          </div>
        </div>
      )}

      {/* Save (hub only; registration mode is submitted by the parent form) */}
      {showSave && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
          >
            {saving ? 'Saving…' : hasExistingSignup ? 'Update volunteer details' : 'Save volunteer details'}
          </button>
          {error && <span role="alert" className="text-red-400 text-sm">{error}</span>}
          {!error && msg && <span className="text-brand text-sm">{msg}</span>}
        </div>
      )}
      {/* Errors/notes in registration mode (no save button here) */}
      {!showSave && error && <p role="alert" className="text-red-400 text-sm mt-3">{error}</p>}
      {mode === 'registration' && isVolunteering && !readOnly && (
        <p className="text-[11px] text-[#e5e5e5]/35 mt-3">Your volunteer choices are saved when you complete registration.</p>
      )}

      {/* Opt-out confirmation (only when no approved roles) */}
      {confirmOptOut && (
        <Dialog open onClose={() => { setConfirmOptOut(false); setError('') }} variant="center" size="sm" className="p-6">
          <Dialog.Title as="p" className="text-white font-bold mb-2">Remove your volunteer application?</Dialog.Title>
            <p className="text-[#e5e5e5]/50 text-sm mb-5">This will remove your volunteer application. Continue?</p>
            {error && <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4"><p className="text-red-400 text-xs">{error}</p></div>}
            <div className="flex gap-3">
              <button onClick={optOut} disabled={saving}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">
                {saving ? 'Removing…' : 'Remove application'}
              </button>
              <button onClick={() => { setConfirmOptOut(false); setError('') }}
                className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">
                Keep volunteering
              </button>
            </div>
        </Dialog>
      )}
    </>
  )

  if (bare) return body

  return (
    <div className="bg-surface border border-line rounded-2xl p-5" id="volunteering">
      <h2 className="text-white font-bold mb-1">Volunteering at this event</h2>
      {body}
    </div>
  )
}
