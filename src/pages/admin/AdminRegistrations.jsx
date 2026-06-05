import { useState, useEffect, useMemo, useCallback, memo, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate } from '../../lib/dateFormat'
import { dollars } from '../../lib/pricing.js'
import RecordPaymentModal from '../../components/RecordPaymentModal.jsx'
import RegistrationEditModal from '../../components/RegistrationEditModal.jsx'
import AddPlaceholderRegistrationModal from '../../components/AddPlaceholderRegistrationModal.jsx'
import { eventPhase } from '../../lib/eventPhase'
import { isRefTestRequired, isCocRequired, isPaymentRequired } from '../../lib/eventSettings'

function fmt(d) {
  return formatDate(d, 'short') || '—'
}

const PAY_PILL = {
  unpaid:   { color: 'red',   label: 'Unpaid' },
  partial:  { color: 'amber', label: 'Partial' },
  paid:     { color: 'green', label: 'Paid' },
  overpaid: { color: 'blue',  label: 'Overpaid' },
}

function Pill({ color, children }) {
  const styles = {
    green:  'bg-green-500/15 text-green-400 border-green-500/30',
    red:    'bg-red-500/15 text-red-400 border-red-500/30',
    amber:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    blue:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    grey:   'bg-[#374056] text-[#e5e5e5]/40 border-line',
  }
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${styles[color]}`}>
      {children}
    </span>
  )
}

// OVR badge appended next to a "satisfied" pill to mark that the
// satisfaction came from a committee override rather than the player's
// actual completion of the underlying check. Tooltip on the parent cell
// carries the audit detail (who, when, why).
function OvrBadge() {
  return (
    <span className="inline-block text-[9px] font-black uppercase tracking-wide px-1 py-0.5 rounded border bg-yellow-500/15 text-yellow-400 border-yellow-500/30 ml-1 align-middle">
      OVR
    </span>
  )
}

// Modal for the Chunk 2 manual link: committee picks any real user to absorb
// a placeholder. The picker queries a committee-gated server search as the
// admin types (debounced), so it no longer needs the whole profiles table —
// only matching non-placeholder rows come back.
function LinkPlaceholderModal({ placeholder, summaryCounts, onClose, onLinked }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null) // chosen real profile
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const q = query.trim()

  // Debounced server search. Under 2 chars we never hit the endpoint (it would
  // return [] anyway). Each keystroke cancels the prior in-flight request via
  // the cancelled flag + cleared timeout so results don't arrive out of order.
  useEffect(() => {
    if (q.length < 2) { setResults([]); setSearching(false); setSearchError(null); return }
    let cancelled = false
    setSearching(true)
    setSearchError(null)
    const t = setTimeout(() => {
      apiFetch(`/api/admin/event?resource=profile-search&q=${encodeURIComponent(q)}`)
        .then(data => { if (!cancelled) { setResults(Array.isArray(data) ? data : []); setSearching(false) } })
        .catch(err => { if (!cancelled) { setSearchError(err.message || 'Search failed.'); setResults([]); setSearching(false) } })
    }, 280)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  const phName = [placeholder.first_name, placeholder.last_name].filter(Boolean).join(' ')
    || placeholder.alias || 'placeholder'
  const pickedName = picked
    ? ([picked.first_name, picked.last_name].filter(Boolean).join(' ') || picked.alias || 'user')
    : null

  async function submit() {
    if (!picked) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await apiFetch('/api/admin/event?resource=registrations', {
        method: 'POST',
        body: JSON.stringify({
          action: 'link-placeholder',
          placeholder_id: placeholder.id,
          real_user_id: picked.id,
        }),
      })
      if (result?.ok === false) {
        setError(result.error || 'Could not link the placeholder.')
        return
      }
      onLinked()
    } catch (err) {
      setError(err.message || 'Could not link the placeholder.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
      <div className="bg-surface border border-line rounded-2xl p-6 max-w-xl w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-white font-bold text-lg">Link placeholder to user</p>
            <p className="text-white text-xs mt-1">
              Placeholder: <span className="font-semibold">{phName}</span>
              {placeholder.alias && <span className="text-brand ml-1">"{placeholder.alias}"</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-white text-xl leading-none px-2">×</button>
        </div>

        {!picked ? (
          <>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by alias or name..."
              className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand mb-3"
            />
            {searchError && (
              <p className="text-red-400 text-xs">{searchError}</p>
            )}
            {!searchError && searching && (
              <p className="text-white text-xs italic">Searching…</p>
            )}
            {!searchError && !searching && q.length >= 2 && results.length === 0 && (
              <p className="text-white text-xs italic">No matching users.</p>
            )}
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {results.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPicked(p)}
                  className="w-full flex items-center justify-between gap-3 bg-base hover:bg-line/40 border border-line rounded-lg px-3 py-2 text-left transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold">
                      {[p.first_name, p.last_name].filter(Boolean).join(' ') || '(no name)'}
                      {p.alias && <span className="text-brand ml-2">"{p.alias}"</span>}
                    </p>
                    {p.state && <p className="text-white text-[10px] mt-0.5">{p.state}</p>}
                  </div>
                  <span className="text-brand text-xs font-bold">Pick</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="bg-base border border-line rounded-xl p-4 mb-4">
              <p className="text-white text-xs font-bold uppercase tracking-wider mb-2">Confirm merge</p>
              <p className="text-white text-sm leading-relaxed">
                This will move {summaryCounts.regCount} registration{summaryCounts.regCount === 1 ? '' : 's'} and {summaryCounts.partnerCount} partner relationship{summaryCounts.partnerCount === 1 ? '' : 's'} from <span className="font-semibold">{phName}</span> to <span className="font-semibold">{pickedName}</span>{picked.alias ? ` "${picked.alias}"` : ''}. The placeholder profile will be deleted.
              </p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                {submitting ? 'Linking...' : 'Confirm and link'}
              </button>
              <button
                type="button"
                onClick={() => { setPicked(null); setError(null) }}
                disabled={submitting}
                className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Minimum canonical roster to field a ZLTAC team. Mirrors the captain-side
// submit gate (CaptainHub / api/captain submit-team); shown here as context for
// the committee while reviewing.
const MIN_ROSTER = 5

function StatusBadge({ status }) {
  const styles = {
    draft:    'bg-line text-[#e5e5e5]/40 border-line',
    pending:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    approved: 'bg-green-500/15 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  }
  return (
    <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${styles[status] ?? styles.pending}`}>
      {status ?? 'pending'}
    </span>
  )
}

// Per-player eligibility chips for the Teams-tab roster view. Reuses the same
// satisfied/not flags the Players tab computes, and respects the per-event
// requirement toggles (a disabled requirement renders 'n/a').
function EligibilityChips({ p, cocRequired, refRequired, paymentRequired }) {
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {cocRequired
        ? <Pill color={p.coc ? 'green' : 'red'}>CoC</Pill>
        : <Pill color="grey">CoC n/a</Pill>}
      {refRequired
        ? <Pill color={p.refPassed ? 'green' : 'red'}>Rules</Pill>
        : <Pill color="grey">Rules n/a</Pill>}
      <Pill color={p.media ? 'green' : 'red'}>Media</Pill>
      {paymentRequired
        ? <Pill color={PAY_PILL[p.payStatus].color}>{PAY_PILL[p.payStatus].label}</Pill>
        : <Pill color="grey">Pay n/a</Pill>}
      {p.complete
        ? <Pill color="green">Complete</Pill>
        : <Pill color="red">{p.doneCount}/{p.totalChecks}</Pill>}
    </span>
  )
}

// Memoised player row. The Players tab has a per-keystroke search box, so the
// parent re-renders on every character; without this every 13-cell row would
// re-render too. Handlers come in as stable useCallback refs from the parent
// and take the row as an argument, so the inline arrows here stay inside the
// memo boundary instead of defeating it at the call site.
const PlayerRow = memo(function PlayerRow({ p, onEdit, onLink, onPayment, onRemove }) {
  const name = [p.profile?.first_name, p.profile?.last_name].filter(Boolean).join(' ') || '—'
  return (
    <tr className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
      {/* Name */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          {(p.profile?.first_name || p.profile?.last_name)
            ? <span className="font-semibold text-white">{name}</span>
            : <span className="text-[#e5e5e5]/30 italic text-xs">Unknown</span>}
          {p.profile?.is_placeholder && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[#374056] text-[#e5e5e5]/60 border-line">Manual</span>
          )}
        </span>
      </td>
      {/* Alias */}
      <td className="px-4 py-3 whitespace-nowrap">
        {p.profile?.alias
          ? <span className="text-brand text-xs font-medium">{p.profile.alias}</span>
          : <span className="text-[#e5e5e5]/30 text-xs">—</span>}
      </td>
      {/* State */}
      <td className="px-4 py-3">
        {p.profile?.state
          ? <span className="text-xs bg-brand/10 text-brand border border-brand/20 px-1.5 py-0.5 rounded font-bold">{p.profile.state}</span>
          : <span className="text-[#e5e5e5]/30 text-xs">—</span>}
      </td>
      {/* Team */}
      <td className="px-4 py-3 whitespace-nowrap">
        {p.team?.name
          ? <span className="text-[#e5e5e5]/60 text-xs">{p.team.name}</span>
          : <span className="text-[#e5e5e5]/25 text-xs">No team</span>}
      </td>
      {/* CoC */}
      <td className="px-4 py-3" title={p.cocTitle}>
        {p.coc ? <Pill color="green">Signed</Pill> : <Pill color="red">Unsigned</Pill>}
        {p.cocOverride && <OvrBadge />}
      </td>
      {/* Rules Test */}
      <td className="px-4 py-3" title={p.refTitle}>
        {p.refPassed
          ? <Pill color="green">Passed{p.ref?.score != null ? ` (${p.ref.score}%)` : ''}</Pill>
          : p.ref
            ? <Pill color="amber">Failed ({p.ref.score}%)</Pill>
            : <Pill color="grey">Not taken</Pill>}
        {p.refOverride && <OvrBadge />}
      </td>
      {/* Media */}
      <td className="px-4 py-3" title={p.mediaTitle}>
        {p.media ? <Pill color="green">Submitted</Pill> : <Pill color="grey">Pending</Pill>}
        {p.mediaOverride && <OvrBadge />}
      </td>
      {/* Owing */}
      <td className="px-4 py-3 whitespace-nowrap text-[#e5e5e5]/60 text-xs">{dollars(p.amountOwing)}</td>
      {/* Paid */}
      <td className="px-4 py-3 whitespace-nowrap text-[#e5e5e5]/60 text-xs">{dollars(p.amountPaid)}</td>
      {/* Balance */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`text-xs font-semibold ${p.balance > 0 ? 'text-red-400' : p.balance < 0 ? 'text-blue-400' : 'text-green-400'}`}>
          {dollars(p.balance)}
        </span>
      </td>
      {/* Payment */}
      <td className="px-4 py-3">
        <Pill color={PAY_PILL[p.payStatus].color}>{PAY_PILL[p.payStatus].label}</Pill>
      </td>
      {/* Status */}
      <td className="px-4 py-3 whitespace-nowrap">
        {p.complete
          ? <Pill color="green">Complete</Pill>
          : <Pill color="red">{p.doneCount}/{p.totalChecks}</Pill>}
      </td>
      {/* Actions — sticky to the right so the buttons stay
          reachable while the wide table scrolls horizontally. */}
      <td className="px-4 py-3 whitespace-nowrap sticky right-0 bg-surface border-l border-line">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(p)}
            className="text-xs font-semibold px-3 py-1 rounded-full border bg-blue-500/15 border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors"
          >
            Edit
          </button>
          {p.profile?.is_placeholder && (
            <button
              onClick={() => onLink(p.profile)}
              className="text-xs font-semibold px-3 py-1 rounded-full border bg-brand/15 border-brand/30 text-brand hover:bg-brand/25 transition-colors"
            >
              Link to user
            </button>
          )}
          <button
            onClick={() => onPayment(p)}
            className="text-xs font-semibold px-3 py-1 rounded-full border bg-green-500/15 border-green-500/30 text-green-300 hover:bg-green-500/25 transition-colors"
          >
            Record Payment / Refund
          </button>
          <button
            onClick={() => onRemove(p, name)}
            className="text-xs font-semibold px-3 py-1 rounded-full border bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  )
})

export default function AdminRegistrations() {
  const [eventYear, setEventYear] = useState(undefined) // undefined = loading, null = no open event
  const [tab, setTab] = useState('players')
  const [regs, setRegs] = useState([])
  const [profiles, setProfiles] = useState([])
  const [teams, setTeams] = useState([])
  const [cocSigs, setCocSigs] = useState([])
  const [refResults, setRefResults] = useState([])
  const [mediaReleases, setMediaReleases] = useState([])
  const [paymentRecords, setPaymentRecords] = useState([])
  const [doubles, setDoubles] = useState([])
  const [triples, setTriples] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [removeConfirm, setRemoveConfirm] = useState(null) // { userId, name, alias }
  const [paymentModal, setPaymentModal] = useState(null) // { registration, profile }
  const [editModal, setEditModal] = useState(null)        // { registration, profile }
  const [event, setEvent] = useState(null)                // active event row (for phase + side_events list)
  const [needsFollowUp, setNeedsFollowUp] = useState(false) // filter toggle
  const [toast, setToast] = useState(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [placeholderBanner, setPlaceholderBanner] = useState(null) // { reference, name }
  const [linkModal, setLinkModal] = useState(null)                  // { placeholder } currently being linked to a real user
  const [searchParams, setSearchParams] = useSearchParams()

  // Teams tab review state
  const [expandedTeam, setExpandedTeam] = useState(null)  // team id whose roster is expanded
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [rejectingTeam, setRejectingTeam] = useState(null) // team id whose reject-reason input is open
  const [rejectReason, setRejectReason] = useState('')

  // Deep link from the Admin Event page ("Add manual registration") opens the
  // modal directly. Consume the param so a refresh does not reopen it.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setAddModalOpen(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    supabase
      .from('zltac_events')
      .select('id, year, name, side_events, reg_close_date, event_starts_at, require_ref_test, require_coc, require_payment')
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setEvent(data ?? null)
        setEventYear(data?.year ?? null)
      })
  }, [])

  useEffect(() => {
    if (eventYear === undefined) return
    if (eventYear === null) { setLoading(false); return }
    fetchAll()
  }, [eventYear])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function fetchAll() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`/api/admin/event?resource=registrations&year=${eventYear}`)
      setRegs(data.registrations ?? [])
      setProfiles(data.profiles ?? [])
      setTeams(data.teams ?? [])
      setCocSigs(data.coc_sigs ?? [])
      setRefResults(data.ref_results ?? [])
      setMediaReleases(data.media_releases ?? [])
      setPaymentRecords(data.payment_records ?? [])
      setDoubles(data.doubles ?? [])
      setTriples(data.triples ?? [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  // Build lookup maps. Memoised so the per-keystroke search re-render doesn't
  // rebuild them (and, downstream, the heavy `players` array) every character.
  const profMap    = useMemo(() => Object.fromEntries(profiles.map(p => [p.id, p])), [profiles])
  const teamMap    = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams])
  const cocSet     = useMemo(() => new Set(cocSigs.map(c => c.user_id)), [cocSigs])
  const refMap     = useMemo(() => Object.fromEntries(refResults.map(r => [r.user_id, r])), [refResults])
  const mediaSet   = useMemo(() => new Set(mediaReleases.map(m => m.user_id)), [mediaReleases])
  const recordsByReg = useMemo(() => paymentRecords.reduce((acc, r) => {
    (acc[r.registration_id] ??= []).push(r)
    return acc
  }, {}), [paymentRecords])

  // Enrich registrations
  // Per-event requirement toggles. When off, that requirement is skipped
  // from the per-row "complete" badge and from the doneCount.
  const refRequired     = isRefTestRequired(event)
  const cocRequired     = isCocRequired(event)
  const paymentRequired = isPaymentRequired(event)

  // Memoised so it isn't rebuilt on unrelated re-renders (notably each search
  // keystroke, which `players` doesn't even depend on). overrideAudit lives
  // inside so profMap is its only external dep, keeping the dep array exact.
  const players = useMemo(() => {
  // Builds a tooltip string for an override audit triplet. setBy is looked
  // up in profMap so the admin's alias surfaces; falls back to "Committee
  // override" if the setter has no profile (extremely old data with set_by
  // = NULL won't happen post-migration, but defensive). Date format matches
  // the rest of the page (en-AU, dd MMM yyyy).
  function overrideAudit(setAt, reason, setBy) {
    const setter = setBy ? profMap[setBy] : null
    const setterName = setter?.alias || [setter?.first_name, setter?.last_name].filter(Boolean).join(' ')
    const parts = [setterName ? `Committee override by "${setterName}"` : 'Committee override']
    if (setAt) {
      const d = new Date(setAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
      parts.push(`on ${d}`)
    }
    if (reason) parts.push(`Reason: ${reason}`)
    return parts.join('. ')
  }

  return regs.map(reg => {
    const profile = profMap[reg.user_id] ?? null
    const team    = teamMap[reg.team_id] ?? null
    // Committee manual overrides count as satisfied: normalCheck || override.
    const coc       = cocSet.has(reg.user_id) || !!reg.admin_override_coc
    const cocOverride = !!reg.admin_override_coc
    const ref       = refMap[reg.user_id] ?? null
    const refPassed = ref?.passed === true || !!reg.admin_override_ref_test
    const refOverride = !!reg.admin_override_ref_test
    const media     = mediaSet.has(reg.user_id) || !!reg.admin_override_media
    const mediaOverride = !!reg.admin_override_media
    const payRecords  = recordsByReg[reg.id] ?? []
    const amountOwing = reg.amount_owing ?? 0
    const amountPaid  = payRecords.reduce((s, r) => s + r.amount, 0)
    const balance     = amountOwing - amountPaid
    const payStatus   = balance < 0 ? 'overpaid' : balance === 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'
    const paid        = balance <= 0
    const cocOk    = !cocRequired || coc
    const refOk    = !refRequired || refPassed
    const paidOk   = !paymentRequired || paid
    const complete = cocOk && refOk && media && paidOk
    const checks = [
      ...(cocRequired ? [coc] : []),
      ...(refRequired ? [refPassed] : []),
      media,
      ...(paymentRequired ? [paid] : []),
    ]
    const doneCount = checks.filter(Boolean).length
    // Tooltip detail per concern. When the override is on, the audit string
    // gets appended so the admin can see who set it / when / why on hover.
    let refTitle = ref
      ? (ref.safety_total != null
          ? `Safety ${ref.safety_correct ?? 0}/${ref.safety_total}, General ${ref.general_correct ?? 0}/${ref.general_total ?? 0}`
          : 'Legacy result — no section breakdown')
      : 'Not taken'
    if (refOverride) {
      const audit = overrideAudit(reg.admin_override_ref_test_set_at, reg.admin_override_ref_test_reason, reg.admin_override_ref_test_set_by)
      refTitle = ref ? `${refTitle}. ${audit}` : audit
    }
    const cocTitle = cocOverride
      ? overrideAudit(reg.admin_override_coc_set_at, reg.admin_override_coc_reason, reg.admin_override_coc_set_by)
      : (coc ? 'Code of Conduct signed' : 'Not signed')
    const mediaTitle = mediaOverride
      ? overrideAudit(reg.admin_override_media_set_at, reg.admin_override_media_reason, reg.admin_override_media_set_by)
      : (media ? 'Media release submitted' : 'Not submitted')
    return { ...reg, profile, team, coc, cocOverride, cocTitle, ref, refPassed, refOverride, refTitle, media, mediaOverride, mediaTitle, amountOwing, amountPaid, balance, payStatus, paid, complete, doneCount, totalChecks: checks.length }
  })
  }, [regs, profMap, teamMap, cocSet, refMap, mediaSet, recordsByReg, refRequired, cocRequired, paymentRequired])

  // Phase + needs-follow-up derivation.
  // "Needs follow-up" = registration where the event is past the open
  // phase (so players can't self-fix anything) AND there's still money
  // owed. Admin's call-list during the lockup window. When payment isn't
  // required for the event, this list is always empty.
  const phase = eventPhase(event)
  const needsFollowUpCount = paymentRequired && phase === 'locked'
    ? players.filter(p => p.balance > 0).length
    : 0

  // Filters
  const states = useMemo(
    () => [...new Set(players.map(p => p.profile?.state).filter(Boolean))].sort(),
    [players]
  )
  const filtered = useMemo(() => players.filter(p => {
    if (stateFilter !== 'all' && p.profile?.state !== stateFilter) return false
    if (needsFollowUp && !(paymentRequired && phase === 'locked' && p.balance > 0)) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const name = [p.profile?.first_name, p.profile?.last_name].filter(Boolean).join(' ').toLowerCase()
      const alias = (p.profile?.alias ?? '').toLowerCase()
      if (!name.includes(q) && !alias.includes(q)) return false
    }
    return true
  }), [players, stateFilter, needsFollowUp, paymentRequired, phase, search])

  const completeCount   = players.filter(p => p.complete).length
  const incompleteCount = players.length - completeCount

  // Wired into the RegistrationEditModal so the admin can pick partners
  // from anyone currently registered for the year.
  const allPlayersForPicker = regs.map(r => ({ user_id: r.user_id, profile: profMap[r.user_id] ?? null }))

  function handleEditSaved(summary) {
    setEditModal(null)
    showToast(`Saved. New balance: ${dollars(summary.balance)}`)
    fetchAll()
  }

  function handlePlaceholderCreated(result) {
    setAddModalOpen(false)
    const name = [result?.profile?.first_name, result?.profile?.last_name].filter(Boolean).join(' ')
      || result?.profile?.alias || 'player'
    setPlaceholderBanner({ reference: result?.payment_reference ?? null, name })
    fetchAll()
  }

  // Player count per team
  const playerCountByTeam = regs.reduce((acc, r) => {
    if (r.team_id) acc[r.team_id] = (acc[r.team_id] ?? 0) + 1
    return acc
  }, {})

  // Full enriched roster grouped by team, reusing the per-player eligibility
  // already computed in `players`. The committee expands a team to vet this
  // before approving.
  const playersByTeam = useMemo(() => {
    const m = {}
    for (const p of players) {
      if (p.team_id) (m[p.team_id] ??= []).push(p)
    }
    return m
  }, [players])

  // Committee approve/reject via the server action (resource=team-review),
  // replacing the old client-side direct teams.update. Reject carries the
  // required reason; the server re-validates ZLTAC + pending + non-empty reason.
  async function reviewTeam(teamId, action, reason) {
    setReviewBusy(true)
    setReviewError('')
    try {
      const res = await apiFetch('/api/admin/event?resource=team-review', {
        method: 'POST',
        body: JSON.stringify({ teamId, action, reason }),
      })
      setTeams(prev => prev.map(t => t.id === teamId ? { ...t, status: res.status } : t))
      setRejectingTeam(null)
      setRejectReason('')
      showToast(`Team ${res.status}`)
    } catch (err) {
      setReviewError(err?.message || 'Could not update the team.')
    } finally {
      setReviewBusy(false)
    }
  }

  // Expand/collapse a team's roster; resets any in-progress review state so a
  // stale error/reason from one team never bleeds into another.
  function toggleExpand(id) {
    setExpandedTeam(prev => (prev === id ? null : id))
    setRejectingTeam(null)
    setRejectReason('')
    setReviewError('')
  }

  // Called by RecordPaymentModal after a record is added/edited/deleted.
  // Replaces this registration's records so the row columns + modal refresh
  // without a full reload.
  function handlePaymentChange(records, summary) {
    setPaymentRecords(prev => [
      ...prev.filter(r => r.registration_id !== summary.registrationId),
      ...records,
    ])
  }

  // Counts for the link-confirmation summary. Same source the merge function
  // uses (zltac_registrations + doubles_pairs + triples_teams), computed
  // client-side from the data we already loaded so the admin sees what's about
  // to move before they confirm.
  function linkSummaryCounts(placeholderId) {
    const regCount = regs.filter(r => r.user_id === placeholderId).length
    const partnerCount = doubles.filter(d => d.player1_id === placeholderId || d.player2_id === placeholderId).length
      + triples.filter(t => t.player1_id === placeholderId || t.player2_id === placeholderId || t.player3_id === placeholderId).length
    return { regCount, partnerCount }
  }

  async function removePlayer() {
    if (!removeConfirm) return
    try {
      await apiFetch('/api/admin/event?resource=registrations', {
        method: 'DELETE',
        body: JSON.stringify({ userId: removeConfirm.userId, year: eventYear }),
      })
      setRegs(prev => prev.filter(r => r.user_id !== removeConfirm.userId))
      showToast(`${removeConfirm.alias || removeConfirm.name} removed from ZLTAC ${eventYear}`)
    } catch (err) {
      showToast(`Error: ${err.message}`)
    }
    setRemoveConfirm(null)
  }

  // Stable row handlers so PlayerRow's React.memo holds while the search box
  // re-renders the parent per keystroke. Each takes the row as an argument.
  const handleEditRow    = useCallback(p => setEditModal({ registration: p, profile: p.profile }), [])
  const handleLinkRow    = useCallback(profile => setLinkModal({ placeholder: profile }), [])
  const handlePaymentRow = useCallback(p => setPaymentModal({ registration: p, profile: p.profile }), [])
  const handleRemoveRow  = useCallback((p, name) => setRemoveConfirm({ userId: p.user_id, name, alias: p.profile?.alias }), [])

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-brand text-black text-sm font-bold px-5 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Remove confirmation modal */}
      {removeConfirm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
            <p className="text-white font-bold mb-2">Remove player?</p>
            <p className="text-[#e5e5e5]/50 text-sm mb-5">
              Remove <span className="text-white font-semibold">{removeConfirm.name}</span>
              {removeConfirm.alias ? <span className="text-brand"> ({removeConfirm.alias})</span> : ''} from ZLTAC {eventYear}?
              This will delete their registration record. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={removePlayer} className="bg-red-500 hover:bg-red-600 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">Remove player</button>
              <button onClick={() => setRemoveConfirm(null)} className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment modal */}
      {paymentModal && (
        <RecordPaymentModal
          registration={paymentModal.registration}
          profile={paymentModal.profile}
          records={recordsByReg[paymentModal.registration.id] ?? []}
          profMap={profMap}
          onChange={handlePaymentChange}
          onClose={() => setPaymentModal(null)}
        />
      )}

      {/* Edit Registration modal — admin-only, bypasses phase guard. */}
      {editModal && (
        <RegistrationEditModal
          registration={editModal.registration}
          profile={editModal.profile}
          enabledSideEvents={(event?.side_events ?? []).filter(se => se.enabled)}
          teams={teams.filter(t => t.status === 'approved').map(t => ({ id: t.id, name: t.name }))}
          allPlayers={allPlayersForPicker}
          existingDoublesPair={doubles.find(d =>
            d.player1_id === editModal.registration.user_id ||
            d.player2_id === editModal.registration.user_id
          )}
          existingTriplesTeam={triples.find(t =>
            t.player1_id === editModal.registration.user_id ||
            t.player2_id === editModal.registration.user_id ||
            t.player3_id === editModal.registration.user_id
          )}
          onClose={() => setEditModal(null)}
          onSaved={handleEditSaved}
        />
      )}

      {/* Add manual (placeholder) registration modal */}
      {addModalOpen && (
        <AddPlaceholderRegistrationModal
          eventYear={eventYear}
          enabledSideEvents={(event?.side_events ?? []).filter(se => se.enabled)}
          teams={teams.filter(t => t.status === 'approved').map(t => ({ id: t.id, name: t.name }))}
          allPlayers={allPlayersForPicker}
          onClose={() => setAddModalOpen(false)}
          onCreated={handlePlaceholderCreated}
        />
      )}

      {/* Link placeholder to real user modal (Chunk 2 admin fallback) */}
      {linkModal && (
        <LinkPlaceholderModal
          placeholder={linkModal.placeholder}
          summaryCounts={linkSummaryCounts(linkModal.placeholder.id)}
          onClose={() => setLinkModal(null)}
          onLinked={() => {
            const phId = linkModal.placeholder.id
            setLinkModal(null)
            setRegs(prev => prev.filter(r => r.user_id !== phId))
            setProfiles(prev => prev.filter(p => p.id !== phId))
            showToast('Placeholder linked. Registration moved to the chosen user.')
            fetchAll()
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Registrations</h1>
          <p className="text-[#e5e5e5]/40 text-sm mt-1">
            ZLTAC {eventYear} — {players.length} players · <span className="text-green-400">{completeCount} complete</span> · <span className="text-red-400">{incompleteCount} incomplete</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {eventYear && (
            <button
              onClick={() => setAddModalOpen(true)}
              className="text-xs bg-surface border border-line hover:border-brand text-brand font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              + Add manual registration
            </button>
          )}
          <button
            onClick={() => eventYear && fetchAll()}
            className="text-xs bg-surface border border-line hover:border-brand text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Manual registration success banner — surfaces the generated payment
          reference so the admin can relay it to the player. */}
      {placeholderBanner && (
        <div className="mb-4 bg-brand/10 border border-brand/30 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold">Manual registration created for {placeholderBanner.name}.</p>
            <p className="text-[#e5e5e5]/60 text-xs mt-0.5">
              Payment reference: <span className="text-brand font-mono font-bold">{placeholderBanner.reference || 'not generated'}</span>. Send this to the player so their bank transfer can be matched.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {placeholderBanner.reference && (
              <button
                onClick={() => { navigator.clipboard?.writeText(placeholderBanner.reference); showToast('Payment reference copied') }}
                className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-3 py-1.5 rounded-lg transition-colors"
              >
                Copy reference
              </button>
            )}
            <button onClick={() => setPlaceholderBanner(null)} className="text-[#e5e5e5]/40 hover:text-white text-xl leading-none">×</button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-line mb-6">
        {[
          { key: 'players',  label: `Players (${regs.length})` },
          { key: 'teams',    label: `Teams (${teams.length})` },
          { key: 'doubles',  label: `Doubles (${doubles.length})` },
          { key: 'triples',  label: `Triples (${triples.length})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              tab === key ? 'border-brand text-brand' : 'border-transparent text-[#e5e5e5]/40 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : eventYear === null ? (
        <div className="text-center py-20 text-[#e5e5e5]/40 text-sm">
          No active event. Set an event to "open" in the Admin Event panel.
        </div>
      ) : tab === 'players' ? (

        /* ── Players tab ── */
        <div>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              placeholder="Search name or alias…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand w-48"
            />
            <select
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
              className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand"
            >
              <option value="all">All states</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {/* Needs-follow-up filter — only meaningful during the locked phase.
                Count badge shows how many registrations currently match. */}
            {phase === 'locked' && (
              <button
                onClick={() => setNeedsFollowUp(v => !v)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider border transition-colors ${
                  needsFollowUp
                    ? 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40'
                    : 'bg-surface text-[#e5e5e5]/60 border-line hover:border-yellow-500/30 hover:text-yellow-300'
                }`}
                title={needsFollowUp ? 'Showing players who haven\'t paid since lock' : 'Filter to locked-phase unpaid players'}
              >
                Needs follow-up
                <span className={`tabular-nums px-1.5 py-0.5 rounded text-[10px] ${
                  needsFollowUp ? 'bg-yellow-500/25 text-yellow-200' : 'bg-line/40 text-[#e5e5e5]/55'
                }`}>{needsFollowUpCount}</span>
              </button>
            )}
            <span className="text-[#e5e5e5]/30 text-xs self-center">{filtered.length} of {players.length} shown</span>
          </div>

          <div className="bg-surface border border-line rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              {filtered.length === 0 ? (
                <p className="text-center py-12 text-[#e5e5e5]/30 text-sm">No registrations found</p>
              ) : (
                <table className="w-full text-sm" style={{ minWidth: '1180px' }}>
                  <thead>
                    <tr className="border-b border-line">
                      {['Name', 'Alias', 'State', 'Team', 'CoC', 'Rules Test', 'Media', 'Owing', 'Paid', 'Balance', 'Payment', 'Status', 'Actions'].map(h => (
                        <th key={h} className={`px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider whitespace-nowrap ${h === 'Actions' ? 'sticky right-0 bg-surface border-l border-line' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => (
                      <PlayerRow
                        key={p.id}
                        p={p}
                        onEdit={handleEditRow}
                        onLink={handleLinkRow}
                        onPayment={handlePaymentRow}
                        onRemove={handleRemoveRow}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

      ) : tab === 'teams' ? (

        /* ── Teams tab ── */
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          {teams.length === 0 ? (
            <p className="text-center py-12 text-[#e5e5e5]/30 text-sm">No teams found</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['Team', 'State', 'Status', 'Captain', 'Players', 'Registered', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map(t => {
                  const captain = profMap[t.captain_id]
                  const roster = playersByTeam[t.id] ?? []
                  const captainRow = roster.find(p => p.user_id === t.captain_id)
                  const orderedRoster = captainRow
                    ? [captainRow, ...roster.filter(p => p.user_id !== t.captain_id)]
                    : roster
                  const incompleteCount = roster.filter(p => !p.complete).length
                  const isExpanded = expandedTeam === t.id
                  const canReview = !!t.event_id && t.status === 'pending'
                  return (
                    <Fragment key={t.id}>
                      <tr
                        onClick={() => toggleExpand(t.id)}
                        className="border-b border-line last:border-0 hover:bg-line/30 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 font-semibold text-white">
                          <span className="inline-flex items-center gap-2">
                            <span className={`text-[#e5e5e5]/40 transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`} aria-hidden>▸</span>
                            {t.name}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {t.state
                            ? <span className="text-xs bg-brand/10 text-brand border border-brand/20 px-2 py-0.5 rounded font-medium">{t.state}</span>
                            : <span className="text-[#e5e5e5]/30 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                        <td className="px-4 py-3 text-[#e5e5e5]/60 text-xs">
                          {captain ? [captain.first_name, captain.last_name].filter(Boolean).join(' ') || captain.alias || '—' : '—'}
                        </td>
                        <td className="px-4 py-3 text-[#e5e5e5]/50 text-xs">{playerCountByTeam[t.id] ?? 0}</td>
                        <td className="px-4 py-3 text-[#e5e5e5]/40 text-xs">{fmt(t.created_at)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={e => { e.stopPropagation(); toggleExpand(t.id) }}
                            className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/70 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                          >
                            {isExpanded ? 'Hide roster' : 'Review roster'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-line last:border-0 bg-base/40">
                          <td colSpan={7} className="px-4 py-4">
                            <p className="text-xs text-[#e5e5e5]/60 font-semibold mb-3">
                              Roster: <span className="text-white">{roster.length}</span> / {MIN_ROSTER} players
                              {incompleteCount > 0 && <span className="text-yellow-400 ml-2">· {incompleteCount} incomplete</span>}
                            </p>

                            {orderedRoster.length === 0 ? (
                              <p className="text-[#e5e5e5]/30 text-xs mb-3">No players on this team yet.</p>
                            ) : (
                              <div className="space-y-1.5 mb-3">
                                {orderedRoster.map(p => {
                                  const isCap = p.user_id === t.captain_id
                                  const pname = [p.profile?.first_name, p.profile?.last_name].filter(Boolean).join(' ')
                                    || p.profile?.alias || 'Unknown'
                                  return (
                                    <div key={p.id} className="flex items-center gap-2 flex-wrap">
                                      <span className="text-white text-xs font-medium">{pname}</span>
                                      {isCap && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-brand/10 text-brand border-brand/20">Captain</span>}
                                      {p.profile?.alias && !isCap && <span className="text-brand text-xs">"{p.profile.alias}"</span>}
                                      <EligibilityChips p={p} cocRequired={cocRequired} refRequired={refRequired} paymentRequired={paymentRequired} />
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {canReview ? (
                              <div className="pt-2 border-t border-line">
                                {incompleteCount > 0 && (
                                  <p className="text-yellow-400 text-xs mb-2">⚠ {incompleteCount} player{incompleteCount !== 1 ? 's' : ''} have incomplete requirements — you can still approve.</p>
                                )}
                                {rejectingTeam === t.id ? (
                                  <div className="space-y-2 max-w-lg">
                                    <textarea
                                      value={rejectReason}
                                      onChange={e => setRejectReason(e.target.value)}
                                      rows={2}
                                      placeholder="Reason for rejection (required, shown to the captain)…"
                                      className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => reviewTeam(t.id, 'reject', rejectReason.trim())}
                                        disabled={reviewBusy || !rejectReason.trim()}
                                        className="text-xs bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-3 py-1.5 rounded-lg transition-colors"
                                      >
                                        {reviewBusy ? 'Rejecting…' : 'Confirm reject'}
                                      </button>
                                      <button
                                        onClick={() => { setRejectingTeam(null); setRejectReason(''); setReviewError('') }}
                                        className="text-xs border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => reviewTeam(t.id, 'approve')}
                                      disabled={reviewBusy}
                                      className="text-xs bg-green-500/10 hover:bg-green-500/20 disabled:opacity-40 text-green-400 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                      {reviewBusy ? 'Working…' : 'Approve'}
                                    </button>
                                    <button
                                      onClick={() => { setRejectingTeam(t.id); setRejectReason(''); setReviewError('') }}
                                      className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                                {reviewError && <p className="text-red-400 text-xs mt-2">{reviewError}</p>}
                              </div>
                            ) : (
                              <p className="text-[#e5e5e5]/30 text-xs pt-2 border-t border-line">
                                {!t.event_id ? 'Competition team — reviewed elsewhere.' : `Team is ${t.status} — no review action.`}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

      ) : tab === 'doubles' ? (

        /* ── Doubles tab ── */
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          {doubles.length === 0 ? (
            <p className="text-center py-12 text-[#e5e5e5]/30 text-sm">No doubles pairs found</p>
          ) : (
            <table className="w-full text-sm" style={{ minWidth: '700px' }}>
              <thead>
                <tr className="border-b border-line">
                  {['Player 1', 'Player 2', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doubles.map(d => {
                  const p1 = profMap[d.player1_id]
                  const p2 = profMap[d.player2_id]
                  function pName(p) {
                    if (!p) return <span className="text-[#e5e5e5]/30 text-xs italic">Unknown</span>
                    return (
                      <span>
                        <span className="font-semibold text-white">{[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}</span>
                        {p.alias && <span className="text-brand text-xs ml-1">"{p.alias}"</span>}
                      </span>
                    )
                  }
                  return (
                    <tr key={d.id} className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
                      <td className="px-4 py-3">{pName(p1)}</td>
                      <td className="px-4 py-3">{pName(p2)}</td>
                      <td className="px-4 py-3">
                        {d.confirmed
                          ? <Pill color="green">Confirmed</Pill>
                          : <Pill color="amber">Pending</Pill>}
                      </td>
                      <td className="px-4 py-3 text-[#e5e5e5]/40 text-xs">{fmt(d.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={async () => {
                            await apiFetch('/api/admin/event?resource=registrations', { method: 'DELETE', body: JSON.stringify({ kind: 'doubles', id: d.id }) })
                            setDoubles(prev => prev.filter(x => x.id !== d.id))
                          }}
                          className="text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2.5 py-1.5 rounded-lg transition-colors">
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

      ) : (

        /* ── Triples tab ── */
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          {triples.length === 0 ? (
            <p className="text-center py-12 text-[#e5e5e5]/30 text-sm">No triples teams found</p>
          ) : (
            <table className="w-full text-sm" style={{ minWidth: '800px' }}>
              <thead>
                <tr className="border-b border-line">
                  {['Player 1', 'Player 2', 'Player 3', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {triples.map(t => {
                  const p1 = profMap[t.player1_id]
                  const p2 = profMap[t.player2_id]
                  const p3 = profMap[t.player3_id]
                  function pName(p) {
                    if (!p) return <span className="text-[#e5e5e5]/30 text-xs">—</span>
                    return (
                      <span>
                        <span className="font-semibold text-white">{[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}</span>
                        {p.alias && <span className="text-brand text-xs ml-1">"{p.alias}"</span>}
                      </span>
                    )
                  }
                  return (
                    <tr key={t.id} className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
                      <td className="px-4 py-3">{pName(p1)}</td>
                      <td className="px-4 py-3">{pName(p2)}</td>
                      <td className="px-4 py-3">{pName(p3)}</td>
                      <td className="px-4 py-3">
                        {t.confirmed
                          ? <Pill color="green">Confirmed</Pill>
                          : <Pill color="amber">Pending</Pill>}
                      </td>
                      <td className="px-4 py-3 text-[#e5e5e5]/40 text-xs">{fmt(t.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={async () => {
                            await apiFetch('/api/admin/event?resource=registrations', { method: 'DELETE', body: JSON.stringify({ kind: 'triples', id: t.id }) })
                            setTriples(prev => prev.filter(x => x.id !== t.id))
                          }}
                          className="text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2.5 py-1.5 rounded-lg transition-colors">
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
