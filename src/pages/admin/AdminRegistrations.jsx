import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate } from '../../lib/dateFormat'
import { dollars } from '../../lib/pricing.js'
import RecordPaymentModal from '../../components/RecordPaymentModal.jsx'
import RegistrationEditModal from '../../components/RegistrationEditModal.jsx'
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

function StatusBadge({ status }) {
  const styles = {
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

  // Build lookup maps
  const profMap    = Object.fromEntries(profiles.map(p => [p.id, p]))
  const teamMap    = Object.fromEntries(teams.map(t => [t.id, t]))
  const cocSet     = new Set(cocSigs.map(c => c.user_id))
  const refMap     = Object.fromEntries(refResults.map(r => [r.user_id, r]))
  const mediaSet   = new Set(mediaReleases.map(m => m.user_id))
  const recordsByReg = paymentRecords.reduce((acc, r) => {
    (acc[r.registration_id] ??= []).push(r)
    return acc
  }, {})

  // Enrich registrations
  // Per-event requirement toggles. When off, that requirement is skipped
  // from the per-row "complete" badge and from the doneCount.
  const refRequired     = isRefTestRequired(event)
  const cocRequired     = isCocRequired(event)
  const paymentRequired = isPaymentRequired(event)

  const players = regs.map(reg => {
    const profile = profMap[reg.user_id] ?? null
    const team    = teamMap[reg.team_id] ?? null
    // Committee manual overrides count as satisfied: normalCheck || override.
    const coc       = cocSet.has(reg.user_id) || !!reg.admin_override_coc
    const ref       = refMap[reg.user_id] ?? null
    const refPassed = ref?.passed === true || !!reg.admin_override_ref_test
    const media     = mediaSet.has(reg.user_id) || !!reg.admin_override_media
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
    // Tooltip detail for the Rules Test pill: section breakdown when present,
    // legacy note for pre-section results, override note when committee-waived.
    const refTitle = ref
      ? (ref.safety_total != null
          ? `Safety ${ref.safety_correct ?? 0}/${ref.safety_total}, General ${ref.general_correct ?? 0}/${ref.general_total ?? 0}`
          : 'Legacy result — no section breakdown')
      : (reg.admin_override_ref_test ? 'Committee override — verified outside the system' : 'Not taken')
    return { ...reg, profile, team, coc, ref, refPassed, refTitle, media, amountOwing, amountPaid, balance, payStatus, paid, complete, doneCount, totalChecks: checks.length }
  })

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
  const states = [...new Set(players.map(p => p.profile?.state).filter(Boolean))].sort()
  const filtered = players.filter(p => {
    if (stateFilter !== 'all' && p.profile?.state !== stateFilter) return false
    if (needsFollowUp && !(paymentRequired && phase === 'locked' && p.balance > 0)) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const name = [p.profile?.first_name, p.profile?.last_name].filter(Boolean).join(' ').toLowerCase()
      const alias = (p.profile?.alias ?? '').toLowerCase()
      if (!name.includes(q) && !alias.includes(q)) return false
    }
    return true
  })

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

  // Player count per team
  const playerCountByTeam = regs.reduce((acc, r) => {
    if (r.team_id) acc[r.team_id] = (acc[r.team_id] ?? 0) + 1
    return acc
  }, {})

  async function updateTeamStatus(id, status) {
    const { error } = await supabase.from('teams').update({ status }).eq('id', id)
    if (error) { console.error(error); return }
    setTeams(prev => prev.map(t => t.id === id ? { ...t, status } : t))
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

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Registrations</h1>
          <p className="text-[#e5e5e5]/40 text-sm mt-1">
            ZLTAC {eventYear} — {players.length} players · <span className="text-green-400">{completeCount} complete</span> · <span className="text-red-400">{incompleteCount} incomplete</span>
          </p>
        </div>
        <button
          onClick={() => eventYear && fetchAll()}
          className="text-xs bg-surface border border-line hover:border-brand text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

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
                    {filtered.map(p => {
                      const name = [p.profile?.first_name, p.profile?.last_name].filter(Boolean).join(' ') || '—'
                      return (
                        <tr key={p.id} className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
                          {/* Name */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {(p.profile?.first_name || p.profile?.last_name)
                              ? <span className="font-semibold text-white">{name}</span>
                              : <span className="text-[#e5e5e5]/30 italic text-xs">Unknown</span>}
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
                          <td className="px-4 py-3">
                            {p.coc ? <Pill color="green">Signed</Pill> : <Pill color="red">Unsigned</Pill>}
                          </td>
                          {/* Rules Test */}
                          <td className="px-4 py-3" title={p.refTitle}>
                            {p.refPassed
                              ? <Pill color="green">Passed{p.ref?.score != null ? ` (${p.ref.score}%)` : ''}</Pill>
                              : p.ref
                                ? <Pill color="amber">Failed ({p.ref.score}%)</Pill>
                                : <Pill color="grey">Not taken</Pill>}
                          </td>
                          {/* Media */}
                          <td className="px-4 py-3">
                            {p.media ? <Pill color="green">Submitted</Pill> : <Pill color="grey">Pending</Pill>}
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
                                onClick={() => setEditModal({ registration: p, profile: p.profile })}
                                className="text-xs font-semibold px-3 py-1 rounded-full border bg-blue-500/15 border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setPaymentModal({ registration: p, profile: p.profile })}
                                className="text-xs font-semibold px-3 py-1 rounded-full border bg-green-500/15 border-green-500/30 text-green-300 hover:bg-green-500/25 transition-colors"
                              >
                                Record Payment / Refund
                              </button>
                              <button
                                onClick={() => setRemoveConfirm({ userId: p.user_id, name, alias: p.profile?.alias })}
                                className="text-xs font-semibold px-3 py-1 rounded-full border bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
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
                  return (
                    <tr key={t.id} className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
                      <td className="px-4 py-3 font-semibold text-white">{t.name}</td>
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
                        <div className="flex items-center gap-2">
                          {t.status !== 'approved' && (
                            <button onClick={() => updateTeamStatus(t.id, 'approved')}
                              className="text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 font-semibold px-3 py-1.5 rounded-lg transition-colors">
                              Approve
                            </button>
                          )}
                          {t.status !== 'rejected' && (
                            <button onClick={() => updateTeamStatus(t.id, 'rejected')}
                              className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold px-3 py-1.5 rounded-lg transition-colors">
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
