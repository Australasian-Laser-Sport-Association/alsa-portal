import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { eventPhase, COMMITTEE_EMAIL } from '../lib/eventPhase'
import Footer from '../components/Footer'
import Dialog from '../components/Dialog'
import CommitteeBadge from '../components/CommitteeBadge'
import LockedRegistrationBanner from '../components/LockedRegistrationBanner'
import LockedNotice from '../components/LockedNotice'
import { TeamShieldIcon } from '../components/icons.jsx'
import { storageImageUrl } from '../lib/assetUrl'
import { RASTER_IMAGE_TYPES, extensionForMime } from '../lib/uploadPolicy'
import { TEAM_COLOURS } from '../lib/teamColours'
import { registrationDateOfBirth } from '../lib/dateOfBirth.js'
import { buildCsv, downloadCsv } from '../lib/csv.js'

function initials(name = '') { return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?' }

function Tick({ ok }) {
  return (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black ${ok ? 'text-black' : 'text-red-400 border border-red-400/40 bg-red-400/10'}`}
      style={ok ? { background: '#00FF41' } : {}}>
      {ok ? '✓' : '✗'}
    </div>
  )
}

// Canonical status helpers. The server owns all readiness calculations; this
// page only maps the returned vocabulary to presentation states.
function checkDone(check) {
  return check?.status === 'satisfied' || check?.status === 'not_required'
}

function checkChipState(check) {
  if (check?.status === 'not_required') return 'na'
  if (check?.status === 'satisfied') return 'complete'
  if (check?.status === 'pending_review') return 'pending'
  return 'incomplete'
}

function readinessTitle(label, check) {
  if (!check) return `${label}: readiness unavailable`
  if (check.source === 'committee_override') {
    const parts = ['committee override']
    if (check.detail?.setAt) {
      parts.push(new Date(check.detail.setAt).toLocaleDateString('en-AU'))
    }
    if (check.detail?.reason) parts.push(`Reason: ${check.detail.reason}`)
    return `${label}: ${parts.join('. ')}`
  }
  const states = {
    not_required: 'not required',
    satisfied: 'complete',
    pending_review: 'submitted and awaiting committee review',
    rejected: 'rejected',
    action_required: 'action required',
  }
  return `${label}: ${states[check.status] ?? 'unavailable'}`
}

function paymentStatus(check) {
  if (check?.status === 'not_required') return 'na'
  if (check?.status === 'satisfied') {
    return (check.detail?.balanceCents ?? 0) < 0 ? 'overpaid' : 'paid'
  }
  return check?.source === 'partially_paid' ? 'partial' : 'unpaid'
}

// ── Status chips ────────────────────────────────────────────────────────────
// Generic readiness chip used for CoC, Rules, Media, Side Events, and Extras.
function StatusChip({ state, label, title }) {
  // state: 'complete' | 'pending' | 'incomplete' | 'na'
  const meta = state === 'complete'
    ? { cls: 'bg-brand/10 text-brand border-brand/30', icon: '✓' }
    : state === 'pending'
      ? { cls: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30', icon: '…' }
    : state === 'na'
      ? { cls: 'bg-line/40 text-[#e5e5e5]/60 border-line', icon: '—' }
      : { cls: 'bg-red-500/10 text-red-400 border-red-500/30', icon: '✗' }
  return (
    <span
      title={title ?? label}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${meta.cls}`}
    >
      <span aria-hidden>{meta.icon}</span>
      <span>{label}</span>
    </span>
  )
}

// PaymentChip — takes a status string. Helper above is the only place that
// inspects amount_owing. Add new states ('partial' etc.) by extending both.
const PAYMENT_META = {
  unpaid:   { cls: 'bg-red-500/10 text-red-400 border-red-500/30',     icon: '✗', label: 'Unpaid' },
  partial:  { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', icon: '◐', label: 'Partial' },
  paid:     { cls: 'bg-brand/10 text-brand border-brand/30',           icon: '✓', label: 'Paid' },
  overpaid: { cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30',  icon: '+', label: 'Overpaid' },
  na:       { cls: 'bg-line/40 text-[#e5e5e5]/60 border-line',         icon: '—', label: 'N/A' },
}
function PaymentChip({ status }) {
  const meta = PAYMENT_META[status] ?? PAYMENT_META.unpaid
  return (
    <span
      title={`Payment: ${meta.label}`}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${meta.cls}`}
    >
      <span aria-hidden>{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  )
}

function StatusBadge({ status }) {
  const map = {
    draft:    'bg-line text-[#e5e5e5]/60 border-line',
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

// Minimum canonical-roster size to submit a ZLTAC team for approval. Mirrors
// the server-side gate in api/captain.js (submit-team); the server re-checks.
const MIN_PLAYERS = 5

export default function CaptainHub() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [team, setTeam] = useState(null)
  const [event, setEvent] = useState(null)
  const [roster, setRoster] = useState([])
  const [completionMap, setCompletionMap] = useState({})
  const [filter, setFilter] = useState('all')

  // Player search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchDone, setSearchDone] = useState(false)
  const searchTimer = useRef(null)

  // Remove confirmation
  const [removeConfirm, setRemoveConfirm] = useState(null) // { regId, alias }

  // Disband confirmation
  const [disbandOpen, setDisbandOpen] = useState(false)
  const [disbanding, setDisbanding] = useState(false)
  const [disbandError, setDisbandError] = useState('')

  // Submit team for approval
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Toast
  const [toast, setToast] = useState(null)

  // Team settings
  const [editingSettings, setEditingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({ name: '', state: '', home_venue: '', colour: '#00E6FF' })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsErr, setSettingsErr] = useState('')

  // Logo upload
  const logoInputRef = useRef(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState('')

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
    setLoading(true)
    setLoadError('')
    try {
      const { data: ev, error: eventError } = await supabase
        .from('public_zltac_events')
        .select('id, name, year, status, start_date, timezone, require_ref_test, require_coc, require_payment, reg_open_date, reg_close_date, event_starts_at, committee_email')
        .eq('status', 'open')
        .maybeSingle()
      if (eventError) throw eventError

      setEvent(ev ?? null)
      if (!ev) {
        setTeam(null)
        setRoster([])
        setCompletionMap({})
        return
      }

      const { data: t, error: teamError } = await supabase
        .from('own_zltac_teams')
        .select('id, event_id, name, state, home_venue, colour, status, rejection_reason, logo_url, viewer_role')
        .eq('event_id', ev.id)
        .eq('viewer_role', 'captain')
        .maybeSingle()
      if (teamError) throw teamError

      if (!t) {
        setTeam(null)
        setRoster([])
        setCompletionMap({})
        return
      }

      setTeam(t)
      setSettingsForm({ name: t.name ?? '', state: t.state ?? '', home_venue: t.home_venue ?? '', colour: t.colour ?? '#00E6FF' })
      await loadRoster(t, ev)
    } catch (err) {
      console.error('[CaptainHub] load failed:', err)
      setLoadError(err?.message || 'Could not load your Team Hub. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function loadRoster(t, currentEvent) {
    const result = await apiFetch('/api/captain', {
      method: 'POST',
      body: JSON.stringify({
        action: 'team-readiness',
        teamId: t.id,
        eventId: currentEvent.id,
      }),
    })
    if (result.event?.id !== currentEvent.id || result.team?.id !== t.id) {
      throw new Error('The server returned readiness for a different event or team.')
    }

    const profileMap = Object.fromEntries((result.profiles ?? []).map(profile => [profile.id, profile]))
    const rows = (result.registrations ?? []).map(row => ({
      ...row,
      profiles: profileMap[row.user_id] ?? null,
    }))
    setRoster(rows)
    setCompletionMap(result.readinessByUser ?? {})
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
    if (!event?.id || !team?.id) return
    setSearching(true)
    try {
      const { profiles } = await apiFetch('/api/captain', {
        method: 'POST',
        body: JSON.stringify({
          action: 'search-players',
          teamId: team.id,
          eventId: event.id,
          term,
        }),
      })
      setSearchResults(profiles ?? [])
      setSearchDone(true)
    } catch (err) {
      showToast(`Search failed: ${err?.message || 'Please try again.'}`)
      setSearchResults([])
      setSearchDone(true)
    } finally {
      setSearching(false)
    }
  }

  async function addPlayer(profile) {
    if (!team || !event?.year) return

    try {
      await apiFetch('/api/captain', {
        method: 'POST',
        body: JSON.stringify({ action: 'add-player', playerHandle: profile.handle, teamId: team.id, eventId: event.id }),
      })
      await loadRoster(team, event)
    } catch (err) {
      showToast(`Error: ${err.message}`)
      return
    }

    setSearchResults(r => r.filter(p => p.handle !== profile.handle))
    setSearchQuery('')
    setSearchDone(false)
    showToast(`${profile.alias || 'Player'} added to your team`)
  }

  // ── Remove player ─────────────────────────────────────────────────────────
  async function confirmRemove() {
    if (!removeConfirm) return
    try {
      await apiFetch('/api/captain', {
        method: 'POST',
        body: JSON.stringify({
          action: 'remove-player',
          playerId: removeConfirm.userId,
          teamId: team?.id,
          eventId: event?.id,
        }),
      })
    } catch (err) {
      showToast(`Error: ${err.message}`)
      setRemoveConfirm(null)
      return
    }

    setRoster(r => r.filter(p => p.id !== removeConfirm.regId))
    showToast(`${removeConfirm.alias} removed from your team`)
    setRemoveConfirm(null)
  }

  // ── Disband team ──────────────────────────────────────────────────────────
  async function disbandTeam() {
    if (!team?.id || !event?.id) return
    setDisbanding(true)
    setDisbandError('')
    try {
      await apiFetch('/api/captain', {
        method: 'POST',
        body: JSON.stringify({ action: 'disband-team', teamId: team.id, eventId: event.id }),
      })
      navigate('/player-hub')
    } catch (err) {
      console.error('[CaptainHub] disbandTeam threw:', err)
      setDisbandError(err?.message || 'Failed to disband team. Please try again.')
      setDisbanding(false)
    }
  }

  // ── Submit team for approval ──────────────────────────────────────────────
  // Service-role endpoint (bypasses the Batch-1 status trigger) that re-checks
  // captaincy, ZLTAC, draft/rejected status, and the >=5 roster count. We don't
  // swallow errors — they surface in submitError.
  async function submitTeam() {
    if (!team?.id || !event?.id) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await apiFetch('/api/captain', {
        method: 'POST',
        body: JSON.stringify({ action: 'submit-team', teamId: team.id, eventId: event.id }),
      })
      setTeam(t => ({ ...t, status: res?.status ?? 'pending', rejection_reason: null }))
      showToast('Team submitted for approval')
    } catch (err) {
      setSubmitError(err?.message || 'Could not submit the team. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Team settings ─────────────────────────────────────────────────────────
  async function persistTeamSettings(overrides = {}) {
    if (!team?.id || !event?.id) throw new Error('Team or event is not loaded yet.')
    const has = key => Object.prototype.hasOwnProperty.call(overrides, key)
    const result = await apiFetch('/api/captain', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update-team-settings',
        teamId: team.id,
        eventId: event.id,
        name: has('name') ? overrides.name : team.name,
        state: has('state') ? overrides.state : (team.state ?? null),
        homeVenue: has('homeVenue') ? overrides.homeVenue : (team.home_venue ?? null),
        colour: has('colour') ? overrides.colour : team.colour,
        logoUrl: has('logoUrl') ? overrides.logoUrl : (team.logo_url ?? null),
      }),
    })
    if (!result?.team) throw new Error('The server did not return the updated team.')

    const merged = { ...team, ...result.team }
    setTeam(merged)
    setSettingsForm({
      name: merged.name ?? '',
      state: merged.state ?? '',
      home_venue: merged.home_venue ?? '',
      colour: merged.colour ?? '#00E6FF',
    })
    return merged
  }

  // ── Logo upload ──────────────────────────────────────────────────────────
  // Path convention: team-logos/{team_id}/{timestamp}.{ext}. Backed by the
  // team_logos_captain_team_write RLS policy (see 20260520000000 migration).
  // We do not delete the old file when replacing; orphan cleanup is handled
  // separately. Active document formats such as SVG are deliberately rejected.
  const LOGO_ACCEPTED_TYPES = RASTER_IMAGE_TYPES
  const LOGO_MAX_BYTES = 2 * 1024 * 1024 // 2 MB

  function pickLogo() {
    setLogoError('')
    if (eventPhase(event) !== 'open') {
      setLogoError('Team settings are locked because registration has closed.')
      return
    }
    logoInputRef.current?.click()
  }

  async function onLogoFileChosen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError('')

    if (!LOGO_ACCEPTED_TYPES.includes(file.type)) {
      setLogoError('Unsupported file type. Use PNG, JPEG, or WebP.')
      e.target.value = ''
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(2)
      setLogoError(`File is ${mb} MB — max 2 MB.`)
      e.target.value = ''
      return
    }
    if (!team?.id) {
      setLogoError('Team is not loaded yet.')
      e.target.value = ''
      return
    }

    setLogoUploading(true)
    try {
      const ext = extensionForMime(file.type)
      const path = `${team.id}/${Date.now()}.${ext}`

      const { data: up, error: upErr } = await supabase.storage
        .from('team-logos')
        .upload(path, file, { upsert: false, contentType: file.type })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('team-logos').getPublicUrl(up.path)
      const publicUrl = urlData.publicUrl

      await persistTeamSettings({ logoUrl: publicUrl })
      showToast('Logo updated')
    } catch (err) {
      setLogoError(err?.message || 'Logo upload failed. Please try again.')
    } finally {
      setLogoUploading(false)
      e.target.value = ''
    }
  }

  async function saveSettings() {
    if (!settingsForm.name.trim()) { setSettingsErr('Team name is required.'); return }
    if (!settingsForm.state) { setSettingsErr('State / territory is required.'); return }
    if (eventPhase(event) !== 'open') { setSettingsErr('Team settings are locked because registration has closed.'); return }
    setSavingSettings(true)
    setSettingsErr('')
    try {
      await persistTeamSettings({
        name: settingsForm.name.trim(),
        state: settingsForm.state || null,
        homeVenue: settingsForm.home_venue.trim() || null,
        colour: settingsForm.colour,
      })
      setEditingSettings(false)
    } catch (err) {
      setSettingsErr(err?.message || 'Could not save team settings. Please try again.')
    } finally {
      setSavingSettings(false)
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportRosterCSV() {
    if (!roster.length) return
    const rows = roster.map(r => ({
      name: `${r.profiles?.first_name ?? ''} ${r.profiles?.last_name ?? ''}`.trim(),
      alias: r.profiles?.alias ?? '',
      state: r.profiles?.state ?? '',
      dob: registrationDateOfBirth(r, r.profiles) ?? '',
      side_event_entries: (r.side_events ?? []).join('; '),
      dinner_guests: r.dinner_guests ?? 0,
      status: r.status ?? '',
      coc:         checkDone(completionMap[r.user_id]?.checks?.code_of_conduct) ? 'Yes' : 'No',
      rules_test:  checkDone(completionMap[r.user_id]?.checks?.referee_test) ? 'Yes' : 'No',
      media:       checkDone(completionMap[r.user_id]?.checks?.media_release) ? 'Yes' : 'No',
      side_events_complete: checkDone(completionMap[r.user_id]?.checks?.side_events) ? 'Yes' : 'No',
      extras:      checkDone(completionMap[r.user_id]?.checks?.extras) ? 'Yes' : 'No',
      under_18:    completionMap[r.user_id]?.checks?.under_18?.status === 'pending_review'
                    ? 'Pending committee'
                    : checkDone(completionMap[r.user_id]?.checks?.under_18) ? 'Yes' : 'No',
      payment:     paymentStatus(completionMap[r.user_id]?.checks?.payment),
      readiness:   completionMap[r.user_id]?.overall?.state ?? 'action_required',
    }))
    const keys = Object.keys(rows[0])
    const csv = buildCsv(keys, rows.map(row => keys.map(key => row[key])))
    downloadCsv(csv, 'roster.csv')
  }

  function isPlayerReady(uid) {
    return completionMap[uid]?.overall?.event_ready === true
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return <div className="min-h-screen bg-base flex items-center justify-center"><div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
  }
  if (loadError) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <h1 className="text-2xl font-black text-white mb-2">Could not load Team Hub</h1>
        <p className="text-red-300 text-sm mb-6 max-w-md">{loadError}</p>
        <div className="flex items-center gap-3">
          <button onClick={load} className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all">Try again</button>
          <Link to="/dashboard" className="border border-line text-white px-5 py-2.5 rounded-xl text-sm font-semibold">Back to dashboard</Link>
        </div>
      </div>
    )
  }
  if (!team) {
    return (
      <div className="min-h-screen bg-base flex flex-col">
        {/* Welcome */}
        <div className="max-w-4xl mx-auto px-6 pt-10 w-full">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-shrink-0">
              <TeamShieldIcon size={56} />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-black text-white leading-tight">Welcome to Team Hub</h1>
              <p className="text-[#e5e5e5]/60 text-sm mt-1">
                Your hub for managing roster, tracking team readiness, and approving players.
              </p>
            </div>
          </div>
        </div>
        {/* No-team placeholder */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="text-4xl mb-4">👑</div>
          <h2 className="text-2xl font-black text-white mb-2">{event ? 'No Team Found' : 'No Active Event'}</h2>
          <p className="text-[#e5e5e5]/60 text-sm mb-6">{event ? "You haven't registered a team for this event yet." : 'There is no active ZLTAC event right now.'}</p>
          <Link to={event ? `/events/${event.year}/captain-register` : '/'} className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all">
            {event ? 'Register a Team →' : 'Back to home →'}
          </Link>
        </div>
      </div>
    )
  }

  const eventYear = event?.year
  // Once registration locks, the roster is frozen: captains can't add/remove
  // players or disband. Server-side add-player / disband-team are already
  // phase-guarded (api/captain.js); this gates the UI so controls don't
  // invite a click that 403s. Cosmetic team settings (name/logo/venue) stay
  // editable — they don't affect registration, fees, or eligibility.
  const phase = eventPhase(event)
  const locked = phase !== 'open'
  // Team-status lock (Batch 2): once a ZLTAC team is submitted (pending) or
  // approved, name + roster are frozen and changes go via the committee. The
  // server trigger enforces this; the UI mirrors it. Cosmetic logo/colour stay
  // open. draft/rejected leave the build controls open so captains can fix and
  // (re-)submit.
  const statusLocked = team.status === 'pending' || team.status === 'approved'
  const canSubmit = team.status === 'draft' || team.status === 'rejected'
  const committeeEmail = event?.committee_email || COMMITTEE_EMAIL
  const filteredRoster = roster.filter(r => {
    if (filter === 'ready') return isPlayerReady(r.user_id)
    if (filter === 'incomplete') return !isPlayerReady(r.user_id)
    if (filter === 'unpaid') {
      const status = paymentStatus(completionMap[r.user_id]?.checks?.payment)
      return status === 'unpaid' || status === 'partial'
    }
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
        <Dialog open onClose={() => setRemoveConfirm(null)} variant="center" size="sm" className="p-6">
          <Dialog.Title as="p" className="text-white font-bold mb-2">Remove player?</Dialog.Title>
            <p className="text-[#e5e5e5]/60 text-sm mb-5">Remove <span className="text-white font-semibold">{removeConfirm.alias}</span> from your team? Their registration will remain but they'll be unassigned.</p>
            <div className="flex gap-3">
              <button onClick={confirmRemove} className="bg-red-500 hover:bg-red-600 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">Remove</button>
              <button onClick={() => setRemoveConfirm(null)} className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Cancel</button>
            </div>
        </Dialog>
      )}

      {/* Disband team confirmation modal */}
      {disbandOpen && (
        <Dialog
          open
          onClose={() => { setDisbandOpen(false); setDisbandError('') }}
          variant="center"
          size="sm"
          closeOnBackdrop={false}
          className="p-6"
        >
          <Dialog.Title as="p" className="text-white font-bold mb-2">Disband team?</Dialog.Title>
            <p className="text-[#e5e5e5]/60 text-sm mb-5">
              This permanently deletes <span className="text-white font-semibold">{team?.name}</span> and removes all <span className="text-white font-semibold">{roster.length}</span> member{roster.length !== 1 ? 's' : ''} from the team.
              They will remain registered for <span className="text-white font-semibold">{event?.name ?? `ZLTAC ${event?.year ?? ''}`}</span> but will need to create or join another team. This cannot be undone. Continue?
            </p>
            {disbandError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{disbandError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={disbandTeam}
                disabled={disbanding}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                {disbanding ? 'Disbanding…' : 'Disband team'}
              </button>
              <button
                onClick={() => { setDisbandOpen(false); setDisbandError('') }}
                className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
        </Dialog>
      )}

      <div className="max-w-4xl mx-auto px-6 py-10">
        {event && (
          <Link to={`/events/${eventYear}`} className="text-[#e5e5e5]/60 hover:text-brand text-xs transition-colors mb-5 inline-block">
            ← {event.name}
          </Link>
        )}

        {/* Welcome */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-shrink-0">
            <TeamShieldIcon size={56} />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white leading-tight">Welcome to Team Hub</h1>
            <p className="text-[#e5e5e5]/60 text-sm mt-1">
              Your hub for managing roster, tracking team readiness, and approving players.
            </p>
          </div>
        </div>

        {/* Header */}
        <div className="flex items-start gap-5 mb-6">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center font-black text-black text-base flex-shrink-0" style={{ background: team.colour ?? '#00E6FF' }}>
            {team.logo_url
              ? <img src={storageImageUrl(team.logo_url, { width: 128 })} alt={team.name} decoding="async" className="w-full h-full object-contain rounded-xl" />
              : initials(team.name)
            }
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-2xl font-black text-white">{team.name}</h1>
              <StatusBadge status={team.status} />
            </div>
            <p className="text-[#e5e5e5]/60 text-xs">
              {team.state && <span>{team.state} · </span>}
              {team.home_venue && <span>{team.home_venue} · </span>}
              <span>ZLTAC {eventYear ?? '—'} · Team Hub</span>
            </p>
          </div>
        </div>

        {/* Status banners */}
        {/* Submitted (pending) or approved: name + roster are frozen; changes
            go via the committee. Amber lock banner mirrors LockedRegistrationBanner. */}
        {statusLocked && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
            <span className="text-lg flex-shrink-0 leading-none mt-0.5" aria-hidden>🔒</span>
            <div className="min-w-0 text-sm">
              <p className="text-yellow-300 font-semibold">
                Team and roster changes are locked while your team is {team.status === 'approved' ? 'approved' : 'under review'}.
              </p>
              <p className="text-yellow-200/80 mt-1 leading-relaxed">
                Email the committee at{' '}
                <a href={`mailto:${committeeEmail}`} className="underline hover:text-yellow-100">{committeeEmail}</a>
                {' '}to make any adjustments.
              </p>
            </div>
          </div>
        )}
        {team.status === 'rejected' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-5">
            <p className="text-red-400 text-sm font-semibold">✗ Team registration was not approved</p>
            {team.rejection_reason && <p className="text-[#e5e5e5]/60 text-xs mt-1">Reason: {team.rejection_reason}</p>}
            <p className="text-[#e5e5e5]/60 text-xs mt-1">Adjust your team or roster below, then re-submit for approval.</p>
          </div>
        )}

        {/* Submit for approval — shown only while the build is open (draft or
            rejected). Enabled at >= MIN_PLAYERS; the server re-checks. */}
        {canSubmit && (
          <div className="bg-surface border border-line rounded-2xl p-5 mb-5">
            <h2 className="text-white font-bold mb-1">Submit Team for Approval</h2>
            <p className="text-[#e5e5e5]/60 text-xs leading-relaxed mb-3">
              Your team and roster will be reviewed by the committee and approved if it meets the ZLTAC rules &amp; regulations. Once approved, all team and roster changes must be made via the committee by email.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={submitTeam}
                disabled={submitting || roster.length < MIN_PLAYERS}
                className="bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
              >
                {submitting ? 'Submitting…' : 'Submit Team for Approval'}
              </button>
              {roster.length < MIN_PLAYERS && (
                <span className="text-[#e5e5e5]/60 text-xs">
                  {roster.length} / {MIN_PLAYERS} players — add {MIN_PLAYERS - roster.length} more to submit
                </span>
              )}
            </div>
            {submitError && <p role="alert" className="text-red-400 text-xs mt-2">{submitError}</p>}
          </div>
        )}

        {/* Registration lock banner — roster changes go via the committee. */}
        {locked && <LockedRegistrationBanner phase={phase} email={event?.committee_email} className="mb-5" />}

        <div className="space-y-5">

          {/* ── Add Players ───────────────────────────────────────────────── */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h2 className="text-white font-bold mb-1">Add Players to Team</h2>
            <p className="text-[#e5e5e5]/60 text-xs mb-4">Search for players who have registered for ZLTAC {eventYear} but are not yet on a team.</p>

            {/* How players get onto a team now that invite codes are gone. */}
            <div className="bg-base border border-line rounded-xl px-4 py-3 mb-4">
              <p className="text-[#e5e5e5]/70 text-xs leading-relaxed">
                Players need to be added here with the search tool. Players must be signed up to the ALSA portal and registered to the current event to be added.
              </p>
            </div>

            {(locked || statusLocked) ? (
              <LockedNotice email={event?.committee_email} />
            ) : (
              <>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    placeholder="Search by player alias…"
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
                  <p className="text-[#e5e5e5]/60 text-xs mt-3">Type at least 3 characters to search</p>
                )}

                {searchDone && !searching && searchResults.length === 0 && searchQuery.trim().length >= 3 && (
                  <p className="text-[#e5e5e5]/60 text-xs mt-3">
                    No registered ZLTAC {eventYear} players found matching that search. They may not have signed up to the ALSA portal and registered for ZLTAC {eventYear} yet. Players must do both before they can be added here.
                  </p>
                )}

                {searchResults.length > 0 && (
                  <div className="mt-2 border border-line rounded-xl overflow-hidden">
                    {searchResults.map((p, i) => (
                        <div key={p.handle} className={`flex items-center gap-3 px-4 py-3 ${i !== 0 ? 'border-t border-line' : ''} hover:bg-line/30 transition-colors`}>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-black flex-shrink-0" style={{ background: '#00E6FF' }}>
                            {initials(p.alias)}
                          </div>
                          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                            <span className="text-white text-sm font-semibold">{p.alias || 'Player'}</span>
                          </div>
                          <button
                            onClick={() => addPlayer(p)}
                            className="flex-shrink-0 text-xs bg-brand/10 hover:bg-brand/20 text-brand font-bold px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Add to Team
                          </button>
                        </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Roster ────────────────────────────────────────────────────── */}
          <div className="bg-surface border border-line rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-white font-bold">Team Roster</h2>
                <p className="text-[#e5e5e5]/60 text-xs mt-0.5">{roster.length} player{roster.length !== 1 ? 's' : ''} on your team</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {['all', 'ready', 'incomplete', 'unpaid'].map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg capitalize transition-colors ${filter === f ? 'bg-brand text-black' : 'bg-line text-[#e5e5e5]/60 hover:text-white'}`}>
                    {f}
                  </button>
                ))}
                <button onClick={exportRosterCSV} className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/60 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                  CSV
                </button>
              </div>
            </div>

            {filteredRoster.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-[#e5e5e5]/60 text-sm">
                  {roster.length === 0
                    ? (locked
                        ? 'Registrations are locked. Players can no longer be added.'
                        : 'No players on your team yet. Use the search above to add registered ZLTAC players to your team.')
                    : 'No players match this filter.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {filteredRoster.map(r => {
                  const name = [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(' ') || '—'
                  const alias = r.profiles?.alias
                  const pState = r.profiles?.state
                  const avatarUrl = r.profiles?.avatar_url
                  const comp = completionMap[r.user_id] ?? {}
                  const checks = comp.checks ?? {}
                  const u18 = checks.under_18?.status !== 'not_required'
                  const dobBlocked = checks.identity?.status !== 'satisfied'
                  const ready = isPlayerReady(r.user_id)
                  const awaitingReview = comp.overall?.awaiting_committee === true
                  const isMe = r.user_id === user.id

                  return (
                    <div key={r.id} className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        {avatarUrl
                          ? <img src={storageImageUrl(avatarUrl, { width: 72, resize: 'cover' })} alt={name} loading="lazy" decoding="async" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-black flex-shrink-0" style={{ background: '#00E6FF' }}>{initials(name)}</div>
                        }

                        <div className="flex-1 min-w-0">
                          {/* Name row */}
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <span className="text-white font-semibold text-sm">{name}</span>
                            {alias && <span className="text-brand text-xs">"{alias}"</span>}
                            <CommitteeBadge roles={r.profiles?.roles} size="xs" />
                            {pState && <span className="text-[10px] bg-brand/10 text-brand border border-brand/20 px-1.5 py-0.5 rounded-full font-bold">{pState}</span>}
                            {u18 && <span className="text-[10px] bg-yellow-400/10 text-yellow-400 border border-yellow-400/20 px-1.5 py-0.5 rounded-full font-bold">U18</span>}
                            {dobBlocked && <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded-full font-bold">DOB required</span>}
                            {isMe && <span className="text-[10px] text-[#e5e5e5]/60 font-semibold">(You)</span>}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ready ? 'bg-brand/10 text-brand' : awaitingReview ? 'bg-yellow-500/10 text-yellow-300' : 'bg-red-500/10 text-red-300'}`}>
                              {ready ? 'Ready' : awaitingReview ? 'Awaiting review' : 'Action required'}
                            </span>
                          </div>

                          {/* Completion chips — read-only.
                              On narrow viewports the strip wraps; each chip
                              still carries its full status word. */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <StatusChip
                              state={checkChipState(checks.code_of_conduct)}
                              label={checks.code_of_conduct?.source === 'committee_override' ? 'CoC OVR' : 'CoC'}
                              title={readinessTitle('Code of Conduct', checks.code_of_conduct)}
                            />
                            <StatusChip
                              state={checkChipState(checks.referee_test)}
                              label={checks.referee_test?.source === 'committee_override' ? 'Rules OVR' : 'Rules'}
                              title={readinessTitle('Rules Test', checks.referee_test)}
                            />
                            <StatusChip
                              state={checkChipState(checks.media_release)}
                              label={checks.media_release?.source === 'committee_override' ? 'Media OVR' : 'Media'}
                              title={readinessTitle('Media Release', checks.media_release)}
                            />
                            <StatusChip
                              state={checkChipState(checks.side_events)}
                              label="Side"
                              title={readinessTitle('Side events', checks.side_events)}
                            />
                            <StatusChip
                              state={checkChipState(checks.extras)}
                              label="Extras"
                              title={readinessTitle('Extras', checks.extras)}
                            />
                            {u18 && (
                              <StatusChip
                                state={checkChipState(checks.under_18)}
                                label={checks.under_18?.source === 'committee_override' ? 'U18 OVR' : 'U18'}
                                title={readinessTitle('Under-18 approval', checks.under_18)}
                              />
                            )}
                            <PaymentChip status={paymentStatus(checks.payment)} />
                          </div>
                        </div>

                        {/* Remove button — frozen once registration locks. */}
                        {!isMe && (
                          <button
                            onClick={() => setRemoveConfirm({ regId: r.id, userId: r.user_id, alias: alias || name })}
                            disabled={locked || statusLocked}
                            title={(locked || statusLocked) ? 'Locked — contact the committee to change the roster' : undefined}
                            className="flex-shrink-0 text-xs text-red-400/50 hover:text-red-400 hover:bg-red-400/10 font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-red-400/50 disabled:cursor-default"
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
              {!editingSettings && !locked && (
                <button onClick={() => setEditingSettings(true)} className="text-xs text-brand/60 hover:text-brand transition-colors">Edit</button>
              )}
            </div>

            {/* Logo row — always visible. Read-only display + upload control. */}
            <div className="flex items-center gap-4 mb-5 pb-5 border-b border-line">
              <div
                className="w-20 h-20 rounded-xl flex items-center justify-center font-black text-black text-base flex-shrink-0 overflow-hidden"
                style={{ background: team.colour ?? '#00E6FF' }}
              >
                {/* SAFETY: do not inline-render SVG logos — always use <img src>. */}
                {team.logo_url
                  ? <img src={storageImageUrl(team.logo_url, { width: 160 })} alt={`${team.name} logo`} loading="lazy" decoding="async" className="w-full h-full object-contain" />
                  : <span aria-hidden>{initials(team.name)}</span>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1">Team Logo</p>
                <p className="text-xs text-[#e5e5e5]/60 mb-2 leading-relaxed">
                  PNG, JPEG, or WebP · max 2 MB
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={onLogoFileChosen}
                    className="hidden"
                  />
                  <button
                    onClick={pickLogo}
                    disabled={logoUploading || locked}
                    className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {logoUploading
                      ? 'Uploading…'
                      : team.logo_url
                        ? 'Replace logo'
                        : 'Upload logo'}
                  </button>
                  {logoUploading && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#e5e5e5]/60">
                      <span className="w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                      Uploading…
                    </span>
                  )}
                </div>
                {logoError && <p className="text-red-400 text-xs mt-2">{logoError}</p>}
              </div>
            </div>

            {editingSettings ? (
              <div className="space-y-4">
                {statusLocked && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2">
                    <p className="text-yellow-300/90 text-xs leading-relaxed">
                      Name, state, and home venue are locked while your team is {team.status === 'approved' ? 'approved' : 'under review'} — email the committee to change them. Logo and colour stay editable.
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Team Name</label>
                  <input type="text" value={settingsForm.name} onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))}
                    disabled={statusLocked}
                    className="w-full bg-base border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-40 disabled:cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">State / Territory</label>
                  <select value={settingsForm.state} onChange={e => setSettingsForm(f => ({ ...f, state: e.target.value }))}
                    disabled={statusLocked}
                    className="w-full bg-base border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-40 disabled:cursor-not-allowed">
                    <option value="">Select…</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Home Venue</label>
                  <input type="text" value={settingsForm.home_venue} onChange={e => setSettingsForm(f => ({ ...f, home_venue: e.target.value }))}
                    placeholder="e.g. Zone300 Sydney"
                    disabled={statusLocked}
                    className="w-full bg-base border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand disabled:opacity-40 disabled:cursor-not-allowed" />
                </div>
                {/* Team colour — mirrors CaptainRegister.jsx picker exactly. */}
                <div>
                  <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-2">Team Colour</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {TEAM_COLOURS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setSettingsForm(f => ({ ...f, colour: c }))}
                        className="w-8 h-8 rounded-full border-2 transition-all"
                        style={{ background: c, borderColor: settingsForm.colour === c ? '#fff' : 'transparent' }}
                      />
                    ))}
                    <input
                      type="color"
                      value={settingsForm.colour}
                      onChange={e => setSettingsForm(f => ({ ...f, colour: e.target.value }))}
                      className="w-8 h-8 rounded-full border border-line bg-surface cursor-pointer p-0.5"
                      title="Custom colour"
                    />
                    <span className="text-xs text-[#e5e5e5]/60 font-mono ml-1">{settingsForm.colour}</span>
                  </div>
                </div>
                {settingsErr && <p className="text-red-400 text-xs">{settingsErr}</p>}
                <div className="flex gap-3">
                  <button onClick={saveSettings} disabled={savingSettings}
                    className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all">
                    {savingSettings ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => { setEditingSettings(false); setSettingsErr('') }}
                    className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[#e5e5e5]/60">Team Name</span><span className="text-white font-semibold">{team.name}</span></div>
                <div className="flex justify-between"><span className="text-[#e5e5e5]/60">State</span><span className="text-white">{team.state ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-[#e5e5e5]/60">Home Venue</span><span className="text-white">{team.home_venue ?? '—'}</span></div>
              </div>
            )}

            {!editingSettings && (
              <div className="mt-5 pt-4 border-t border-line">
                {(locked || statusLocked) ? (
                  <LockedNotice email={event?.committee_email} />
                ) : (
                  <button
                    onClick={() => { setDisbandError(''); setDisbandOpen(true) }}
                    className="text-red-400 hover:text-red-300 text-xs font-semibold transition-colors"
                  >
                    Disband team
                  </button>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
      <Footer />
    </div>
  )
}
