import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import supabaseAdmin from '../../lib/supabaseAdmin'

const ALL_ROLES = ['player', 'captain', 'zltac_committee', 'alsa_committee', 'advisor', 'superadmin']
const ROLE_ORDER = ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor', 'captain', 'player']

const ROLE_META = {
  superadmin:      { label: 'Superadmin',      cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  alsa_committee:  { label: 'ALSA Committee',  cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  zltac_committee: { label: 'ZLTAC Committee', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  advisor:         { label: 'Advisor',         cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  captain:         { label: 'Captain',         cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  player:          { label: 'Player',          cls: 'bg-line text-[#e5e5e5]/50 border-transparent' },
}

const AVATAR_COLORS = {
  superadmin: 'bg-purple-500/20 text-purple-400',
  alsa_committee: 'bg-red-500/20 text-red-400',
  zltac_committee: 'bg-red-500/20 text-red-400',
  advisor: 'bg-blue-500/20 text-blue-400',
  captain: 'bg-yellow-500/20 text-yellow-400',
  player: 'bg-brand/20 text-brand',
}

function getRoles(u) { return u.roles?.length > 0 ? u.roles : [u.role || 'player'] }

function avatarColor(roles) {
  for (const r of ROLE_ORDER) {
    if (roles.includes(r) && r !== 'player') return AVATAR_COLORS[r]
  }
  return AVATAR_COLORS.player
}

function RolePills({ roles }) {
  const sorted = ROLE_ORDER.filter(r => roles.includes(r))
  return (
    <div className="flex flex-wrap gap-1">
      {sorted.map(r => {
        const m = ROLE_META[r] ?? ROLE_META.player
        return (
          <span key={r} className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${m.cls}`}>
            {m.label}
          </span>
        )
      })}
    </div>
  )
}

function Avatar({ profile }) {
  const roles = getRoles(profile)
  const initials = ((profile.first_name?.[0] ?? '') + (profile.last_name?.[0] ?? '')).toUpperCase() || '?'
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${avatarColor(roles)}`}>
      {initials}
    </div>
  )
}

export default function AdminUsers() {
  const { userRoles: adminRoles = [] } = useOutletContext()
  const isSuperAdmin = adminRoles.includes('superadmin')

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('all')
  const [filterState, setFilterState] = useState('all')
  const [selected, setSelected] = useState(null)
  const [selectedRegs, setSelectedRegs] = useState([])
  const [selectedPayments, setSelectedPayments] = useState([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editingRoles, setEditingRoles] = useState(false)
  const [draftRoles, setDraftRoles] = useState([])
  const [savingRoles, setSavingRoles] = useState(false)
  const [msg, setMsg] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const [{ data: profiles }, { data: regRows }, { data: teamRows }] = await Promise.all([
      supabaseAdmin.from('profiles')
        .select('id, first_name, last_name, alias, state, role, roles, suspended, created_at, home_arena')
        .order('created_at', { ascending: false }),
      supabaseAdmin.from('zltac_registrations').select('user_id, year'),
      supabaseAdmin.from('teams').select('id, name, captain_id'),
    ])

    const regMap = {}
    for (const r of (regRows ?? [])) {
      if (!regMap[r.user_id]) regMap[r.user_id] = []
      regMap[r.user_id].push(r)
    }
    const captainTeamMap = {}
    for (const t of (teamRows ?? [])) {
      if (t.captain_id) captainTeamMap[t.captain_id] = t.name
    }

    const merged = (profiles ?? []).map(p => ({
      ...p,
      _roles: getRoles(p),
      events_entered: regMap[p.id]?.length ?? 0,
      team_name: captainTeamMap[p.id] ?? null,
    }))

    setUsers(merged)
    setLoading(false)
  }

  async function openUser(u) {
    setSelected(u)
    setDraftRoles(u._roles)
    setEditingRoles(false)
    setMsg(null)
    setConfirmDelete(null)
    setLoadingDetail(true)
    const [{ data: regs }, { data: pays }] = await Promise.all([
      supabaseAdmin.from('zltac_registrations').select('*, teams(name)').eq('user_id', u.id).order('year', { ascending: false }),
      supabaseAdmin.from('payments').select('*').eq('user_id', u.id).order('created_at', { ascending: false }),
    ])
    setSelectedRegs(regs ?? [])
    setSelectedPayments(pays ?? [])
    setLoadingDetail(false)
  }

  async function saveRoles(userId) {
    // Always ensure 'player' is included
    const finalRoles = [...new Set(['player', ...draftRoles])]
    setSavingRoles(true)
    const { error } = await supabaseAdmin.from('profiles').update({ roles: finalRoles }).eq('id', userId)
    setSavingRoles(false)
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      const update = u => u.id === userId ? { ...u, roles: finalRoles, _roles: finalRoles } : u
      setUsers(us => us.map(update))
      setSelected(s => s ? { ...s, roles: finalRoles, _roles: finalRoles } : s)
      setDraftRoles(finalRoles)
      setEditingRoles(false)
      setMsg({ type: 'ok', text: 'Roles updated.' })
    }
  }

  async function toggleSuspend(userId, suspended) {
    await supabaseAdmin.from('profiles').update({ suspended: !suspended }).eq('id', userId)
    const update = u => u.id === userId ? { ...u, suspended: !suspended } : u
    setUsers(us => us.map(update))
    setSelected(s => s ? { ...s, suspended: !suspended } : s)
  }

  function canAssignRole(targetRole) {
    if (isSuperAdmin) return true
    return !['alsa_committee', 'zltac_committee', 'superadmin', 'advisor'].includes(targetRole)
  }

  const allStates = [...new Set(users.map(u => u.state).filter(Boolean))].sort()

  const filtered = users.filter(u => {
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''} ${u.alias ?? ''}`.toLowerCase()
    if (search && !name.includes(search.toLowerCase())) return false
    if (filterRole !== 'all') {
      if (filterRole === 'player') return true // everyone has player
      if (filterRole === 'committee') return u._roles.some(r => ['alsa_committee', 'zltac_committee'].includes(r))
      if (!u._roles.includes(filterRole)) return false
    }
    if (filterState !== 'all' && u.state !== filterState) return false
    return true
  })

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black text-white">Users</h1>
        <p className="text-[#e5e5e5]/40 text-sm mt-1">
          <span className="text-brand font-bold">{users.length}</span> members registered
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input type="text" placeholder="Search name or alias…" value={search} onChange={e => setSearch(e.target.value)}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand w-52" />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
          <option value="all">All roles</option>
          <option value="player">Player</option>
          <option value="captain">Captain</option>
          <option value="committee">Committee (any)</option>
          <option value="zltac_committee">ZLTAC Committee</option>
          <option value="alsa_committee">ALSA Committee</option>
          <option value="advisor">Advisor</option>
          <option value="superadmin">Superadmin</option>
        </select>
        <select value={filterState} onChange={e => setFilterState(e.target.value)}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
          <option value="all">All states</option>
          {allStates.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-xs text-[#e5e5e5]/40 self-center">{filtered.length} member{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-line">
                {['Name', 'State', 'Roles', 'Events', 'Team', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-[#e5e5e5]/30 text-sm">No users found</td></tr>
              ) : filtered.map(u => (
                <tr key={u.id} className={`border-b border-line last:border-0 hover:bg-line/20 transition-colors ${u.suspended ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar profile={u} />
                      <div>
                        <p className="font-semibold text-white text-sm leading-tight">
                          {u.first_name || u.last_name ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : 'Unknown'}
                          {u.suspended && <span className="ml-1.5 text-[10px] text-red-400">(suspended)</span>}
                        </p>
                        {u.alias && <p className="text-brand text-xs">"{u.alias}"</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#e5e5e5]/50 text-xs">{u.state ?? '—'}</td>
                  <td className="px-4 py-3"><RolePills roles={u._roles} /></td>
                  <td className="px-4 py-3 text-[#e5e5e5]/50 text-xs">{u.events_entered > 0 ? `${u.events_entered} event${u.events_entered !== 1 ? 's' : ''}` : '—'}</td>
                  <td className="px-4 py-3 text-[#e5e5e5]/50 text-xs">{u.team_name ?? '—'}</td>
                  <td className="px-4 py-3 text-[#e5e5e5]/40 text-xs">{u.created_at ? new Date(u.created_at).toLocaleDateString('en-AU') : '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openUser(u)} className="text-xs text-brand/70 hover:text-brand transition-colors font-semibold">
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User detail slide-in panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-end" onClick={() => { setSelected(null); setMsg(null) }}>
          <div className="w-full max-w-md bg-surface border-l border-line h-full overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-white">User Profile</h2>
              <button onClick={() => { setSelected(null); setMsg(null) }} className="text-[#e5e5e5]/40 hover:text-white text-xl leading-none">✕</button>
            </div>

            {/* Avatar + name */}
            <div className="flex items-center gap-4 mb-5">
              <Avatar profile={selected} />
              <div>
                <p className="text-white font-bold">
                  {selected.first_name || selected.last_name ? `${selected.first_name ?? ''} ${selected.last_name ?? ''}`.trim() : 'Unknown'}
                </p>
                {selected.alias && <p className="text-brand text-sm">"{selected.alias}"</p>}
                <p className="text-[#e5e5e5]/40 text-xs mt-0.5">
                  Joined {selected.created_at ? new Date(selected.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                </p>
              </div>
            </div>

            {/* Profile fields */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              {[['State', selected.state ?? '—'], ['Home Arena', selected.home_arena ?? '—']].map(([label, val]) => (
                <div key={label} className="bg-base border border-line rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-sm text-white">{val}</p>
                </div>
              ))}
            </div>

            {/* Role management */}
            <div className="bg-base border border-line rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider">Roles</p>
                {!editingRoles && (
                  <button onClick={() => { setEditingRoles(true); setDraftRoles(selected._roles); setMsg(null) }}
                    className="text-[10px] text-brand/70 hover:text-brand font-semibold transition-colors">
                    Change roles
                  </button>
                )}
              </div>

              {editingRoles ? (
                <div>
                  <div className="space-y-2 mb-4">
                    {ALL_ROLES.filter(r => r !== 'superadmin' || isSuperAdmin).map(r => {
                      const m = ROLE_META[r]
                      const isPlayer = r === 'player'
                      const checked = draftRoles.includes(r)
                      const disabled = isPlayer || !canAssignRole(r)
                      return (
                        <label key={r} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer ${checked ? 'border-brand/30 bg-brand/5' : 'border-line hover:border-[#374056]'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                          <input type="checkbox" checked={checked} disabled={disabled}
                            onChange={() => {
                              if (disabled) return
                              setDraftRoles(prev =>
                                prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]
                              )
                            }}
                            className="accent-brand w-3.5 h-3.5 flex-shrink-0"
                          />
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${m.cls}`}>{m.label}</span>
                          {isPlayer && <span className="text-[10px] text-[#e5e5e5]/30 ml-auto">always assigned</span>}
                        </label>
                      )
                    })}
                  </div>
                  {!isSuperAdmin && (
                    <p className="text-[10px] text-[#e5e5e5]/30 mb-3">Elevated roles require Superadmin access to assign.</p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => saveRoles(selected.id)} disabled={savingRoles}
                      className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black text-xs font-bold px-4 py-2 rounded-lg transition-all">
                      {savingRoles ? 'Saving…' : 'Save Roles'}
                    </button>
                    <button onClick={() => { setEditingRoles(false); setDraftRoles(selected._roles) }}
                      className="border border-line text-[#e5e5e5]/50 hover:text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <RolePills roles={selected._roles} />
              )}

              {msg && <p className={`text-xs mt-3 ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</p>}
            </div>

            {/* Suspend toggle */}
            <div className="bg-base border border-line rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Account Suspended</p>
                  <p className="text-xs text-[#e5e5e5]/40 mt-0.5">Prevents login and access</p>
                </div>
                <button onClick={() => toggleSuspend(selected.id, selected.suspended)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${selected.suspended ? 'bg-red-500' : 'bg-line'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${selected.suspended ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>

            {/* Registration history */}
            <div className="mb-4">
              <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-3">Registration History</p>
              {loadingDetail ? (
                <div className="h-12 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
              ) : selectedRegs.length === 0 ? (
                <p className="text-sm text-[#e5e5e5]/30">No registrations</p>
              ) : selectedRegs.map(r => (
                <div key={r.id} className="bg-base border border-line rounded-lg px-4 py-3 mb-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-sm text-white font-semibold">ZLTAC {r.year}</p>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${r.status === 'confirmed' ? 'bg-brand/10 text-brand border-brand/20' : 'bg-line text-[#e5e5e5]/40 border-transparent'}`}>
                      {r.status ?? 'pending'}
                    </span>
                  </div>
                  {r.teams?.name && <p className="text-xs text-[#e5e5e5]/40">{r.teams.name}</p>}
                  <p className="text-xs text-[#e5e5e5]/30 mt-0.5">{(r.side_events ?? []).join(', ') || 'Main event only'}</p>
                </div>
              ))}
            </div>

            {/* Payment history */}
            <div className="mb-4">
              <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-3">Payment History</p>
              {selectedPayments.length === 0 ? (
                <p className="text-sm text-[#e5e5e5]/30">No payments</p>
              ) : selectedPayments.map(p => (
                <div key={p.id} className="bg-base border border-line rounded-lg px-4 py-3 mb-2 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-white font-semibold">${((p.amount ?? 0) / 100).toFixed(2)}</p>
                    <p className="text-xs text-[#e5e5e5]/40">{p.created_at ? new Date(p.created_at).toLocaleDateString('en-AU') : ''}</p>
                  </div>
                  <span className={`text-xs font-bold uppercase ${p.status === 'paid' ? 'text-brand' : 'text-yellow-400'}`}>{p.status}</span>
                </div>
              ))}
            </div>

            {/* Danger zone — superadmin only */}
            {isSuperAdmin && (
              <div className="border border-red-500/20 rounded-xl p-4">
                <p className="text-[10px] text-red-400/60 font-bold uppercase tracking-wider mb-3">Danger Zone</p>
                {confirmDelete === selected.id ? (
                  <div>
                    <p className="text-xs text-[#e5e5e5]/60 mb-3">Are you sure? This cannot be undone.</p>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        await supabaseAdmin.from('profiles').delete().eq('id', selected.id)
                        setUsers(us => us.filter(u => u.id !== selected.id))
                        setSelected(null)
                        setConfirmDelete(null)
                      }} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">
                        Yes, Remove
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="border border-line text-[#e5e5e5]/50 text-xs font-semibold px-4 py-2 rounded-lg hover:text-white transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(selected.id)} className="text-xs text-red-400/60 hover:text-red-400 font-semibold transition-colors">
                    Remove from platform →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
