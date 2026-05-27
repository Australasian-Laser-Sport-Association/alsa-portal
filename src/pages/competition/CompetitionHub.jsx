import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Footer from '../../components/Footer'
import { useAuth } from '../../lib/useAuth'
import { apiFetch } from '../../lib/apiFetch.js'
import { TEAM_COLOURS } from '../../lib/teamColours'

// Unified competition hub (Phase 3c). One page combines:
//   - Your Registration (profile snapshot + cancel)
//   - Your Team (create / view / edit / disband)
//   - Payment (reference, owing, status, bank details when manager has flipped
//     payment_info_visible on)
//
// Auth is page-self-gated so the redirect carries a proper return URL.

function formatDateRange(start, end) {
  if (!start || !end) return ''
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  const s = new Date(start).toLocaleDateString('en-AU', opts)
  const e = new Date(end).toLocaleDateString('en-AU', opts)
  return s === e ? s : `${s} to ${e}`
}

function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function relativeTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.round(d / 30)
  return `${mo} mo ago`
}

function windowState(comp) {
  const now = new Date()
  const open = comp.registration_open_at ? new Date(comp.registration_open_at) : null
  const close = comp.registration_close_at ? new Date(comp.registration_close_at) : null
  if (close && now > close) return { label: 'Closed', tone: 'grey' }
  if (open && now < open) return { label: `Opens ${formatDateTime(comp.registration_open_at)}`, tone: 'amber' }
  if (close) return { label: `Closes ${formatDateTime(comp.registration_close_at)}`, tone: 'green' }
  return { label: 'Open', tone: 'green' }
}

const PAY_PILL = {
  unpaid:   { label: 'Unpaid',   tone: 'red' },
  partial:  { label: 'Partial',  tone: 'amber' },
  paid:     { label: 'Paid',     tone: 'green' },
  overpaid: { label: 'Overpaid', tone: 'blue' },
  refunded: { label: 'Refunded', tone: 'grey' },
}

const TONE = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  red:   'bg-red-500/15 text-red-400 border-red-500/30',
  blue:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
  grey:  'bg-[#374056] text-white border-line',
}

function Pill({ tone, children }) {
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <p className="text-white text-sm">{value || <span className="opacity-40">Not set</span>}</p>
    </div>
  )
}


// ── Team create modal ───────────────────────────────────────────────────────
function CreateTeamModal({ competitionId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [colour, setColour] = useState(TEAM_COLOURS[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Team name is required.')
    setSubmitting(true)
    try {
      const team = await apiFetch('/api/superadmin/competition-team', {
        method: 'POST',
        body: JSON.stringify({ competition_id: competitionId, name: name.trim(), colour }),
      })
      onCreated(team)
    } catch (err) {
      setError(err.message || 'Could not create team.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
      <form onSubmit={submit} className="bg-surface border border-line rounded-2xl p-6 max-w-md w-full">
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-white font-bold text-lg">Create team</p>
          <button type="button" onClick={onClose} className="text-white text-xl leading-none px-2">×</button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Team name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={50}
              className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-2">Team colour</label>
            <div className="flex flex-wrap gap-2">
              {TEAM_COLOURS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColour(c)}
                  className={`w-9 h-9 rounded-full border-2 transition-all ${colour === c ? 'border-white' : 'border-transparent'}`}
                  style={{ background: c }}
                  aria-label={`Pick ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="submit"
            disabled={submitting}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all"
          >
            {submitting ? 'Creating...' : 'Create team'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}


// ── Captain team edit card ──────────────────────────────────────────────────
function CaptainTeamCard({ team, onSaved }) {
  const [name, setName] = useState(team.name)
  const [colour, setColour] = useState(team.colour ?? TEAM_COLOURS[0])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [disbandOpen, setDisbandOpen] = useState(false)
  const [disbandError, setDisbandError] = useState(null)
  const [disbanding, setDisbanding] = useState(false)

  const dirty = name.trim() !== team.name || colour !== team.colour

  async function save() {
    setSaveError(null)
    setSaving(true)
    try {
      const updated = await apiFetch(`/api/superadmin/competition-team?team_id=${team.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), colour }),
      })
      onSaved(updated)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      setSaveError(err.message || 'Could not save changes.')
    } finally {
      setSaving(false)
    }
  }

  async function disband() {
    setDisbandError(null)
    setDisbanding(true)
    try {
      await apiFetch(`/api/superadmin/competition-team?team_id=${team.id}`, { method: 'DELETE' })
      onSaved(null)
    } catch (err) {
      setDisbandError(err.message || 'Could not disband team.')
      setDisbanding(false)
    }
  }

  const otherMembers = (team.members ?? []).filter(m => !(m.roles ?? []).includes('captain'))
  const canDisband = otherMembers.length === 0

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-line rounded-2xl p-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-4">Team details</p>

        <div className="flex items-start gap-5 mb-5">
          <div
            className="w-16 h-16 rounded-2xl border border-line flex-shrink-0"
            style={{ background: colour }}
            aria-label="Team colour preview"
          />
          <div className="flex-1 space-y-3">
            <div>
              <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={50}
                className="w-full bg-base border border-line rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-xs text-white font-bold uppercase tracking-wider mb-2">Colour</label>
              <div className="flex flex-wrap gap-2">
                {TEAM_COLOURS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColour(c)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${colour === c ? 'border-white' : 'border-transparent'}`}
                    style={{ background: c }}
                    aria-label={`Pick ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {saveError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-3">
            <p className="text-red-400 text-xs">{saveError}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {savedFlash && <span className="text-brand text-xs font-semibold">Saved</span>}
        </div>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-3">Roster</p>
        <div className="space-y-2">
          {team.members.map(m => {
            const isCaptainRow = (m.roles ?? []).includes('captain')
            const fullName = [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(' ')
            return (
              <div key={m.user_id} className="flex items-center justify-between gap-3 bg-base border border-line rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-white text-sm font-semibold">
                    {m.profile?.alias ? <span className="text-brand">"{m.profile.alias}"</span> : <span className="opacity-50">(no alias)</span>}
                    {fullName && <span className="ml-2">{fullName}</span>}
                  </p>
                </div>
                {isCaptainRow && <Pill tone="green">Captain</Pill>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-2">Invite players</p>
        <p className="text-white text-sm opacity-70">
          Invite functionality ships in the next phase. Players will be invitable by alias.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setDisbandOpen(true)}
          disabled={!canDisband}
          className="text-xs text-red-400 opacity-70 hover:opacity-100 transition-opacity disabled:opacity-30 disabled:cursor-default"
          title={canDisband ? '' : 'Remove all team members before disbanding.'}
        >
          Disband team
        </button>
        {!canDisband && (
          <span className="text-white text-[11px] opacity-50">
            Remove all team members before disbanding.
          </span>
        )}
      </div>

      {disbandOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
            <p className="text-white font-bold mb-2">Disband team?</p>
            <p className="text-white text-sm mb-5 opacity-80">
              Disband <span className="font-semibold">{team.name}</span>? Your registration stays, but you will no longer be on a team for this competition.
            </p>
            {disbandError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{disbandError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={disband}
                disabled={disbanding}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                {disbanding ? 'Disbanding...' : 'Disband team'}
              </button>
              <button
                type="button"
                onClick={() => { setDisbandOpen(false); setDisbandError(null) }}
                disabled={disbanding}
                className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Read-only team card (member view; Phase 3d will populate via invites) ──
function MemberTeamCard({ team }) {
  const captain = (team.members ?? []).find(m => (m.roles ?? []).includes('captain'))
  return (
    <div className="space-y-5">
      <div className="bg-surface border border-line rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl border border-line flex-shrink-0" style={{ background: team.colour }} />
          <div>
            <p className="text-white text-xl font-black">{team.name}</p>
            {captain && (
              <p className="text-white opacity-60 text-xs mt-1">
                Captain: <span className="text-brand">"{captain.profile?.alias ?? '?'}"</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-5">
        <p className="text-white text-xs font-bold uppercase tracking-wider mb-3">Roster</p>
        <div className="space-y-2">
          {team.members.map(m => {
            const isCap = (m.roles ?? []).includes('captain')
            const fullName = [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(' ')
            return (
              <div key={m.user_id} className="flex items-center justify-between gap-3 bg-base border border-line rounded-xl px-3 py-2">
                <p className="text-white text-sm font-semibold">
                  {m.profile?.alias ? <span className="text-brand">"{m.profile.alias}"</span> : <span className="opacity-50">(no alias)</span>}
                  {fullName && <span className="ml-2">{fullName}</span>}
                </p>
                {isCap && <Pill tone="green">Captain</Pill>}
              </div>
            )
          })}
        </div>
      </div>

      {/* "Leave team" intentionally hidden in Phase 3c. Until Phase 3d ships
          the invite flow, there's no way to be on a team you didn't create,
          so this state is architecturally present but unreachable. The leave
          action lands with invites. */}
    </div>
  )
}


// ── Page ────────────────────────────────────────────────────────────────────
export default function CompetitionHub() {
  const { slug } = useParams()
  const { user, profile, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [comp, setComp] = useState(null)            // null = loading; false = not found
  const [registration, setRegistration] = useState(null) // null = loading; false = not registered
  const [team, setTeam] = useState(null)            // null = loading; false = no team
  const [error, setError] = useState(null)

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(null)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)

  // Auth gate.
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      const here = `/competitions/${slug}/hub`
      navigate(`/login?redirect=${encodeURIComponent(here)}`, { replace: true })
    }
  }, [user, authLoading, slug, navigate])

  const load = useCallback(async () => {
    if (!user) return
    try {
      // Resolve competition by slug first (need id for the next two calls).
      const compRes = await fetch(`/api/public?resource=competitions&slug=${encodeURIComponent(slug)}`)
      if (compRes.status === 404) { setComp(false); return }
      if (!compRes.ok) throw new Error(`HTTP ${compRes.status}`)
      const compData = await compRes.json()
      setComp(compData)

      // Registration + team in parallel.
      const [regResult, teamResult] = await Promise.allSettled([
        apiFetch(`/api/superadmin/competition-registration?competition_id=${compData.id}`),
        apiFetch(`/api/superadmin/competition-team?competition_id=${compData.id}`),
      ])

      if (regResult.status === 'fulfilled') {
        setRegistration(regResult.value)
      } else {
        const msg = regResult.reason?.message ?? ''
        if (msg.includes('not registered')) setRegistration(false)
        else throw regResult.reason
      }

      if (teamResult.status === 'fulfilled') {
        setTeam(teamResult.value)
      } else {
        const msg = teamResult.reason?.message ?? ''
        if (msg.includes('not on a team')) setTeam(false)
        else throw teamResult.reason
      }
    } catch (err) {
      setError(err.message || 'Could not load competition hub.')
      setComp(prev => prev ?? false)
      setRegistration(prev => prev ?? false)
      setTeam(prev => prev ?? false)
    }
  }, [user, slug])

  useEffect(() => {
    if (authLoading || !user) return
    queueMicrotask(load)
  }, [authLoading, user, load])

  // Once we know the user isn't registered, send them to /register.
  useEffect(() => {
    if (registration === false && comp && comp.archived_at == null) {
      navigate(`/competitions/${slug}/register`, { replace: true })
    }
  }, [registration, comp, slug, navigate])

  async function cancelRegistration() {
    if (!comp) return
    setCancelError(null)
    setCancelling(true)
    try {
      await apiFetch(`/api/superadmin/competition-registration?competition_id=${comp.id}`, { method: 'DELETE' })
      navigate(`/competitions/${slug}`, { replace: true })
    } catch (err) {
      setCancelError(err.message || 'Could not cancel registration.')
      setCancelling(false)
    }
  }

  if (authLoading || !user) {
    return (
      <div className="bg-base text-white min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (comp === null || registration === null || team === null) {
    return (
      <div className="bg-base text-white min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (comp === false) {
    return (
      <div className="bg-base text-white min-h-screen flex flex-col">
        <section className="flex-1 max-w-2xl w-full mx-auto px-6 py-16">
          <Link to="/competitions" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to competitions
          </Link>
          <div className="bg-surface border border-line rounded-2xl p-6">
            <p className="text-white font-bold mb-2">Competition not found</p>
            <p className="text-white text-sm opacity-70">
              We could not find a competition with that URL.
            </p>
            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
          </div>
        </section>
        <Footer />
      </div>
    )
  }

  if (comp.archived_at) {
    return (
      <div className="bg-base text-white min-h-screen flex flex-col">
        <section className="flex-1 max-w-2xl w-full mx-auto px-6 py-16">
          <Link to="/competitions" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to competitions
          </Link>
          <div className="bg-surface border border-line rounded-2xl p-6">
            <p className="text-white font-bold mb-2">This competition has been archived.</p>
            <p className="text-white text-sm opacity-70">Contact the event organiser if you have questions.</p>
          </div>
        </section>
        <Footer />
      </div>
    )
  }

  // The not-registered branch above triggers a redirect via effect; render
  // nothing in the gap.
  if (registration === false) return null

  const win = windowState(comp)
  const compRow = registration.competition ?? comp
  const isCaptain = team && (team.members ?? []).some(m => m.user_id === user.id && (m.roles ?? []).includes('captain'))
  const payStatus = registration.payment_status ?? 'unpaid'
  const payPill = PAY_PILL[payStatus] ?? PAY_PILL.unpaid
  const amountOwing = Number(registration.amount_owing ?? 0)
  const amountPaid = Number(registration.amount_paid ?? 0)
  const cancelDisabled = ['paid', 'partial', 'overpaid'].includes(payStatus)

  return (
    <div className="bg-base text-white min-h-screen flex flex-col">
      <section
        className="relative py-16 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.07) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative max-w-3xl mx-auto px-6">
          <Link to={`/competitions/${comp.slug}`} className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to {comp.name}
          </Link>
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Your Hub</p>
          <h1 className="text-3xl md:text-4xl font-black text-white">{comp.name}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-3 text-white text-xs opacity-80">
            <span>{formatDateRange(comp.start_date, comp.end_date)}</span>
            <span className="opacity-30">·</span>
            <Pill tone={win.tone}>{win.label}</Pill>
          </div>
        </div>
      </section>

      <section className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-10">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm"><strong>Error:</strong> {error}</p>
          </div>
        )}

        {/* Section 1 — Registration */}
        <div>
          <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Your Registration</h2>
          <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="grid grid-cols-2 gap-4 mb-5">
              <Field label="Alias" value={profile?.alias ? `"${profile.alias}"` : null} />
              <Field
                label="Name"
                value={[profile?.first_name, profile?.last_name].filter(Boolean).join(' ')}
              />
              <Field label="Registered" value={relativeTime(registration.registered_at)} />
              <Field label="Payment status" value={<Pill tone={payPill.tone}>{payPill.label}</Pill>} />
            </div>

            <div className="border-t border-line pt-4">
              {cancelDisabled ? (
                <p className="text-white text-[11px] opacity-50">
                  You have already made a payment for this event. Contact the event organiser if you need to cancel.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  className="text-xs text-red-400 opacity-70 hover:opacity-100 transition-opacity"
                >
                  Cancel registration
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Section 2 — Team */}
        <div>
          <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">
            {team ? (isCaptain ? 'Your Team · Captain' : 'Your Team') : 'Your Team'}
          </h2>

          {team && isCaptain && (
            <CaptainTeamCard team={team} onSaved={updated => setTeam(updated ?? false)} />
          )}

          {team && !isCaptain && (
            <MemberTeamCard team={team} />
          )}

          {!team && (
            <div className="bg-surface border border-line rounded-2xl p-6 text-center">
              <p className="text-white font-bold mb-3">You're not on a team yet.</p>
              <button
                type="button"
                onClick={() => setCreateTeamOpen(true)}
                className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2 rounded-xl text-sm transition-all"
              >
                Create a team
              </button>
            </div>
          )}
        </div>

        {/* Section 3 — Payment */}
        <div>
          <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Payment</h2>
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-5">
            <div>
              <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-2">Payment reference</p>
              <p className="font-mono text-brand text-lg font-bold select-all">{registration.payment_reference ?? '-'}</p>
              <p className="text-white text-[11px] opacity-50 mt-1">Use this exact reference on your bank transfer.</p>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-line pt-4">
              <Field label="Amount owing" value={`$${amountOwing.toFixed(2)} AUD`} />
              {amountPaid > 0 && <Field label="Amount paid" value={`$${amountPaid.toFixed(2)} AUD`} />}
              <Field label="Status" value={<Pill tone={payPill.tone}>{payPill.label}</Pill>} />
            </div>

            <div className="border-t border-line pt-4">
              <p className="text-white text-xs font-bold uppercase tracking-wider opacity-50 mb-3">Bank details</p>
              {compRow.payment_info_visible ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Account name" value={compRow.bank_account_name} />
                    <Field label="BSB" value={compRow.bank_bsb} />
                    <Field label="Account number" value={compRow.bank_account_number} />
                  </div>
                  <p className="text-white text-[11px] opacity-50 mt-3">
                    Use the payment reference above when transferring.
                  </p>
                </>
              ) : (
                <p className="text-white text-sm opacity-70">
                  Payment details will be made available closer to the event by your event organiser.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <Footer />

      {/* Cancel registration confirm */}
      {cancelOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
            <p className="text-white font-bold mb-2">Cancel registration?</p>
            <p className="text-white text-sm mb-5 opacity-80">
              Cancel your registration for <span className="font-semibold">{comp.name}</span>?
              {team && isCaptain && (team.members ?? []).length > 1
                ? ' You will need to remove your team members or transfer captaincy first.'
                : ''}
            </p>
            {cancelError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{cancelError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelRegistration}
                disabled={cancelling}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                {cancelling ? 'Cancelling...' : 'Cancel registration'}
              </button>
              <button
                type="button"
                onClick={() => { setCancelOpen(false); setCancelError(null) }}
                disabled={cancelling}
                className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}

      {createTeamOpen && (
        <CreateTeamModal
          competitionId={comp.id}
          onClose={() => setCreateTeamOpen(false)}
          onCreated={created => {
            setTeam(created)
            setCreateTeamOpen(false)
            // Refetch the registration so its team_id is current.
            load()
          }}
        />
      )}
    </div>
  )
}
