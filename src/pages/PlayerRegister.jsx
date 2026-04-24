import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import Footer from '../components/Footer'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

export default function PlayerRegister() {
  const { year } = useParams()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [initialLoading, setInitialLoading] = useState(true)
  const [event, setEvent] = useState(null)
  const [existingReg, setExistingReg] = useState(null)

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

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user) return

    async function load() {
      const [{ data: ev }, { data: prof }, { data: reg }] = await Promise.all([
        supabase.from('zltac_events').select('id, name, year, status').eq('year', parseInt(year)).maybeSingle(),
        supabase.from('profiles').select('first_name, last_name, alias, dob, state').eq('id', user.id).single(),
        supabase.from('zltac_registrations').select('id, team_id').eq('user_id', user.id).eq('year', parseInt(year)).maybeSingle(),
      ])
      setEvent(ev)
      setExistingReg(reg)
      if (prof) {
        setFirstName(prof.first_name ?? '')
        setLastName(prof.last_name ?? '')
        setAlias(prof.alias ?? '')
        setDob(prof.dob ?? '')
        setState(prof.state ?? '')
      }
      setInitialLoading(false)
    }
    load()
  }, [authLoading, user, year, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) { setError('Full name is required.'); return }
    if (!dob) { setError('Date of birth is required.'); return }

    setSubmitting(true)
    setError('')

    // Trigger already created the profile row — just update it with form data
    const { error: profErr } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        alias: alias.trim() || null,
        dob: dob || null,
        state: state || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
      })
      .eq('id', user.id)
    if (profErr) {
      console.error('[PlayerRegister] Profile update failed:', profErr.message)
    }

    const { error: regError } = await supabase.from('zltac_registrations').upsert({
      user_id: user.id,
      year: parseInt(year),
      team_id: null,
      side_events: null,
      dinner_guests: 0,
      emergency_contact_name: emergencyName.trim() || null,
      emergency_contact_phone: emergencyPhone.trim() || null,
      status: 'pending',
    }, { onConflict: 'user_id,year' })

    setSubmitting(false)
    if (regError) { setError(regError.message); return }
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
        <p className="text-[#e5e5e5]/40 text-sm mb-6">Player registration for {event?.name ?? `ZLTAC ${year}`} is not currently open.</p>
        <Link to={`/events/${year}`} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
      </div>
    )
  }

  if (existingReg) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <div className="text-4xl mb-4">✓</div>
        <h1 className="text-2xl font-black text-white mb-2">Already Registered</h1>
        <p className="text-[#e5e5e5]/40 text-sm mb-6">You are already registered for ZLTAC {year}.</p>
        <Link to="/player-hub" className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all">
          Go to Player Hub →
        </Link>
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
          <p className="text-[#e5e5e5]/50 text-lg">Register for ZLTAC {year}</p>
        </div>
      </section>

      <section className="max-w-xl mx-auto px-6 py-16">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Personal details */}
          <div>
            <p className="text-brand text-xs font-bold uppercase tracking-wider mb-4">Your Details</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">First Name *</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Last Name *</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1">
                  Alias <span className="text-brand normal-case font-normal">— your in-game name</span>
                </label>
                <input
                  type="text"
                  value={alias}
                  onChange={e => setAlias(e.target.value)}
                  placeholder="e.g. DarkShot"
                  className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Date of Birth *</label>
                  <input
                    type="date"
                    value={dob}
                    onChange={e => setDob(e.target.value)}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">State / Territory</label>
                  <select
                    value={state}
                    onChange={e => setState(e.target.value)}
                    className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand transition-colors"
                  >
                    <option value="">Select…</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Emergency contact */}
          <div>
            <p className="text-brand text-xs font-bold uppercase tracking-wider mb-4">Emergency Contact <span className="text-[#e5e5e5]/30 font-normal normal-case">(optional)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Name</label>
                <input
                  type="text"
                  value={emergencyName}
                  onChange={e => setEmergencyName(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Phone</label>
                <input
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
              <p className="text-[#e5e5e5]/50 text-sm leading-relaxed">
                Once you have completed your player registration your captain will be able to add you to their team.
              </p>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold py-3.5 rounded-xl transition-all"
          >
            {submitting ? 'Registering…' : `Register for ZLTAC ${year}`}
          </button>

          <p className="text-center text-[#e5e5e5]/35 text-xs leading-relaxed">
            After registering you will complete side event selection, forms and payment in your Player Hub.
          </p>

          <Link to={`/events/${year}`} className="block text-center text-[#e5e5e5]/40 hover:text-white text-sm transition-colors">
            ← Back to event
          </Link>
        </form>
      </section>
      <Footer />
    </div>
  )
}
