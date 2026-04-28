import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { formatDate } from '../lib/dateFormat'
import { isCommittee } from '../lib/roles'
import Footer from '../components/Footer'

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const SIDE_EVENT_SLUG_ORDER = ['lord-of-the-rings', 'solos', 'doubles', 'triples']

// ── Hero Card Icons ──────────────────────────────────────────────────────────
const ShieldCrownIcon = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32 6 L54 16 L54 34 C54 47 44 56 32 60 C20 56 10 47 10 34 L10 16 Z" stroke="#00FF41" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
    <path d="M20 40 L20 28 L25.5 34 L32 22 L38.5 34 L44 28 L44 40 Z" stroke="#00FF41" strokeWidth="2" strokeLinejoin="round" fill="none"/>
    <circle cx="20" cy="26" r="2" fill="#00FF41"/>
    <circle cx="32" cy="20" r="2" fill="#00FF41"/>
    <circle cx="44" cy="26" r="2" fill="#00FF41"/>
  </svg>
)

const PlayerPersonIcon = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="32" cy="20" r="10" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <path d="M10 58 C10 44 20 36 32 36 C44 36 54 44 54 58" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
    <line x1="32" y1="36" x2="32" y2="48" stroke="#00FF41" strokeWidth="2" strokeLinecap="round"/>
    <line x1="24" y1="42" x2="40" y2="42" stroke="#00FF41" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

const DashboardGridIcon = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="8" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <rect x="34" y="8" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <rect x="8" y="34" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <rect x="34" y="34" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <line x1="15" y1="19" x2="23" y2="19" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="41" y1="15" x2="49" y2="15" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="41" y1="19" x2="46" y2="19" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="41" y1="23" x2="49" y2="23" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="19" cy="45" r="5" stroke="#00FF41" strokeWidth="2" fill="none"/>
    <path d="M41 45 L49 45 M41 41 L49 41 M41 49 L46 49" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

function sortSideEvents(events) {
  return [...events].sort((a, b) => {
    const ai = SIDE_EVENT_SLUG_ORDER.indexOf(a.slug)
    const bi = SIDE_EVENT_SLUG_ORDER.indexOf(b.slug)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

// ── Team Card ──────────────────────────────────────────────────────────────
function TeamCard({ team, players }) {
  const captainName = team.profiles
    ? `${team.profiles.first_name} ${team.profiles.last_name}`
    : '—'
  const teamState = team.profiles?.state ?? null

  return (
    <div className="bg-surface border border-line rounded-2xl overflow-hidden">
      <div className="p-6">
        <div className="flex items-start gap-4 mb-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center font-black text-black text-base flex-shrink-0 overflow-hidden"
            style={{ background: '#00FF41' }}
          >
            {team.logo_url
              ? <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain" />
              : initials(team.name)
            }
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-black text-lg leading-tight">{team.name}</h3>
            {teamState && (
              <span className="inline-block text-xs bg-brand/10 text-brand border border-brand/20 px-2 py-0.5 rounded-full font-bold mt-1.5">
                {teamState}
              </span>
            )}
          </div>
        </div>

        <p className="text-[#e5e5e5]/50 text-sm mb-4">
          <span className="text-[#e5e5e5]/30 text-xs font-bold uppercase tracking-wider">Captain </span>
          {captainName}
        </p>
      </div>

      {players.length > 0 && (
        <div className="border-t border-line px-6 py-4 space-y-1">
          <p className="text-[#e5e5e5]/30 text-xs font-bold uppercase tracking-wider mb-3">
            Roster · {players.length} Player{players.length !== 1 ? 's' : ''}
          </p>
          {players.map(p => {
            const name = p.profiles ? `${p.profiles.first_name} ${p.profiles.last_name}` : '—'
            const alias = p.profiles?.alias
            const state = p.profiles?.state
            const confirmed = p.status === 'confirmed'
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-line/50 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-semibold">{name}</span>
                    {alias && (
                      <span className="text-brand text-xs font-semibold">"{alias}"</span>
                    )}
                    {state && (
                      <span className="text-[10px] bg-brand/10 text-brand border border-brand/20 px-1.5 py-0.5 rounded-full font-bold">
                        {state}
                      </span>
                    )}
                  </div>
                </div>
                {confirmed && (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: '#00FF41' }}
                    title="Fully confirmed"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2 2 4-4" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Side Event Panel ────────────────────────────────────────────────────────
function SideEventPanel({ sideEvent, entries }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-line/20 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-white font-bold text-sm">{sideEvent.name}</h3>
          <span className="text-xs text-[#e5e5e5]/40 font-semibold bg-line/40 px-2 py-0.5 rounded-full">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-[#e5e5e5]/30 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-line px-5 py-4">
          {entries.length === 0 ? (
            <p className="text-[#e5e5e5]/30 text-sm">No entries yet</p>
          ) : (
            <div className="space-y-1">
              {entries.map(reg => {
                const name = reg.profiles
                  ? `${reg.profiles.first_name} ${reg.profiles.last_name}`
                  : '—'
                const alias = reg.profiles?.alias
                return (
                  <div key={reg.id} className="flex items-center justify-between gap-3 py-2 border-b border-line/50 last:border-0">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm font-semibold">{name}</span>
                        {alias && (
                          <span className="text-brand text-xs font-semibold">"{alias}"</span>
                        )}
                      </div>
                      <p className="text-[#e5e5e5]/35 text-xs mt-0.5">{reg.teamName ?? 'Independent'}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Registered Teams Section ────────────────────────────────────────────────
function RegisteredTeamsSection({ teams, regs }) {
  const regsByTeam = {}
  regs.forEach(r => {
    if (r.team_id) {
      if (!regsByTeam[r.team_id]) regsByTeam[r.team_id] = []
      regsByTeam[r.team_id].push(r)
    }
  })

  const teamsWithRegs = teams.filter(t => regsByTeam[t.id]?.length > 0)

  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Teams</p>
      <h2 className="text-3xl font-black text-white text-center mb-10">Registered Teams</h2>
      {teamsWithRegs.length === 0 ? (
        <p className="text-center text-[#e5e5e5]/40 text-sm">
          No teams registered yet — registrations open soon.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {teamsWithRegs.map(team => (
            <TeamCard
              key={team.id}
              team={team}
              players={regsByTeam[team.id] ?? []}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ── Doubles Entries Section ──────────────────────────────────────────────────
function DoublesEntriesSection({ pairs, profileMap }) {
  const confirmed = pairs.filter(p => p.confirmed)
  if (!confirmed.length && !pairs.length) return null

  function PlayerChip({ playerId }) {
    const p = profileMap[playerId]
    const name = p ? `${p.first_name} ${p.last_name}` : '—'
    const inits = p ? ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() : '?'
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-xs font-black flex-shrink-0">
          {inits}
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{name}</p>
          {p?.alias && <p className="text-brand text-xs">"{p.alias}"</p>}
        </div>
      </div>
    )
  }

  return (
    <section className="bg-surface border-t border-line">
      <div className="max-w-5xl mx-auto px-6 py-16">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Side Events</p>
        <h2 className="text-3xl font-black text-white text-center mb-2">Doubles Entries</h2>
        <p className="text-[#e5e5e5]/40 text-sm text-center mb-10">{confirmed.length} pair{confirmed.length !== 1 ? 's' : ''} entered</p>
        {confirmed.length === 0 ? (
          <p className="text-center text-[#e5e5e5]/40 text-sm">No doubles pairs registered yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {confirmed.map(pair => (
              <div key={pair.id} className="bg-base border border-line rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <PlayerChip playerId={pair.player1_id} />
                  <span className="text-brand font-black text-base flex-shrink-0">&amp;</span>
                  <PlayerChip playerId={pair.player2_id} />
                </div>
                <div className="flex justify-end">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-green-500/15 text-green-400 border-green-500/30">
                    Confirmed
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Triples Entries Section ──────────────────────────────────────────────────
function TriplesEntriesSection({ teams, profileMap }) {
  const confirmed = teams.filter(t => t.confirmed)
  if (!confirmed.length && !teams.length) return null

  function PlayerRow({ playerId }) {
    const p = profileMap[playerId]
    if (!playerId) return null
    const name = p ? `${p.first_name} ${p.last_name}` : '—'
    const inits = p ? ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() : '?'
    return (
      <div className="flex items-center gap-3 py-1.5">
        <div className="w-7 h-7 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-[10px] font-black flex-shrink-0">
          {inits}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold">{name}</p>
          {p?.alias && <p className="text-brand text-xs">"{p.alias}"</p>}
        </div>
      </div>
    )
  }

  return (
    <section className="bg-surface border-t border-line">
      <div className="max-w-5xl mx-auto px-6 py-16">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Side Events</p>
        <h2 className="text-3xl font-black text-white text-center mb-2">Triples Entries</h2>
        <p className="text-[#e5e5e5]/40 text-sm text-center mb-10">{confirmed.length} team{confirmed.length !== 1 ? 's' : ''} entered</p>
        {confirmed.length === 0 ? (
          <p className="text-center text-[#e5e5e5]/40 text-sm">No triples teams registered yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {confirmed.map(team => (
              <div key={team.id} className="bg-base border border-line rounded-2xl p-5">
                <div className="divide-y divide-line/50 mb-3">
                  <PlayerRow playerId={team.player1_id} />
                  <PlayerRow playerId={team.player2_id} />
                  <PlayerRow playerId={team.player3_id} />
                </div>
                <div className="flex justify-end">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-green-500/15 text-green-400 border-green-500/30">
                    Confirmed
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Side Event Entries Section ──────────────────────────────────────────────
function SideEventEntriesSection({ enabledSideEvents, regs, teams }) {
  const teamMap = Object.fromEntries(teams.map(t => [t.id, t.name]))
  const sorted = sortSideEvents(enabledSideEvents.filter(se => se.slug !== 'presentation-dinner'))

  // Attach teamName to each registration
  const regsWithTeam = regs.map(r => ({
    ...r,
    teamName: r.team_id ? (teamMap[r.team_id] ?? null) : null,
  }))

  return (
    <section className="bg-surface border-t border-line">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Entries</p>
        <h2 className="text-3xl font-black text-white text-center mb-10">Side Event Entries</h2>
        <div className="space-y-3">
          {sorted.map(se => {
            const entries = regsWithTeam.filter(r =>
              Array.isArray(r.side_events) && r.side_events.includes(se.slug)
            )
            return (
              <SideEventPanel key={se.slug} sideEvent={se} entries={entries} />
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function EventPage() {
  const { year } = useParams()
  const { user } = useAuth()
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [teams, setTeams] = useState([])
  const [regs, setRegs] = useState([])
  const [doublesPairs, setDoublesPairs] = useState([])
  const [triplesTeams, setTriplesTeams] = useState([])
  const [pairProfileMap, setPairProfileMap] = useState({})

  useEffect(() => {
    async function load() {
      const [{ data: ev }, profileResult] = await Promise.all([
        supabase
          .from('zltac_events')
          .select('*')
          .eq('year', parseInt(year))
          .maybeSingle(),
        user
          ? supabase.from('profiles').select('roles').eq('id', user.id).single()
          : Promise.resolve({ data: null }),
      ])
      setEvent(ev)
      setIsAdmin(isCommittee(profileResult?.data))

      // Load registration data for non-draft events
      if (ev && ev.status !== 'draft') {
        // Fetch teams and registrations without profile joins (RLS blocks other users' profiles)
        const [{ data: teamsData }, { data: regsData }] = await Promise.all([
          supabase
            .from('teams')
            .select('id, name, status, logo_url, captain_id')
            .eq('status', 'approved')
            .order('name'),
          supabase
            .from('zltac_registrations')
            .select('id, user_id, team_id, side_events, status')
            .eq('year', parseInt(year)),
        ])
        const rawTeams = teamsData ?? []
        const rawRegs = regsData ?? []

        // Collect all user IDs (players + captains) and fetch profiles via API
        const playerIds = rawRegs.map(r => r.user_id).filter(Boolean)
        const captainIds = rawTeams.map(t => t.captain_id).filter(Boolean)
        const allIds = [...new Set([...playerIds, ...captainIds])]

        let profileMap = {}
        if (allIds.length > 0) {
          const { profiles: profileData } = await apiFetch('/api/profiles', {
            method: 'POST',
            body: JSON.stringify({ ids: allIds }),
          })
          profileMap = Object.fromEntries((profileData ?? []).map(p => [p.id, p]))
        }

        setTeams(rawTeams.map(t => ({ ...t, profiles: profileMap[t.captain_id] ?? null })))
        setRegs(rawRegs.map(r => ({ ...r, profiles: profileMap[r.user_id] ?? null })))

        // Fetch confirmed doubles/triples for public display
        const { doubles: doublesData, triples: triplesData } = await apiFetch(`/api/event?year=${parseInt(year)}`)
        setDoublesPairs(doublesData ?? [])
        setTriplesTeams(triplesData ?? [])

        // Collect all pair/team player IDs and fetch any missing profiles
        const pairIds = new Set()
        ;(doublesData ?? []).forEach(d => { if (d.player1_id) pairIds.add(d.player1_id); if (d.player2_id) pairIds.add(d.player2_id) })
        ;(triplesData ?? []).forEach(t => { if (t.player1_id) pairIds.add(t.player1_id); if (t.player2_id) pairIds.add(t.player2_id); if (t.player3_id) pairIds.add(t.player3_id) })
        const missingIds = [...pairIds].filter(id => !profileMap[id])
        let fullPairMap = { ...profileMap }
        if (missingIds.length > 0) {
          const { profiles: extraProfs } = await apiFetch('/api/profiles', {
            method: 'POST',
            body: JSON.stringify({ ids: missingIds }),
          })
          ;(extraProfs ?? []).forEach(p => { fullPairMap[p.id] = p })
        }
        setPairProfileMap(fullPairMap)
      }

      setLoading(false)
    }
    load()
  }, [year, user])

  if (loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <p className="text-6xl mb-4">🎯</p>
        <h1 className="text-2xl font-black text-white mb-2">Event Not Found</h1>
        <p className="text-[#e5e5e5]/40 text-sm mb-6">No event found for {year}.</p>
        <Link to="/zltac" className="text-brand hover:text-brand-hover text-sm font-semibold transition-colors">
          ← Back to ZLTAC
        </Link>
      </div>
    )
  }

  const enabledSideEvents = (event.side_events ?? []).filter(se => se.enabled)
  const showRegistrationSections = event.status !== 'draft'

  // ── Archived view ──────────────────────────────────────────────────────────
  if (event.status === 'archived') {
    return (
      <div className="bg-base text-white">
        <section
          className="relative py-20 border-b border-line overflow-hidden"
          style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.04) 0%, transparent 60%), #0F0F0F' }}
        >
          <div className="relative text-center px-6">
            {event.logo_url
              ? <img src={event.logo_url} alt={event.name} className="h-16 mx-auto mb-5 object-contain opacity-70" />
              : <div className="text-4xl mb-4 opacity-50">🏆</div>
            }
            <span className="inline-block text-xs bg-[#2D2D2D] text-[#e5e5e5]/40 px-3 py-1 rounded-full font-bold uppercase tracking-widest mb-4">Archived</span>
            <h1 className="text-4xl md:text-5xl font-black text-white mb-4">{event.name}</h1>
            {event.location && (
              <p className="text-[#e5e5e5]/70 font-semibold mb-2" style={{ fontSize: '20px' }}>
                {event.location}
              </p>
            )}
            {(event.reg_open_date || event.reg_close_date) && (
              <p className="text-[#e5e5e5]/45" style={{ fontSize: '18px' }}>
                {event.reg_open_date && formatDate(event.reg_open_date)}
                {event.reg_open_date && event.reg_close_date && ' — '}
                {event.reg_close_date && formatDate(event.reg_close_date)}
              </p>
            )}
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-12">
          <div className="bg-surface border border-line rounded-xl p-6 text-center mb-8">
            <p className="text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-1">Champion</p>
            <p className="text-2xl font-black text-brand">TBC</p>
            <p className="text-xs text-[#e5e5e5]/30 mt-1">Results will be published here after the event</p>
          </div>
        </section>

        <RegisteredTeamsSection teams={teams} regs={regs} />
        {enabledSideEvents.length > 0 && (
          <SideEventEntriesSection enabledSideEvents={enabledSideEvents} regs={regs} teams={teams} />
        )}
        {(doublesPairs.length > 0 || triplesTeams.length > 0) && (
          <>
            <DoublesEntriesSection pairs={doublesPairs} profileMap={pairProfileMap} />
            <TriplesEntriesSection teams={triplesTeams} profileMap={pairProfileMap} />
          </>
        )}
        <Footer />
      </div>
    )
  }

  // ── Draft (non-admin): coming soon ─────────────────────────────────────────
  if (event.status === 'draft' && !isAdmin) {
    return (
      <div className="min-h-screen bg-base flex flex-col">
        <section
          className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24"
          style={{ background: 'radial-gradient(ellipse at 50% 60%, rgba(0,255,65,0.05) 0%, transparent 60%), #0F0F0F' }}
        >
          <div className="text-5xl mb-4">🚧</div>
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">{event.name}</p>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">Coming Soon</h1>
          <p className="text-[#e5e5e5]/40 text-base max-w-md mx-auto">
            Registration for {event.name} is not yet open. Check back soon.
          </p>
          {event.reg_open_date && (
            <p className="mt-4 text-sm text-brand/70">Opens {formatDate(event.reg_open_date)}</p>
          )}
          <Link to="/zltac" className="mt-8 text-sm text-[#e5e5e5]/40 hover:text-white transition-colors">
            ← Back to ZLTAC
          </Link>
        </section>
        <Footer />
      </div>
    )
  }

  // ── Open / Closed / Draft (admin) ──────────────────────────────────────────
  return (
    <div className="bg-base text-white">
      {/* Hero */}
      <section
        className="relative py-24 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.07) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        {isAdmin && event.status === 'draft' && (
          <div className="relative text-center mb-4">
            <span className="inline-block text-xs bg-yellow-400/10 text-yellow-400 border border-yellow-400/20 px-3 py-1 rounded-full font-bold uppercase tracking-wider">
              Draft — only visible to admins
            </span>
          </div>
        )}
        <div className="relative text-center px-6">
          {event.logo_url ? (
            <img src={event.logo_url} alt={event.name} className="h-20 mx-auto mb-6 object-contain" />
          ) : (
            <div className="text-5xl mb-4">🎯</div>
          )}
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">
            {event.status === 'open' ? 'Registration Open' : event.status === 'closed' ? 'Registration Closed' : event.status}
          </p>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-5">{event.name}</h1>
          {event.location && (
            <p className="text-white/80 font-semibold mb-3" style={{ fontSize: '20px' }}>
              📍 {event.location}
            </p>
          )}
          {(event.reg_open_date || event.reg_close_date) && (
            <p className="text-[#e5e5e5]/55 font-medium" style={{ fontSize: '18px' }}>
              {event.reg_open_date && `Registration opens ${formatDate(event.reg_open_date)}`}
              {event.reg_open_date && event.reg_close_date && ' · '}
              {event.reg_close_date && `closes ${formatDate(event.reg_close_date)}`}
            </p>
          )}
        </div>
      </section>

      {/* Description */}
      {event.description && (
        <section className="max-w-3xl mx-auto px-6 py-12 text-center">
          <p className="text-[#e5e5e5]/60 text-lg leading-relaxed">{event.description}</p>
        </section>
      )}

      {/* CTA cards (open events only) */}
      {event.status === 'open' && (() => {
        const isRegistered = user && regs.some(r => r.user_id === user.id)
        const cardStyle = {
          background: '#191919',
          border: '1px solid rgba(255,255,255,0.06)',
          borderTopColor: '#00FF41',
          borderTopWidth: '3px',
        }
        const onHoverEnter = e => {
          e.currentTarget.style.boxShadow = '0 0 24px rgba(0,255,65,0.2), inset 0 0 0 1px rgba(0,255,65,0.15)'
        }
        const onHoverLeave = e => {
          e.currentTarget.style.boxShadow = 'none'
        }
        return (
          <section className="max-w-5xl mx-auto px-6 pt-16 pb-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Captain */}
              <div
                className="rounded-2xl p-10 transition-all text-center flex flex-col"
                style={cardStyle}
                onMouseEnter={onHoverEnter}
                onMouseLeave={onHoverLeave}
              >
                <div className="mb-6 flex justify-center"><ShieldCrownIcon /></div>
                <h2 className="text-white font-black text-xl mb-4 leading-tight">Register as Captain</h2>
                <p className="text-[#a0a0a0] text-sm leading-relaxed flex-1 mb-8">
                  Create a team, generate invite codes, and lead your squad to victory.
                </p>
                <Link
                  to={`/events/${year}/captain-register`}
                  className="block w-full bg-brand hover:bg-brand-hover text-black font-bold py-3 px-4 rounded-xl text-sm text-center transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
                >
                  Register as Captain
                </Link>
              </div>

              {/* Player */}
              <div
                className="rounded-2xl p-10 transition-all text-center flex flex-col"
                style={cardStyle}
                onMouseEnter={onHoverEnter}
                onMouseLeave={onHoverLeave}
              >
                <div className="mb-6 flex justify-center"><PlayerPersonIcon /></div>
                <h2 className="text-white font-black text-xl mb-4 leading-tight">Register as Player</h2>
                <p className="text-[#a0a0a0] text-sm leading-relaxed flex-1 mb-8">
                  Join a team using your captain's invite code and pick your side events.
                </p>
                <Link
                  to={`/events/${year}/player-register`}
                  className="block w-full bg-brand hover:bg-brand-hover text-black font-bold py-3 px-4 rounded-xl text-sm text-center transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
                >
                  Register as Player
                </Link>
              </div>

              {/* Player Hub — only for logged-in registered players */}
              {isRegistered && (
                <div
                  className="rounded-2xl p-10 transition-all text-center flex flex-col"
                  style={cardStyle}
                  onMouseEnter={onHoverEnter}
                  onMouseLeave={onHoverLeave}
                >
                  <div className="mb-6 flex justify-center"><DashboardGridIcon /></div>
                  <h2 className="text-white font-black text-xl mb-4 leading-tight">Player Hub</h2>
                  <p className="text-[#a0a0a0] text-sm leading-relaxed flex-1 mb-8">
                    View your checklist, pay your fees and sign the Code of Conduct.
                  </p>
                  <Link
                    to={`/events/${year}/player-hub`}
                    className="block w-full bg-brand hover:bg-brand-hover text-black font-bold py-3 px-4 rounded-xl text-sm text-center transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
                  >
                    Go to Player Hub
                  </Link>
                </div>
              )}
            </div>
          </section>
        )
      })()}

      {/* Registered Teams */}
      {showRegistrationSections && (
        <>
          <div className="border-t border-line" />
          <RegisteredTeamsSection teams={teams} regs={regs} />
          {enabledSideEvents.length > 0 && (
            <SideEventEntriesSection enabledSideEvents={enabledSideEvents} regs={regs} teams={teams} />
          )}
          {(doublesPairs.length > 0 || triplesTeams.length > 0) && (
            <>
              <DoublesEntriesSection pairs={doublesPairs} profileMap={pairProfileMap} />
              <TriplesEntriesSection teams={triplesTeams} profileMap={pairProfileMap} />
            </>
          )}
        </>
      )}

      <Footer />
    </div>
  )
}
