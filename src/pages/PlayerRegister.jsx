import { useState, useEffect, useRef, useId } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { recomputeOwing } from '../lib/recomputeOwing'
import { eventPhase } from '../lib/eventPhase'
import Footer from '../components/Footer'
import VolunteerSection from '../components/VolunteerSection'
import PlaceholderClaimPrompt from '../components/PlaceholderClaimPrompt.jsx'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

export default function PlayerRegister() {
  const { year } = useParams()
  // Form prefill reads the profile from AuthContext (already holds the full
  // row) instead of re-querying it; the effect waits for profileLoading so the
  // prefill runs once the context profile is resolved.
  const { user, loading: authLoading, profile, profileLoading } = useAuth()
  const navigate = useNavigate()
  const uid = useId()

  const [initialLoading, setInitialLoading] = useState(true)
  const [event, setEvent] = useState(null)
  const [existingReg, setExistingReg] = useState(null)
  const [aliasLocked, setAliasLocked] = useState(false)

  // Form fields (pre-filled from profile)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [alias, setAlias] = useState('')
  const [dob, setDob] = useState('')
  const [state, setState] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Volunteer opt-in is held locally by VolunteerSection and reported up here;
  // it's persisted after the registration row is created (below).
  const volunteerRef = useRef({ isVolunteering: false, role_ids: [], notes: '' })

  // Chunk 2: ref to the shared claim prompt so we can imperatively open the
  // modal when the server precheck returns a 'placeholder_exists' conflict.
  const claimPromptRef = useRef(null)

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user || profileLoading) return

    async function load() {
      const [{ data: ev }, { data: reg }] = await Promise.all([
        supabase.from('zltac_events').select('id, name, year, status, reg_close_date, event_starts_at').eq('year', parseInt(year)).maybeSingle(),
        supabase.from('zltac_registrations').select('id, team_id').eq('user_id', user.id).eq('year', parseInt(year)).maybeSingle(),
      ])
      setEvent(ev)
      setExistingReg(reg)
      if (profile) {
        setFirstName(profile.first_name ?? '')
        setLastName(profile.last_name ?? '')
        setAlias(profile.alias ?? '')
        setDob(profile.dob ?? '')
        setState(profile.state ?? '')
      }

      // Alias lock (mirrors the enforce_alias_lock trigger): a player who has
      // registered for ANY competition (ZLTAC any year OR a competition) can no
      // longer change their alias here. Reuse this year's registration if found,
      // else lightweight head/count checks across both tables keyed on user_id.
      let locked = !!reg
      if (!locked) {
        const [{ count: zCount }, { count: cCount }] = await Promise.all([
          supabase.from('zltac_registrations').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('competition_registrations').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        ])
        locked = (zCount ?? 0) > 0 || (cCount ?? 0) > 0
      }
      setAliasLocked(locked)

      setInitialLoading(false)
    }
    load()
  }, [authLoading, user, year, navigate, profile, profileLoading])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) { setError('Full name is required.'); return }
    if (!dob) { setError('Date of birth is required.'); return }
    if (volunteerRef.current.isVolunteering && !(volunteerRef.current.role_ids?.length)) {
      setError('Select at least one volunteer role, or turn off volunteering.'); return
    }

    setSubmitting(true)
    setError('')

    // Server-side precheck: cap-check for max_players AND placeholder-alias
    // collision detection (Chunk 2). The precheck returns ok:false +
    // placeholder_id when there's already a placeholder registration with this
    // caller's alias; we surface the claim modal directly so the user can
    // absorb it instead of hitting the payment_reference UNIQUE constraint at
    // insert time. The ok:true / 4xx error paths are unchanged.
    try {
      const pre = await apiFetch('/api/player?resource=registration', {
        method: 'POST',
        body: JSON.stringify({ action: 'precheck-register', year: parseInt(year) }),
      })
      if (pre?.ok === false && pre.error === 'placeholder_exists' && pre.placeholder_id) {
        setSubmitting(false)
        setError(pre.message || 'A registration with this alias already exists for this event. If that\'s you, claim it via the banner above or check your Player Hub.')
        if (claimPromptRef.current?.openForPlaceholder) {
          claimPromptRef.current.openForPlaceholder(pre.placeholder_id)
        }
        return
      }
    } catch (err) {
      setSubmitting(false)
      setError(err?.message || 'Could not start registration. Please try again.')
      return
    }

    // Trigger already created the profile row — just update it with form data
    const profileUpdate = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      dob: dob || null,
      emergency_contact_name: emergencyName.trim() || null,
      emergency_contact_phone: emergencyPhone.trim() || null,
    }
    // Alias is locked once the player has registered for any competition. Omit
    // it so this update never trips enforce_alias_lock; the existing alias is
    // carried forward unchanged. State/territory is locked the same way.
    if (!aliasLocked) profileUpdate.alias = alias.trim() || null
    if (!aliasLocked) profileUpdate.state = state || null
    const { error: profErr } = await supabase
      .from('profiles')
      .update(profileUpdate)
      .eq('id', user.id)
    if (profErr) {
      // 23505 = the lower(alias) unique index: the chosen alias is taken. Stop
      // and let the player pick another instead of silently dropping it and
      // proceeding with the registration.
      if (profErr.code === '23505') {
        setSubmitting(false)
        setError('That alias is already taken, please choose another.')
        return
      }
      console.error('[PlayerRegister] Profile update failed:', profErr.message)
    }

    const { data: regRow, error: regError } = await supabase.from('zltac_registrations').upsert({
      user_id: user.id,
      year: parseInt(year),
      team_id: null,
      side_events: null,
      dinner_guests: 0,
      emergency_contact_name: emergencyName.trim() || null,
      emergency_contact_phone: emergencyPhone.trim() || null,
      status: 'pending',
    }, { onConflict: 'user_id,year' }).select('id').single()

    if (regError) {
      setSubmitting(false)
      // Friendly catch for the payment_reference UNIQUE collision (a
      // placeholder with the same alias has a registration in this year). The
      // precheck above should usually catch this first, but a race between
      // precheck and insert could still let it through — fall back to a
      // human-readable error and keep the claim banner visible.
      const code = regError.code
      const msg = regError.message ?? ''
      if (code === '23505' || msg.includes('zltac_registrations_payment_reference_key')) {
        setError('A registration with this alias already exists for this event. If that\'s you, claim it via the banner above or check your Player Hub.')
        return
      }
      setError(regError.message)
      return
    }
    if (regRow?.id) await recomputeOwing(regRow.id)

    // Persist volunteer opt-in now the registration row exists. Non-fatal:
    // registration already succeeded, and the Player Hub lets them retry.
    if (regRow?.id && volunteerRef.current.isVolunteering && volunteerRef.current.role_ids?.length) {
      try {
        await apiFetch(`/api/volunteer-signup?registration_id=${regRow.id}`, {
          method: 'PUT',
          body: JSON.stringify({ role_ids: volunteerRef.current.role_ids, notes: volunteerRef.current.notes }),
        })
      } catch (err) {
        console.error('[PlayerRegister] volunteer signup failed:', err)
      }
    }

    setSubmitting(false)
    navigate(`/player-hub`)
  }

  if (authLoading || initialLoading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (event && event.status !== 'open') {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <h1 className="text-2xl font-black text-white mb-2">Registration Closed</h1>
        <p className="text-[#e5e5e5]/60 text-sm mb-6">Player registration for {event?.name ?? `ZLTAC ${year}`} is not currently open.</p>
        <Link to={`/events/${year}`} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
      </div>
    )
  }

  if (existingReg) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <div className="text-4xl mb-4">✓</div>
        <h1 className="text-2xl font-black text-white mb-2">Already Registered</h1>
        <p className="text-[#e5e5e5]/60 text-sm mb-6">You are already registered for ZLTAC {year}.</p>
        <Link to="/player-hub" className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all">
          Go to Player Hub →
        </Link>
      </div>
    )
  }

  // Registration is locked once the event passes reg_close_date, even while
  // status is still 'open'. Server-side RLS blocks the insert regardless; this
  // stops players reaching the form. New registrations only (existing players
  // are handled above and keep their Player Hub access).
  if (event && eventPhase(event) !== 'open') {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <div className="text-4xl mb-4">🔒</div>
        <h1 className="text-2xl font-black text-white mb-2">Registrations Locked</h1>
        <p className="text-[#e5e5e5]/60 text-sm mb-6">Registrations for {event?.name ?? `ZLTAC ${year}`} are locked. Contact the committee if you need to register.</p>
        <Link to={`/events/${year}`} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
      </div>
    )
  }

  return (
    <div className="bg-base text-white">
      <section
        className="relative py-20 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.06) 0%, transparent 60%), #0F0F0F' }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`, backgroundSize: '72px 72px' }} />
        <div className="relative text-center px-6">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">ZLTAC {year}</p>
          <div className="text-4xl mb-3">🎯</div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-2">Player Registration</h1>
          <p className="text-[#e5e5e5]/60 text-lg">Register for ZLTAC {year}</p>
        </div>
      </section>

      <section className="max-w-xl mx-auto px-6 py-16">
        {/* Chunk 2 placeholder-claim prompt. Shows above the form when the
            committee has already created a placeholder matching this user's
            alias or email; claiming redirects to the Player Hub. */}
        {user && (
          <PlaceholderClaimPrompt
            ref={claimPromptRef}
            userId={user.id}
            onClaimed={() => navigate('/player-hub')}
          />
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Personal details */}
          <div>
            <p className="text-brand text-xs font-bold uppercase tracking-wider mb-4">Your Details</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${uid}-first-name`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">First Name *</label>
                  <input
                    id={`${uid}-first-name`}
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-last-name`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Last Name *</label>
                  <input
                    id={`${uid}-last-name`}
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor={`${uid}-alias`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1">
                  Alias <span className="text-brand normal-case font-normal">— your in-game name</span>
                </label>
                <input
                  id={`${uid}-alias`}
                  type="text"
                  value={alias}
                  onChange={e => setAlias(e.target.value)}
                  placeholder="e.g. DarkShot"
                  disabled={aliasLocked}
                  readOnly={aliasLocked}
                  className={`w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors ${aliasLocked ? 'text-white/60 cursor-not-allowed' : 'text-white'}`}
                />
                {aliasLocked && (
                  <p className="text-xs text-white/60 mt-1.5">Your alias is locked because you have registered for a competition. Contact the committee to change it.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${uid}-dob`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Date of Birth *</label>
                  <input
                    id={`${uid}-dob`}
                    type="date"
                    value={dob}
                    onChange={e => setDob(e.target.value)}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor={`${uid}-state`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">State / Territory</label>
                  <select
                    id={`${uid}-state`}
                    value={state}
                    onChange={e => setState(e.target.value)}
                    disabled={aliasLocked}
                    className={`w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-brand transition-colors ${aliasLocked ? 'text-white/60 cursor-not-allowed' : 'text-white'}`}
                  >
                    <option value="">Select…</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {aliasLocked && (
                    <p className="text-xs text-white/60 mt-1.5">Your state/territory is locked because you have registered for a competition. Contact the committee to change it.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Emergency contact */}
          <div>
            <p className="text-brand text-xs font-bold uppercase tracking-wider mb-4">Emergency Contact <span className="text-[#e5e5e5]/60 font-normal normal-case">(optional)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-ec-name`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Name</label>
                <input
                  id={`${uid}-ec-name`}
                  type="text"
                  value={emergencyName}
                  onChange={e => setEmergencyName(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                />
              </div>
              <div>
                <label htmlFor={`${uid}-ec-phone`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Phone</label>
                <input
                  id={`${uid}-ec-phone`}
                  type="tel"
                  value={emergencyPhone}
                  onChange={e => setEmergencyPhone(e.target.value)}
                  placeholder="04XX XXX XXX"
                  className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Team */}
          <div>
            <p className="text-brand text-xs font-bold uppercase tracking-wider mb-3">Team</p>
            <div
              className="rounded-xl px-4 py-3 bg-surface border border-line"
              style={{ borderLeftColor: '#00FF41', borderLeftWidth: '3px' }}
            >
              <p className="text-[#e5e5e5]/60 text-sm leading-relaxed">
                Once you have completed your player registration your captain will be able to add you to their team.
              </p>
            </div>
          </div>

          {/* Volunteering — held locally; persisted after the registration row
              is created in handleSubmit. */}
          {event?.id && (
            <VolunteerSection
              mode="registration"
              eventId={event.id}
              registrationId={null}
              teamId={null}
              onChange={v => { volunteerRef.current = v }}
            />
          )}

          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold py-3.5 rounded-xl transition-all"
          >
            {submitting ? 'Registering…' : `Register for ZLTAC ${year}`}
          </button>

          <p className="text-center text-[#e5e5e5]/60 text-xs leading-relaxed">
            After registering you will complete side event selection, forms and payment in your Player Hub.
          </p>

          <Link to={`/events/${year}`} className="block text-center text-[#e5e5e5]/60 hover:text-white text-sm transition-colors">
            ← Back to event
          </Link>
        </form>
      </section>
      <Footer />
    </div>
  )
}
