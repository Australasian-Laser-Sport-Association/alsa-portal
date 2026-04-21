import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import supabaseAdmin from '../../lib/supabaseAdmin'

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Pill({ color, children }) {
  const styles = {
    green:  'bg-green-500/15 text-green-400 border-green-500/30',
    red:    'bg-red-500/15 text-red-400 border-red-500/30',
    amber:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
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

const YEAR = 2027

export default function AdminRegistrations() {
  const [tab, setTab] = useState('players')
  const [regs, setRegs] = useState([])
  const [profiles, setProfiles] = useState([])
  const [teams, setTeams] = useState([])
  const [cocSigs, setCocSigs] = useState([])
  const [refResults, setRefResults] = useState([])
  const [mediaReleases, setMediaReleases] = useState([])
  const [payments, setPayments] = useState([])
  const [doubles, setDoubles] = useState([])
  const [triples, setTriples] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [removeConfirm, setRemoveConfirm] = useState(null) // { userId, name, alias }
  const [toast, setToast] = useState(null)

  useEffect(() => { fetchAll() }, [])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function fetchAll() {
    setLoading(true)
    setError(null)

    const [
      { data: regsData,    error: regsErr },
      { data: profsData,   error: profsErr },
      { data: teamsData,   error: teamsErr },
      { data: cocData,     error: cocErr },
      { data: refData,     error: refErr },
      { data: mediaData,   error: mediaErr },
      { data: payData,     error: payErr },
      { data: doublesData, error: doublesErr },
      { data: triplesData, error: triplesErr },
    ] = await Promise.all([
      supabase
        .from('zltac_registrations')
        .select('id, user_id, team_id, year, status, created_at, side_events, dinner_guests')
        .eq('year', YEAR)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, alias, state'),
      supabase
        .from('teams')
        .select('id, name, state, status, captain_id, created_at'),
      supabaseAdmin
        .from('code_of_conduct_signatures')
        .select('user_id, signed_at'),
      supabaseAdmin
        .from('referee_test_results')
        .select('user_id, passed, score'),
      supabaseAdmin
        .from('media_release_submissions')
        .select('user_id, submitted_at'),
      supabaseAdmin
        .from('payments')
        .select('user_id, status, amount_paid')
        .eq('event_year', YEAR),
      supabaseAdmin
        .from('doubles_pairs')
        .select('*')
        .eq('event_year', YEAR)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('triples_teams')
        .select('*')
        .eq('event_year', YEAR)
        .order('created_at', { ascending: false }),
    ])

    const errs = [regsErr, profsErr, teamsErr, cocErr, refErr, mediaErr, payErr, doublesErr, triplesErr].filter(Boolean)
    if (errs.length) setError(errs.map(e => e.message).join(' | '))

    setRegs(regsData ?? [])
    setProfiles(profsData ?? [])
    setTeams(teamsData ?? [])
    setCocSigs(cocData ?? [])
    setRefResults(refData ?? [])
    setMediaReleases(mediaData ?? [])
    setPayments(payData ?? [])
    setDoubles(doublesData ?? [])
    setTriples(triplesData ?? [])
    setLoading(false)
  }

  // Build lookup maps
  const profMap    = Object.fromEntries(profiles.map(p => [p.id, p]))
  const teamMap    = Object.fromEntries(teams.map(t => [t.id, t]))
  const cocSet     = new Set(cocSigs.map(c => c.user_id))
  const refMap     = Object.fromEntries(refResults.map(r => [r.user_id, r]))
  const mediaSet   = new Set(mediaReleases.map(m => m.user_id))
  const payMap     = Object.fromEntries(payments.map(p => [p.user_id, p]))

  // Enrich registrations
  const players = regs.map(reg => {
    const profile = profMap[reg.user_id] ?? null
    const team    = teamMap[reg.team_id] ?? null
    const coc     = cocSet.has(reg.user_id)
    const ref     = refMap[reg.user_id] ?? null
    const media   = mediaSet.has(reg.user_id)
    const pay     = payMap[reg.user_id] ?? null
    const paid    = pay?.status === 'paid'
    const complete = coc && ref?.passed && media && paid
    const doneCount = [coc, ref?.passed, media, paid].filter(Boolean).length
    return { ...reg, profile, team, coc, ref, media, paid, complete, doneCount }
  })

  // Filters
  const states = [...new Set(players.map(p => p.profile?.state).filter(Boolean))].sort()
  const filtered = players.filter(p => {
    if (stateFilter !== 'all' && p.profile?.state !== stateFilter) return false
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

  async function removePlayer() {
    if (!removeConfirm) return
    const { error } = await supabaseAdmin
      .from('zltac_registrations')
      .delete()
      .eq('user_id', removeConfirm.userId)
      .eq('year', YEAR)
    if (error) { showToast(`Error: ${error.message}`); setRemoveConfirm(null); return }
    setRegs(prev => prev.filter(r => r.user_id !== removeConfirm.userId))
    showToast(`${removeConfirm.alias || removeConfirm.name} removed from ZLTAC ${YEAR}`)
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
              {removeConfirm.alias ? <span className="text-brand"> ({removeConfirm.alias})</span> : ''} from ZLTAC {YEAR}?
              This will delete their registration record. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={removePlayer} className="bg-red-500 hover:bg-red-600 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">Remove player</button>
              <button onClick={() => setRemoveConfirm(null)} className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Registrations</h1>
          <p className="text-[#e5e5e5]/40 text-sm mt-1">
            ZLTAC {YEAR} — {players.length} players · <span className="text-green-400">{completeCount} complete</span> · <span className="text-red-400">{incompleteCount} incomplete</span>
          </p>
        </div>
        <button
          onClick={fetchAll}
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
            <span className="text-[#e5e5e5]/30 text-xs self-center">{filtered.length} of {players.length} shown</span>
          </div>

          <div className="bg-surface border border-line rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              {filtered.length === 0 ? (
                <p className="text-center py-12 text-[#e5e5e5]/30 text-sm">No registrations found</p>
              ) : (
                <table className="w-full text-sm" style={{ minWidth: '900px' }}>
                  <thead>
                    <tr className="border-b border-line">
                      {['Name', 'Alias', 'State', 'Team', 'CoC', 'Ref Test', 'Media', 'Payment', 'Status', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
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
                          {/* Ref Test */}
                          <td className="px-4 py-3">
                            {p.ref
                              ? p.ref.passed
                                ? <Pill color="green">Passed ({p.ref.score}%)</Pill>
                                : <Pill color="amber">Failed ({p.ref.score}%)</Pill>
                              : <Pill color="grey">Not taken</Pill>}
                          </td>
                          {/* Media */}
                          <td className="px-4 py-3">
                            {p.media ? <Pill color="green">Submitted</Pill> : <Pill color="grey">Pending</Pill>}
                          </td>
                          {/* Payment */}
                          <td className="px-4 py-3">
                            {p.paid ? <Pill color="green">Paid</Pill> : <Pill color="red">Unpaid</Pill>}
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {p.complete
                              ? <Pill color="green">Complete</Pill>
                              : <Pill color="red">{p.doneCount}/4</Pill>}
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setRemoveConfirm({ userId: p.user_id, name, alias: p.profile?.alias })}
                              className="text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
                            >
                              Remove
                            </button>
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
                            await supabaseAdmin.from('doubles_pairs').delete().eq('id', d.id)
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
                            await supabaseAdmin.from('triples_teams').delete().eq('id', t.id)
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
