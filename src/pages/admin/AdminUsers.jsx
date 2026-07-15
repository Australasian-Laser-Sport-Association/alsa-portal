import { useState, useEffect, useCallback, memo, useId } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate } from '../../lib/dateFormat'
import { PRIVILEGED_ROLES, ROLE_ORDER } from '../../lib/roles'
import Dialog from '../../components/Dialog'

const ALL_ROLES = ['player', 'captain', 'zltac_committee', 'alsa_committee', 'advisor', 'superadmin']
const PAGE_SIZE = 50

const ROLE_META = {
  superadmin:      { label: 'Superadmin',      cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  alsa_committee:  { label: 'ALSA Committee',  cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  zltac_committee: { label: 'ZLTAC Committee', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  advisor:         { label: 'Advisor',         cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  captain:         { label: 'Captain',         cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  player:          { label: 'Player',          cls: 'bg-line text-[#e5e5e5]/60 border-transparent' },
}

// Friendly labels for the hard-delete impact preview, keyed by the table
// names the deletion-impact endpoint returns.
const IMPACT_LABELS = {
  zltac_registrations: 'ZLTAC registrations',
  competition_registrations: 'competition registrations',
  payments: 'payments',
  payment_records: 'payment ledger entries',
  legal_acceptances: 'signed legal acceptances',
  referee_test_results: 'rules test results',
  referee_test_attempts: 'rules test attempts',
  under_18_approvals: 'under-18 approvals',
  team_members: 'team memberships',
  competition_managers: 'competition manager assignments',
  alsa_memberships: 'ALSA memberships',
  alsa_lifetime_members: 'ALSA lifetime member records',
  side_event_roster_slots: 'side-event roster slots',
  teams_captained: 'team captain links',
  teams_managed: 'team manager links',
  doubles_player_1_slots: 'doubles player 1 slots',
  doubles_player_2_slots: 'doubles player 2 slots',
  triples_player_1_slots: 'triples player 1 slots',
  triples_player_2_slots: 'triples player 2 slots',
  triples_player_3_slots: 'triples player 3 slots',
  profiles_created: 'placeholder creator links',
  legal_documents_uploaded: 'legal document uploader links',
  under_18_decisions_reviewed: 'under-18 reviewer links',
  payment_records_recorded: 'payment recorder links',
  payment_history_changes: 'payment history actor links',
  profile_alias_changes: 'profile audit actor links',
  lifetime_memberships_granted: 'lifetime membership grant links',
  code_of_conduct_overrides_set: 'code of conduct override audit links',
  media_release_overrides_set: 'media release override audit links',
  referee_test_overrides_set: 'rules test override audit links',
  under_18_overrides_set: 'under-18 override audit links',
  alsa_memberships_created: 'membership creator audit links',
  competitions_created: 'competition creator audit links',
  competition_manager_grants: 'competition manager grant audit links',
  team_invitations_sent: 'team invitation audit links',
}

function impactEntries(impact, category) {
  return Object.entries(impact?.[category] ?? {}).filter(([, count]) => count > 0)
}

const AVATAR_COLORS = {
  superadmin: 'bg-purple-500/20 text-purple-400',
  alsa_committee: 'bg-red-500/20 text-red-400',
  zltac_committee: 'bg-red-500/20 text-red-400',
  advisor: 'bg-blue-500/20 text-blue-400',
  captain: 'bg-yellow-500/20 text-yellow-400',
  player: 'bg-brand/20 text-brand',
}

function getRoles(u) { return u.roles?.length > 0 ? u.roles : ['player'] }

// Display-only roles: persisted roles plus a derived 'captain' when the user
// captains at least one team (u._isCaptain, from teams.captain_id - the source
// of truth). Captain is NOT persisted into profiles.roles, so this stays
// separate from `_roles`, which remains the role editor's source of truth.
// Recomputed from `_roles` each render, so a role save (which updates `_roles`)
// stays consistent without writing the derived value anywhere.
function displayRoles(u) {
  return u._isCaptain && !u._roles.includes('captain')
    ? [...u._roles, 'captain']
    : u._roles
}

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

// Memoised so a search keystroke (which re-renders the parent) doesn't
// re-render every row - only rows whose `u` reference changed. `onView` is a
// stable useCallback in the parent, so the inline arrow here lives inside the
// memo boundary rather than defeating it from the call site.
const UserRow = memo(function UserRow({ u, onView }) {
  return (
    <tr className={`border-b border-line last:border-0 hover:bg-line/20 transition-colors ${u.suspended ? 'opacity-40' : ''}`}>
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
      <td className="px-4 py-3 text-[#e5e5e5]/60 text-xs">{u.state ?? '-'}</td>
      <td className="px-4 py-3"><RolePills roles={displayRoles(u)} /></td>
      <td className="px-4 py-3 text-[#e5e5e5]/60 text-xs">{u.events_entered > 0 ? `${u.events_entered} event${u.events_entered !== 1 ? 's' : ''}` : '-'}</td>
      <td className="px-4 py-3 text-[#e5e5e5]/60 text-xs">{u.team_name ?? '-'}</td>
      <td className="px-4 py-3 text-[#e5e5e5]/60 text-xs">{formatDate(u.created_at, 'numeric') || '-'}</td>
      <td className="px-4 py-3">
        <button onClick={() => onView(u)} className="text-xs text-brand/70 hover:text-brand transition-colors font-semibold">
          View
        </button>
      </td>
    </tr>
  )
})

export default function AdminUsers() {
  const { userRoles: adminRoles = [] } = useOutletContext()
  const isSuperAdmin = adminRoles.includes('superadmin')
  const uid = useId()

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('all')
  const [filterState, setFilterState] = useState('all')
  const [page, setPage] = useState(1)
  const [totalUsers, setTotalUsers] = useState(0)
  const [stateOptions, setStateOptions] = useState([])
  const [selected, setSelected] = useState(null)
  const [selectedRegs, setSelectedRegs] = useState([])
  const [selectedPayments, setSelectedPayments] = useState([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editingRoles, setEditingRoles] = useState(false)
  const [draftRoles, setDraftRoles] = useState([])
  const [draftAlsaPosition, setDraftAlsaPosition] = useState('')
  const [savingRoles, setSavingRoles] = useState(false)
  const [editingAlias, setEditingAlias] = useState(false)
  const [draftAlias, setDraftAlias] = useState('')
  const [aliasChangeReason, setAliasChangeReason] = useState('')
  const [savingAlias, setSavingAlias] = useState(false)
  const [aliasMsg, setAliasMsg] = useState(null)
  const [msg, setMsg] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [confirmHardDelete, setConfirmHardDelete] = useState(null)
  const [deleteImpact, setDeleteImpact] = useState(null) // null = not fetched yet
  const [deleting, setDeleting] = useState(false)
  const [suspendingUserId, setSuspendingUserId] = useState(null)
  const [deleteErr, setDeleteErr] = useState(null)
  const [error, setError] = useState(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        search,
        role: filterRole,
        state: filterState,
      })
      const { profiles, registrations, teams, total, states } = await apiFetch(`/api/admin/users?${params}`)

      const regMap = {}
      for (const r of (registrations ?? [])) {
        if (!regMap[r.user_id]) regMap[r.user_id] = []
        regMap[r.user_id].push(r)
      }
      // captainTeamMap ? the single team name shown in the Team column (an
      // existing limitation when a user captains several). captainIds ? derived
      // captaincy across ALL teams/events for the CAPTAIN pill + filter, so a
      // user who captains any team in any competition is caught.
      const captainTeamMap = {}
      const captainIds = new Set()
      for (const t of (teams ?? [])) {
        if (t.captain_id) {
          captainTeamMap[t.captain_id] = t.name
          captainIds.add(t.captain_id)
        }
      }

      const merged = (profiles ?? []).map(p => ({
        ...p,
        _roles: getRoles(p),
        _isCaptain: captainIds.has(p.id),
        events_entered: regMap[p.id]?.length ?? 0,
        team_name: captainTeamMap[p.id] ?? null,
      }))

      setUsers(merged)
      setTotalUsers(total ?? merged.length)
      setStateOptions(states ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterRole, filterState, page, search])

  useEffect(() => {
    const timer = setTimeout(() => { loadUsers() }, search.trim() ? 250 : 0)
    return () => clearTimeout(timer)
  }, [loadUsers, search])

  const openUser = useCallback(async (u) => {
    setSelected(u)
    setDraftRoles(u._roles)
    setDraftAlsaPosition(u.alsa_position ?? '')
    setEditingRoles(false)
    setEditingAlias(false)
    setDraftAlias(u.alias ?? '')
    setAliasChangeReason('')
    setAliasMsg(null)
    setMsg(null)
    setConfirmDelete(null)
    setConfirmRemove(null)
    setConfirmHardDelete(null)
    setDeleteImpact(null)
    setDeleteErr(null)
    setLoadingDetail(true)
    const { registrations: regs, payments: pays } = await apiFetch(`/api/admin/users?id=${u.id}`)
    setSelectedRegs(regs ?? [])
    setSelectedPayments(pays ?? [])
    setLoadingDetail(false)
  }, [])

  async function saveRoles(userId) {
    const finalRoles = [...new Set(['player', ...draftRoles])]
    // Clear alsa_position if alsa_committee is being removed; otherwise send trimmed value.
    const finalPosition = finalRoles.includes('alsa_committee')
      ? (draftAlsaPosition.trim() || null)
      : null
    setSavingRoles(true)
    try {
      await apiFetch(`/api/admin/users?id=${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ roles: finalRoles, alsa_position: finalPosition ?? '' }),
      })
      const update = u => u.id === userId
        ? { ...u, roles: finalRoles, _roles: finalRoles, alsa_position: finalPosition }
        : u
      setUsers(us => us.map(update))
      setSelected(s => s ? { ...s, roles: finalRoles, _roles: finalRoles, alsa_position: finalPosition } : s)
      setDraftRoles(finalRoles)
      setDraftAlsaPosition(finalPosition ?? '')
      setEditingRoles(false)
      setMsg({ type: 'ok', text: 'Roles updated.' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSavingRoles(false)
    }
  }

  async function saveAlias(userId) {
    const trimmed = draftAlias.trim()
    if (trimmed.length > 30) {
      setAliasMsg({ type: 'error', text: 'Alias must be 30 characters or fewer.' })
      return
    }
    const nextAlias = trimmed || null
    if (nextAlias === (selected?.alias?.trim() || null)) {
      setEditingAlias(false)
      setAliasMsg(null)
      return
    }
    if (aliasChangeReason.trim().length < 5) {
      setAliasMsg({ type: 'error', text: 'Alias change reason must be at least 5 characters.' })
      return
    }
    setSavingAlias(true)
    try {
      await apiFetch(`/api/admin/users?id=${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ alias: nextAlias, alias_change_reason: aliasChangeReason.trim() }),
      })
      const update = u => u.id === userId ? { ...u, alias: nextAlias } : u
      setUsers(us => us.map(update))
      setSelected(s => s ? { ...s, alias: nextAlias } : s)
      setDraftAlias(nextAlias ?? '')
      setAliasChangeReason('')
      setEditingAlias(false)
      setAliasMsg({ type: 'ok', text: 'Alias updated.' })
    } catch (err) {
      setAliasMsg({ type: 'error', text: err.message })
    } finally {
      setSavingAlias(false)
    }
  }

  // Hard-delete flow: open the confirm and fetch the impact preview. The
  // confirm button stays disabled until the preview has loaded, so the
  // superadmin sees what is deleted, retained, detached, or blocked first.
  async function startHardDelete(u) {
    setConfirmHardDelete(u.id)
    setConfirmDelete(null)
    setConfirmRemove(null)
    setDeleteImpact(null)
    setDeleteErr(null)
    try {
      const impact = await apiFetch(`/api/admin/users?id=${u.id}&action=deletion-impact`)
      setDeleteImpact(impact)
    } catch (err) {
      setDeleteErr(err.message)
    }
  }

  async function hardDelete(userId) {
    setDeleting(true)
    setDeleteErr(null)
    try {
      await apiFetch(`/api/admin/users?id=${userId}`, { method: 'DELETE' })
      setSelected(null)
      setConfirmHardDelete(null)
      setDeleteImpact(null)
      await loadUsers()
    } catch (err) {
      // Includes the 409 steering message when committee audit records block
      // the delete.
      setDeleteErr(err.message)
    } finally {
      setDeleting(false)
    }
  }

  async function toggleSuspend(userId, suspended) {
    setSuspendingUserId(userId)
    setMsg(null)
    try {
      await apiFetch(`/api/admin/users?id=${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ suspended: !suspended }),
      })
      const update = u => u.id === userId ? { ...u, suspended: !suspended } : u
      setUsers(us => us.map(update))
      setSelected(s => s ? { ...s, suspended: !suspended } : s)
      setMsg({ type: 'ok', text: suspended ? 'Account unsuspended.' : 'Account suspended.' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSuspendingUserId(null)
    }
  }

  function canAssignRole(targetRole) {
    if (isSuperAdmin) return true
    return !PRIVILEGED_ROLES.includes(targetRole)
  }

  const filtered = users
  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE))
  const pageStart = totalUsers === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(totalUsers, page * PAGE_SIZE)

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black text-white">Users</h1>
        <p className="text-[#e5e5e5]/60 text-sm mt-1">
          <span className="text-brand font-bold">{totalUsers}</span> members registered
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input type="text" placeholder="Search name or alias" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand w-52" />
        <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1) }}
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
        <select value={filterState} onChange={e => { setFilterState(e.target.value); setPage(1) }}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
          <option value="all">All states</option>
          {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-xs text-[#e5e5e5]/60 self-center">{pageStart}-{pageEnd} of {totalUsers}</span>
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
        <div className="bg-surface border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-line">
                {['Name', 'State', 'Roles', 'Events', 'Team', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-[#e5e5e5]/60 text-sm">No users found</td></tr>
              ) : filtered.map(u => (
                <UserRow key={u.id} u={u} onView={openUser} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && totalUsers > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-3 mt-4">
          <span className="text-xs text-[#e5e5e5]/60">Page {page} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="min-w-20 text-xs border border-line text-[#e5e5e5]/70 hover:text-white disabled:opacity-40 disabled:hover:text-[#e5e5e5]/70 px-3 py-1.5 rounded-lg"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="min-w-20 text-xs border border-line text-[#e5e5e5]/70 hover:text-white disabled:opacity-40 disabled:hover:text-[#e5e5e5]/70 px-3 py-1.5 rounded-lg"
          >
            Next
          </button>
        </div>
      )}

      {/* User detail slide-in panel */}
      {selected && (
        <Dialog open onClose={() => { setSelected(null); setMsg(null) }} variant="drawer" closeOnBackdrop className="p-6">
            <div className="flex items-center justify-between mb-5">
              <Dialog.Title className="text-lg font-black text-white">User Profile</Dialog.Title>
              <button onClick={() => { setSelected(null); setMsg(null) }} aria-label="Close" className="text-[#e5e5e5]/60 hover:text-white text-xl leading-none">?</button>
            </div>

            {/* Avatar + name */}
            <div className="flex items-center gap-4 mb-5">
              <Avatar profile={selected} />
              <div>
                <p className="text-white font-bold">
                  {selected.first_name || selected.last_name ? `${selected.first_name ?? ''} ${selected.last_name ?? ''}`.trim() : 'Unknown'}
                </p>
                {selected.alias && <p className="text-brand text-sm">"{selected.alias}"</p>}
                <p className="text-[#e5e5e5]/60 text-xs mt-0.5">
                  Joined {formatDate(selected.created_at) || '-'}
                </p>
              </div>
            </div>

            {/* Profile fields */}
            <div className="grid grid-cols-2 gap-2 mb-5">
              {[['State', selected.state ?? '-'], ['Home Arena', selected.home_arena ?? '-']].map(([label, val]) => (
                <div key={label} className="bg-base border border-line rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-sm text-white">{val}</p>
                </div>
              ))}
            </div>

            {/* Alias (in-game name) - committee-editable identity field */}
            <div className="bg-base border border-line rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider">Alias</p>
                {!editingAlias && (
                  <button onClick={() => { setEditingAlias(true); setDraftAlias(selected.alias ?? ''); setAliasChangeReason(''); setAliasMsg(null) }}
                    className="text-[10px] text-brand/70 hover:text-brand font-semibold transition-colors">
                    Edit alias
                  </button>
                )}
              </div>

              {editingAlias ? (
                <div>
                  <input
                    type="text"
                    value={draftAlias}
                    onChange={e => setDraftAlias(e.target.value)}
                    placeholder="e.g. DarkShot"
                    maxLength={30}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white opacity-100 placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors mb-1.5"
                  />
                  <p className="text-[10px] text-white/60 mb-3">Leave blank to clear. Max 30 characters.</p>
                  {(draftAlias.trim() || null) !== (selected.alias?.trim() || null) && (
                    <>
                      <label htmlFor="alias-change-reason" className="block text-[10px] text-white/60 font-bold uppercase tracking-wider mb-1.5">
                        Change reason
                      </label>
                      <textarea
                        id="alias-change-reason"
                        rows={2}
                        value={aliasChangeReason}
                        onChange={e => setAliasChangeReason(e.target.value)}
                        placeholder="Why is this identity change required?"
                        className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand resize-none mb-3"
                      />
                    </>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => saveAlias(selected.id)} disabled={savingAlias}
                      className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black text-xs font-bold px-4 py-2 rounded-lg transition-all">
                      {savingAlias ? 'Saving...' : 'Save Alias'}
                    </button>
                    <button onClick={() => { setEditingAlias(false); setDraftAlias(selected.alias ?? ''); setAliasChangeReason(''); setAliasMsg(null) }}
                      className="border border-line text-white/60 hover:text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                selected.alias
                  ? <p className="text-sm text-brand opacity-100">"{selected.alias}"</p>
                  : <p className="text-sm text-white/60">No alias set</p>
              )}

              {aliasMsg && <p className={`text-xs mt-3 ${aliasMsg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{aliasMsg.text}</p>}
            </div>

            {/* Role management */}
            <div className="bg-base border border-line rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider">Roles</p>
                {!editingRoles && (
                  <button onClick={() => { setEditingRoles(true); setDraftRoles(selected._roles); setDraftAlsaPosition(selected.alsa_position ?? ''); setMsg(null) }}
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
                          {isPlayer && <span className="text-[10px] text-[#e5e5e5]/60 ml-auto">always assigned</span>}
                        </label>
                      )
                    })}
                  </div>
                  {!isSuperAdmin && (
                    <p className="text-[10px] text-[#e5e5e5]/60 mb-3">Elevated roles require Superadmin access to assign.</p>
                  )}

                  {/* ALSA position - only meaningful when alsa_committee is selected */}
                  <div className="mb-4 pt-3 border-t border-line">
                    <label htmlFor={`${uid}-alsa-position`} className="block text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">
                      ALSA Position
                      {!draftRoles.includes('alsa_committee') && (
                        <span className="ml-1 text-[#e5e5e5]/60 normal-case font-normal">(requires ALSA Committee role)</span>
                      )}
                    </label>
                    <input
                      id={`${uid}-alsa-position`}
                      type="text"
                      value={draftAlsaPosition}
                      onChange={e => setDraftAlsaPosition(e.target.value)}
                      disabled={!draftRoles.includes('alsa_committee')}
                      placeholder="e.g. President, Secretary, Treasurer"
                      maxLength={80}
                      className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => saveRoles(selected.id)} disabled={savingRoles}
                      className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black text-xs font-bold px-4 py-2 rounded-lg transition-all">
                      {savingRoles ? 'Saving...' : 'Save Roles'}
                    </button>
                    <button onClick={() => { setEditingRoles(false); setDraftRoles(selected._roles); setDraftAlsaPosition(selected.alsa_position ?? '') }}
                      className="border border-line text-[#e5e5e5]/60 hover:text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <RolePills roles={displayRoles(selected)} />
              )}

              {msg && <p className={`text-xs mt-3 ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</p>}
            </div>

            {/* Suspend toggle */}
            <div className="bg-base border border-line rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Account Suspended</p>
                  <p className="text-xs text-[#e5e5e5]/60 mt-0.5">Prevents login and access</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSuspend(selected.id, selected.suspended)}
                  disabled={suspendingUserId === selected.id}
                  aria-label={selected.suspended ? 'Unsuspend account' : 'Suspend account'}
                  className={`w-10 h-5 rounded-full transition-colors relative disabled:opacity-50 ${selected.suspended ? 'bg-red-500' : 'bg-line'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${selected.suspended ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>

            {/* Registration history */}
            <div className="mb-4">
              <p className="text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-3">Registration History</p>
              {loadingDetail ? (
                <div className="h-12 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
              ) : selectedRegs.length === 0 ? (
                <p className="text-sm text-[#e5e5e5]/60">No registrations</p>
              ) : selectedRegs.map(r => (
                <div key={r.id} className="bg-base border border-line rounded-lg px-4 py-3 mb-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-sm text-white font-semibold">ZLTAC {r.year}</p>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${r.status === 'confirmed' ? 'bg-brand/10 text-brand border-brand/20' : 'bg-line text-[#e5e5e5]/60 border-transparent'}`}>
                      {r.status ?? 'pending'}
                    </span>
                  </div>
                  {r.teams?.name && <p className="text-xs text-[#e5e5e5]/60">{r.teams.name}</p>}
                  <p className="text-xs text-[#e5e5e5]/60 mt-0.5">{(r.side_events ?? []).join(', ') || 'Main event only'}</p>
                </div>
              ))}
            </div>

            {/* Payment history */}
            <div className="mb-4">
              <p className="text-[10px] text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-3">Payment History</p>
              {selectedPayments.length === 0 ? (
                <p className="text-sm text-[#e5e5e5]/60">No payments</p>
              ) : selectedPayments.map(p => (
                <div key={p.id} className="bg-base border border-line rounded-lg px-4 py-3 mb-2 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-white font-semibold">${((p.amount ?? 0) / 100).toFixed(2)}</p>
                    <p className="text-xs text-[#e5e5e5]/60">{formatDate(p.created_at, 'numeric')}</p>
                  </div>
                  <span className={`text-xs font-bold uppercase ${p.status === 'paid' ? 'text-brand' : 'text-yellow-400'}`}>{p.status}</span>
                </div>
              ))}
            </div>

            {/* Danger zone - superadmin only */}
            {isSuperAdmin && (
              <div className="border border-red-500/20 rounded-xl p-4">
                <p className="text-[10px] text-red-400/60 font-bold uppercase tracking-wider mb-3">Danger Zone</p>
                {confirmDelete === selected.id ? (
                  <div>
                    <p className="text-xs text-[#e5e5e5]/80 mb-2">
                      Reset profile data for{' '}
                      <span className="font-semibold text-white">
                        {[selected.first_name, selected.last_name].filter(Boolean).join(' ') || 'this user'}
                      </span>?
                    </p>
                    <p className="text-[11px] text-[#e5e5e5]/60 leading-relaxed mb-3">
                      This clears their profile fields and resets their role to player. Their login account remains active. To permanently remove the account, use Delete account (coming soon).
                    </p>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        await apiFetch(`/api/admin/users?id=${selected.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ action: 'reset' }),
                        })
                        setSelected(null)
                        setConfirmDelete(null)
                        await loadUsers()
                      }} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">
                        Yes, Reset
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="border border-line text-[#e5e5e5]/60 text-xs font-semibold px-4 py-2 rounded-lg hover:text-white transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setConfirmDelete(selected.id); setConfirmRemove(null); setConfirmHardDelete(null) }} className="text-xs text-red-400/60 hover:text-red-400 font-semibold transition-colors">
                    Reset member data
                  </button>
                )}

                {/* Remove access - anonymise + revoke login, keep records */}
                <div className="border-t border-red-500/10 mt-3 pt-3">
                  {confirmRemove === selected.id ? (
                    <div>
                      <p className="text-xs text-[#e5e5e5]/80 mb-2">
                        Remove access for{' '}
                        <span className="font-semibold text-white">
                          {[selected.first_name, selected.last_name].filter(Boolean).join(' ') || 'this user'}
                        </span>?
                      </p>
                      <p className="text-[11px] text-[#e5e5e5]/60 leading-relaxed mb-3">
                        This blanks their personal info, resets their role to player, and disables their login so they can no longer sign in. Their registrations, signed forms, and payment records are kept.
                      </p>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          try {
                            await apiFetch(`/api/admin/users?id=${selected.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ action: 'remove-access' }),
                            })
                            setSelected(null)
                            setConfirmRemove(null)
                            await loadUsers()
                          } catch (err) {
                            setMsg({ type: 'error', text: err.message })
                            setConfirmRemove(null)
                          }
                        }} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">
                          Yes, Remove Access
                        </button>
                        <button onClick={() => setConfirmRemove(null)} className="border border-line text-[#e5e5e5]/60 text-xs font-semibold px-4 py-2 rounded-lg hover:text-white transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setConfirmRemove(selected.id); setConfirmDelete(null); setConfirmHardDelete(null) }} className="text-xs text-red-400/60 hover:text-red-400 font-semibold transition-colors">
                      Remove access
                    </button>
                  )}
                </div>

                {/* Delete permanently - hard delete with impact preview */}
                <div className="border-t border-red-500/10 mt-3 pt-3">
                  {confirmHardDelete === selected.id ? (
                    <div>
                      <p className="text-xs text-[#e5e5e5]/80 mb-2">
                        Permanently delete{' '}
                        <span className="font-semibold text-white">
                          {[selected.first_name, selected.last_name].filter(Boolean).join(' ') || 'this user'}
                        </span>?
                      </p>
                      {deleteImpact === null && !deleteErr ? (
                        <p className="text-[11px] text-[#e5e5e5]/60 mb-3">Checking linked records...</p>
                      ) : deleteImpact && (
                        <div className="mb-3 space-y-2.5">
                          <p className="text-[11px] text-[#e5e5e5]/60 leading-relaxed">
                            This cannot be undone. The account is permanently deleted, with linked data handled as follows.
                          </p>

                          {deleteImpact.totals.deleted === 0
                            && deleteImpact.totals.retained_anonymized === 0
                            && deleteImpact.totals.detached === 0
                            && deleteImpact.totals.blockers === 0 && (
                            <p className="text-[11px] text-[#e5e5e5]/80">No linked records, only the account itself.</p>
                          )}

                          {impactEntries(deleteImpact, 'deleted').length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold text-red-300 mb-1">Permanently deleted</p>
                              <ul className="text-[11px] text-[#e5e5e5]/80 list-disc pl-4 space-y-0.5">
                                {impactEntries(deleteImpact, 'deleted').map(([key, count]) => (
                                  <li key={key}>{count} {IMPACT_LABELS[key] ?? key}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {impactEntries(deleteImpact, 'retained_anonymized').length > 0 && (
                            <div className="rounded-lg border border-brand/20 bg-brand/5 p-2">
                              <p className="text-[11px] font-semibold text-brand mb-1">Retained and anonymised</p>
                              <ul className="text-[11px] text-[#e5e5e5]/80 list-disc pl-4 space-y-0.5">
                                {impactEntries(deleteImpact, 'retained_anonymized').map(([key, count]) => (
                                  <li key={key}>{count} {IMPACT_LABELS[key] ?? key}</li>
                                ))}
                              </ul>
                              <p className="text-[10px] text-[#e5e5e5]/55 leading-relaxed mt-1.5">
                                Account links, IP addresses, user agents, and under-18 notes are removed. An opaque evidence token remains pending an approved retention schedule.
                              </p>
                            </div>
                          )}

                          {impactEntries(deleteImpact, 'detached').length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold text-[#e5e5e5]/70 mb-1">Links removed from surviving records</p>
                              <ul className="text-[11px] text-[#e5e5e5]/70 list-disc pl-4 space-y-0.5">
                                {impactEntries(deleteImpact, 'detached').map(([key, count]) => (
                                  <li key={key}>{count} {IMPACT_LABELS[key] ?? key}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {impactEntries(deleteImpact, 'blockers').length > 0 && (
                            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-2">
                              <p className="text-[11px] font-semibold text-red-300 mb-1">Deletion blocked by audit records</p>
                              <ul className="text-[11px] text-red-200/80 list-disc pl-4 space-y-0.5">
                                {impactEntries(deleteImpact, 'blockers').map(([key, count]) => (
                                  <li key={key}>{count} {IMPACT_LABELS[key] ?? key}</li>
                                ))}
                              </ul>
                              <p className="text-[10px] text-red-200/65 leading-relaxed mt-1.5">
                                Use Remove access instead. Audit attribution must not be silently erased.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      {deleteErr && <p className="text-[11px] text-red-400 leading-relaxed mb-3">{deleteErr}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => hardDelete(selected.id)}
                          disabled={deleting || !deleteImpact || !deleteImpact.can_delete}
                          className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                        >
                          {deleting ? 'Deleting...' : 'Yes, Delete Permanently'}
                        </button>
                        <button
                          onClick={() => { setConfirmHardDelete(null); setDeleteImpact(null); setDeleteErr(null) }}
                          className="border border-line text-[#e5e5e5]/60 text-xs font-semibold px-4 py-2 rounded-lg hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => startHardDelete(selected)} className="text-xs text-red-400 hover:text-red-300 font-semibold transition-colors">
                      Delete permanently
                    </button>
                  )}
                </div>
              </div>
            )}
        </Dialog>
      )}
    </div>
  )
}
