import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import Footer from '../components/Footer'

function isUnder18(dob, eventYear) {
  if (!dob) return false
  const cutoff = new Date(`${eventYear}-07-01`)
  const eighteenth = new Date(dob)
  eighteenth.setFullYear(eighteenth.getFullYear() + 18)
  return eighteenth > cutoff
}
function initials(name = '') { return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?' }

function Tick({ ok }) {
  return (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black ${ok ? 'text-black' : 'text-red-400 border border-red-400/40 bg-red-400/10'}`}
      style={ok ? { background: '#00FF41' } : {}}>
      {ok ? '✓' : '✗'}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    pending:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    approved: 'bg-brand/10 text-brand border-brand/20',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
  }
  return (
    <span className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${map[status] ?? map.pending}`}>
      {status}
    </span>
  )
}

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

export default function CaptainHub() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState(null)
  const [event, setEvent] = useState(null)
  const [roster, setRoster] = useState([])
  const [completionMap, setCompletionMap] = useState({})
  const [filter, setFilter] = useState('all')
  const [copyDone, setCopyDone] = useState(false)

  // Player search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchDone, setSearchDone] = useState(false)
  const searchTimer = useRef(null)

  // Remove confirmation
  const [removeConfirm, setRemoveConfirm] = useState(null) // { regId, alias }

  // Toast
  const [toast, setToast] = useState(null)

  // Team settings
  const [editingSettings, setEditingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({ name: '', state: '', home_venue: '' })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsErr, setSettingsErr] = useState('')

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user) return
    load()
  }, [authLoading, user]) // eslint-disable-line

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // ── Load data ─────────────────────────────────────────────────────────────
  async function load() {
    const [{ data: ev }, { data: t }] = await Promise.all([
      supabase.from('zltac_events').select('id, name, year, status').eq('status', 'open').maybeSingle(),
      supabase.from('teams').select('id, name, state, home_venue, colour, invite_code, status, rejection_reason, logo_url').eq('captain_id', user.id).maybeSingle(),
    ])
    setEvent(ev)
    if (!t) { setLoading(false); return }
    setTeam(t)
    setSettingsForm({ name: t.name ?? '', state: t.state ?? '', home_venue: t.home_venue ?? '' })
    if (ev?.year) await loadRoster(t, ev.year)
    setLoading(false)
  }

  async function loadRoster(t, eventYear) {
    const { data: regsData } = await supabase
      .from('zltac_registrations')
      .select('id, user_id, side_events, dinner_guests, status, emergency_contact_name')
      .eq('team_id', t.id)
      .eq('year', eventYear)

    const rows = regsData ?? []

    if (rows.length > 0) {
      const userIds = rows.map(r => r.user_id).filter(Boolean)
      const { profiles: profData } = await apiFetch('/api/profiles', {
        method: 'POST',
        body: JSON.stringify({ ids: userIds }),
      })
      const profMap = Object.fromEntries((profData ?? []).map(p => [p.id, p]))
      const enriched = rows.map(r => ({ ...r, profiles: profMap[r.user_id] ?? null }))
      setRoster(enriched)
      await loadCompletions(enriched.map(r => r.user_id), eventYear)
    } else {
      setRoster([])
      setCompletionMap({})
    }
  }

  async function loadCompletions(playerIds, eventYear) {
    if (!playerIds.length) return
    const { coc_sigs, payments, ref_results, u18_subs, media_subs } = await apiFetch(
      '/api/captain',
      { method: 'POST', body: JSON.stringify({ action: 'team-completions', playerIds, eventYear }) },
    )
    const cocSet   = new Set((coc_sigs  ?? []).map(c => c.user_id))
    const payMap   = Object.fromEntries((payments   ?? []).map(p => [p.user_id, p.status]))
    const testMap  = Object.fromEntries((ref_results ?? []).map(t => [t.user_id, t]))
    const u18Set   = new Set((u18_subs  ?? []).map(u => u.user_id))
    const mediaSet = new Set((media_subs ?? []).map(m => m.user_id))
    const comp = {}
    playerIds.forEach(uid => {
      comp[uid] = {
        coc:       cocSet.has(uid),
        paid:      payMap[uid] === 'paid',
        test:      testMap[uid]?.passed === true,
        testScore: testMap[uid]?.score,
        u18:       u18Set.has(uid),
        media:     mediaSet.has(uid),
      }
    })
    setCompletionMap(comp)
  }

  // ── Player search ─────────────────────────────────────────────────────────
  function onSearchChange(val) {
    setSearchQuery(val)
    setSearchResults([])
    setSearchDone(false)
    clearTimeout(searchTimer.current)
    if (val.trim().length < 3) return
    searchTimer.current = setTimeout(() => runSearch(val.trim()), 350)
  }

  async function runSearch(term) {
    if (!event?.year || !team) return
    setSearching(true)

    // Get registered user_ids with no team for current event, excluding the captain
    const { data: unassigned } = await supabase
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', event.year)
      .is('team_id', null)
      .neq('user_id', user.id)

    const unassignedIds = (unassigned ?? []).map(r => r.user_id).filter(Boolean)

    if (unassignedIds.length === 0) {
      setSearchResults([])
      setSearchDone(true)
      setSearching(false)
      return
    }

    const { profiles: allProfiles } = await apiFetch('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ ids: unassignedIds }),
    })
    const q = term.toLowerCase()
    const matches = (allProfiles ?? []).filter(p =>
      (p.first_name ?? '').toLowerCase().includes(q) ||
      (p.last_name ?? '').toLowerCase().includes(q) ||
      (p.alias ?? '').toLowerCase().includes(q)
    ).slice(0, 10)

    setSearchResults(matches)
    setSearchDone(true)
    setSearching(false)
  }

  async function addPlayer(profile) {
    if (!team || !event?.year) return

    try {
      await apiFetch('/api/captain', {
        method: 'POST',
        body: JSON.stringify({ action: 'add-player', playerId: profile.id, teamId: team.id, year: event.year }),
      })
    } catch (err) {
      showToast(`Error: ${err.message}`)
      return
    }

    // Optimistically add to roster
    const newRow = { id: `tmp-${profile.id}`, user_id: profile.id, profiles: profile, side_events: null, dinner_guests: 0, status: 'pending' }
    setRoster(r => [...r, newRow])
    setSearchResults(r => r.filter(p => p.id !== profile.id))
    setSearchQuery('')
    setSearchDone(false)
    showToast(`${profile.alias || profile.first_name} added to your team`)

    if (team && event?.year) loadRoster(team, event.year)
  }

  // ── Remove player ─────────────────────────────────────────────────────────
  async function confirmRemove() {
    if (!removeConfirm) return
    const { error } = await supabase
      .from('zltac_registrations')
      .update({ team_id: null })
      .eq('id', removeConfirm.regId)

    if (error) { showToast(`Error: ${error.message}`); setRemoveConfirm(null); return }

    // Phase B.3a dual-write: mirror removal into team_members.
    try {
      if (team?.id && removeConfirm.userId) {
        const { error: memberErr } = await supabase
          .from('team_members')
          .delete()
          .eq('team_id', team.id)
          .eq('user_id', removeConfirm.userId)
        if (memberErr) console.error('[CaptainHub confirmRemove] dual-write team_members delete failed:', memberErr.message)
      }
    } catch (err) {
      console.error('[CaptainHub confirmRemove] dual-write threw:', err)
    }

    setRoster(r => r.filter(p => p.id !== removeConfirm.regId))
    showToast(`${removeConfirm.alias} removed from your team`)
    setRemoveConfirm(null)
  }

  // ── Copy invite link ──────────────────────────────────────────────────────
  function copyInviteLink() {
    if (!team || !event?.year) return
    const url = `${window.location.origin}/events/${event.year}/player-register`
    navigator.clipboard.writeText(url)
    setCopyDone(true)
    setTimeout(() => setCopyDone(false), 2000)
  }

  // ── Team settings ─────────────────────────────────────────────────────────
  async function saveSettings() {
    if (!settingsForm.name.trim()) { setSettingsErr('Team name is required.'); return }
    setSavingSettings(true); setSettingsErr('')
    const { error } = await supabase.from('teams').update({
      name: settingsForm.name.trim(),
      state: settingsForm.state || null,
      home_venue: settingsForm.home_venue.trim() || null,
    }).eq('id', team.id)
    setSavingSettings(false)
    if (error) { setSettingsErr(error.message); return }
    setTeam(t => ({ ...t, ...settingsForm }))
    setEditingSettings(false)
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportRosterCSV() {
    if (!roster.length) return
    const rows = roster.map(r => ({
      name: `${r.profiles?.first_name ?? ''} ${r.profiles?.last_name ?? ''}`.trim(),
      alias: r.profiles?.alias ?? '',
      state: r.profiles?.state ?? '',
      dob: r.profiles?.dob ?? '',
      side_events: (r.side_events ?? []).join('; '),
      dinner_guests: r.dinner_guests ?? 0,
      status: r.status ?? '',
      coc:      completionMap[r.user_id]?.coc  ? 'Yes' : 'No',
      paid:     completionMap[r.user_id]?.paid ? 'Yes' : 'No',
      ref_test: completionMap[r.user_id]?.test ? 'Yes' : 'No',
    }))
    const keys = Object.keys(rows[0])
    const csv = [keys.join(','), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'roster.csv'; a.click()
  }

  function isPlayerReady(uid) {
    const c = completionMap[uid]
    if (!c) return false
    const row = roster.find(r => r.user_id === uid)
    const u18needed = isUnder18(row?.profiles?.dob, event?.year)
    return c.coc && c.paid && c.test && c.media && (!u18needed || c.u18)
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return <div className="min-h-screen bg-base flex items-center justify-center"><div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
  }
  if (!team) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <div className="text-4xl mb-4">👑</div>
        <h1 className="text-2xl font-black text-white mb-2">No Team Found</h1>
        <p className="text-[#e5e5e5]/40 text-sm mb-6">You haven't registered a team yet.</p>
        <Link to={event ? `/events/${event.year}/captain-register` : '/'} className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all">
          Register a Team →
        </Link>
      </div>
    )
  }

  const eventYear = event?.year
  const inviteUrl = event ? `${window.location.origin}/events/${eventYear}/player-register` : ''
  const filteredRoster = roster.filter(r => {
    if (filter === 'ready') return isPlayerReady(r.user_id)
    if (filter === 'incomplete') return !isPlayerReady(r.user_id)
    if (filter === 'unpaid') return !completionMap[r.user_id]?.paid
    return true
  })

  return (
    <div className="min-h-screen bg-base text-white">
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
            <p className="text-[#e5e5e5]/50 text-sm mb-5">Remove <span className="text-white font-semibold">{removeConfirm.alias}</span> from your team? Their registration will remain but they'll be unassigned.</p>
            <div className="flex gap-3">
              <button onClick={confirmRemove} className="bg-red-500 hover:bg-red-600 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">Remove</button>
              <button onClick={() => setRemoveConfirm(null)} className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-10">
        {event && (
          <Link to={`/events/${eventYear}`} className="text-[#e5e5e5]/40 hover:text-brand text-xs transition-colors mb-5 inline-block">
            ← {event.name}
          </Link>
        )}

        {/* Header */}
        <div className="flex items-start gap-5 mb-6">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center font-black text-black text-base flex-shrink-0" style={{ background: team.colour ?? '#00E6FF' }}>
            {team.logo_url
              ? <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain rounded-xl" />
              : initials(team.name)
            }
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-2xl font-black text-white">{team.name}</h1>
              <StatusBadge status={team.status} />
            </div>
            <p className="text-[#e5e5e5]/40 text-xs">
              {team.state && <span>{team.state} · </span>}
              {team.home_venue && <span>{team.home_venue} · </span>}
              <span>ZLTAC {eventYear ?? '—'} · Team Hub</span>
            </p>
          </div>
        </div>

        {/* Status banners */}
        {team.status === 'pending' && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 mb-5">
            <p className="text-yellow-400 text-sm font-semibold">⏳ Your team is awaiting ZLTAC approval</p>
            <p className="text-[#e5e5e5]/40 text-xs mt-0.5">You can add players now. Registrations won't be confirmed until your team is approved.</p>
          </div>
        )}
        {team.status === 'rejected' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-5">
            <p className="text-red-400 text-sm font-semibold">✗ Team registration was not approved</p>
            {team.rejection_reason && <p className="text-[#e5e5e5]/50 text-xs mt-1">Reason: {team.rejection_reason}</p>}
          </div>
        )}

        <div className="space-y-5">

          {/* ── Add Players ───────────────────────────────────────────────── */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">Add Players to Team</h2>
            <p className="text-[#e5e5e5]/40 text-xs mb-4">Search for players who have registered for ZLTAC {eventYear} but are not yet on a team.</p>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
                placeholder="Search by name or alias…"
                className="w-full bg-base border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand transition-colors"
              />
              {searching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {/* Search feedback */}
            {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
              <p className="text-[#e5e5e5]/35 text-xs mt-3">Type at least 3 characters to search</p>
            )}

            {searchDone && !searching && searchResults.length === 0 && searchQuery.trim().length >= 3 && (
              <p className="text-[#e5e5e5]/35 text-xs mt-3">
                No registered ZLTAC {eventYear} players found matching that search. They may not have registered for ZLTAC yet — share your invite link so they can register.
              </p>
            )}

            {searchResults.length > 0 && (
              <div className="mt-2 border border-line rounded-xl overflow-hidden">
                {searchResults.map((p, i) => {
                  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || '—'
                  return (
                    <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${i !== 0 ? 'border-t border-line' : ''} hover:bg-line/30 transition-colors`}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-black flex-shrink-0" style={{ background: '#00E6FF' }}>
                        {initials(name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-white text-sm font-semibold">{name}</span>
                        {p.alias && <span className="text-brand text-xs ml-2">"{p.alias}"</span>}
                        {p.state && <span className="ml-2 text-[10px] bg-line text-[#e5e5e5]/50 px-1.5 py-0.5 rounded-full font-bold">{p.state}</span>}
                      </div>
                      <button
                        onClick={() => addPlayer(p)}
                        className="flex-shrink-0 text-xs bg-brand/10 hover:bg-brand/20 text-brand font-bold px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Add to Team
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Invite Link ───────────────────────────────────────────────── */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">Player Invite Link</h2>
            <p className="text-[#e5e5e5]/40 text-xs mb-4">
              Send the link below to get players to sign up and register for ZLTAC {eventYear}.
              Once they have registered you can add them to your team using the search above.
            </p>
            <div className="flex items-center gap-2 bg-base border border-line rounded-xl px-4 py-3">
              <span className="text-brand text-sm font-mono flex-1 break-all select-all">{inviteUrl || '—'}</span>
              <button
                onClick={copyInviteLink}
                disabled={!inviteUrl}
                className="text-xs bg-brand/10 hover:bg-brand/20 text-brand font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40"
              >
                {copyDone ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* ── Roster ────────────────────────────────────────────────────── */}
          <div className="bg-surface border border-line rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-white font-bold">Team Roster</h2>
                <p className="text-[#e5e5e5]/40 text-xs mt-0.5">{roster.length} player{roster.length !== 1 ? 's' : ''} on your team</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {['all', 'ready', 'incomplete', 'unpaid'].map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg capitalize transition-colors ${filter === f ? 'bg-brand text-black' : 'bg-line text-[#e5e5e5]/50 hover:text-white'}`}>
                    {f}
                  </button>
                ))}
                <button onClick={exportRosterCSV} className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/50 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                  CSV
                </button>
              </div>
            </div>

            {filteredRoster.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[#e5e5e5]/30 text-sm">
                  {roster.length === 0
                    ? 'No players on your team yet. Search for registered players above or share your invite link.'
                    : 'No players match this filter.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {filteredRoster.map(r => {
                  const name = [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(' ') || '—'
                  const alias = r.profiles?.alias
                  const pState = r.profiles?.state
                  const dob = r.profiles?.dob
                  const avatarUrl = r.profiles?.avatar_url
                  const u18 = isUnder18(dob, eventYear)
                  const comp = completionMap[r.user_id] ?? {}
                  const ready = isPlayerReady(r.user_id)
                  const isMe = r.user_id === user.id

                  return (
                    <div key={r.id} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        {avatarUrl
                          ? <img src={avatarUrl} alt={name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-black flex-shrink-0" style={{ background: '#00E6FF' }}>{initials(name)}</div>
                        }

                        <div className="flex-1 min-w-0">
                          {/* Name row */}
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <span className="text-white font-semibold text-sm">{name}</span>
                            {alias && <span className="text-brand text-xs">"{alias}"</span>}
                            {pState && <span className="text-[10px] bg-brand/10 text-brand border border-brand/20 px-1.5 py-0.5 rounded-full font-bold">{pState}</span>}
                            {u18 && <span className="text-[10px] bg-yellow-400/10 text-yellow-400 border border-yellow-400/20 px-1.5 py-0.5 rounded-full font-bold">U18</span>}
                            {isMe && <span className="text-[10px] text-[#e5e5e5]/30 font-semibold">(You)</span>}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ready ? 'bg-brand/10 text-brand' : 'bg-yellow-500/10 text-yellow-400'}`}>
                              {ready ? 'Ready' : 'Incomplete'}
                            </span>
                          </div>

                          {/* Completion ticks */}
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <Tick ok={comp.coc} />
                              <span className="text-xs text-[#e5e5e5]/40">CoC</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Tick ok={comp.test} />
                              <span className="text-xs text-[#e5e5e5]/40">Ref Test{comp.testScore != null ? ` (${comp.testScore}%)` : ''}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Tick ok={comp.paid} />
                              <span className="text-xs text-[#e5e5e5]/40">Paid</span>
                            </div>
                            {u18 && (
                              <div className="flex items-center gap-1.5">
                                <Tick ok={comp.u18} />
                                <span className="text-xs text-[#e5e5e5]/40">U18 Form</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <Tick ok={comp.media} />
                              <span className="text-xs text-[#e5e5e5]/40">Media</span>
                            </div>
                          </div>
                        </div>

                        {/* Remove button */}
                        {!isMe && (
                          <button
                            onClick={() => setRemoveConfirm({ regId: r.id, userId: r.user_id, alias: alias || name })}
                            className="flex-shrink-0 text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Team Settings ─────────────────────────────────────────────── */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold">Team Settings</h2>
              {!editingSettings && (
                <button onClick={() => setEditingSettings(true)} className="text-xs text-brand/60 hover:text-brand transition-colors">Edit</button>
              )}
            </div>
            {editingSettings ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Team Name</label>
                  <input type="text" value={settingsForm.name} onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-base border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">State / Territory</label>
                  <select value={settingsForm.state} onChange={e => setSettingsForm(f => ({ ...f, state: e.target.value }))}
                    className="w-full bg-base border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand">
                    <option value="">Select…</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Home Venue</label>
                  <input type="text" value={settingsForm.home_venue} onChange={e => setSettingsForm(f => ({ ...f, home_venue: e.target.value }))}
                    placeholder="e.g. Zone300 Sydney"
                    className="w-full bg-base border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand" />
                </div>
                {settingsErr && <p className="text-red-400 text-xs">{settingsErr}</p>}
                <div className="flex gap-3">
                  <button onClick={saveSettings} disabled={savingSettings}
                    className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all">
                    {savingSettings ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => { setEditingSettings(false); setSettingsErr('') }}
                    className="border border-line text-[#e5e5e5]/50 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[#e5e5e5]/40">Team Name</span><span className="text-white font-semibold">{team.name}</span></div>
                <div className="flex justify-between"><span className="text-[#e5e5e5]/40">State</span><span className="text-white">{team.state ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-[#e5e5e5]/40">Home Venue</span><span className="text-white">{team.home_venue ?? '—'}</span></div>
              </div>
            )}
          </div>

        </div>
      </div>
      <Footer />
    </div>
  )
}
