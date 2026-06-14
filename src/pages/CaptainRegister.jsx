import { useState, useRef, useEffect, useId } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { eventPhase } from '../lib/eventPhase'
import Footer from '../components/Footer'
import { TEAM_COLOURS } from '../lib/teamColours'
import { RASTER_IMAGE_TYPES, extensionForMime } from '../lib/uploadPolicy'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

export default function CaptainRegister() {
  const { year } = useParams()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const uid = useId()

  const [step, setStep] = useState(1) // 1 = form, 2 = success
  const [submittedTeam, setSubmittedTeam] = useState(null)
  const [event, setEvent] = useState(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form fields
  const [teamName, setTeamName] = useState('')
  const [teamState, setTeamState] = useState('')
  const [homeVenue, setHomeVenue] = useState('')
  const [colour, setColour] = useState('#00E6FF')
  const [agreed, setAgreed] = useState(false)
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const logoRef = useRef()

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user) return

    async function load() {
      const [{ data: ev }, { data: existing }] = await Promise.all([
        supabase.from('zltac_events').select('id, name, year, status, reg_close_date, event_starts_at').eq('year', parseInt(year)).maybeSingle(),
        supabase.from('teams').select('id').eq('captain_id', user.id).not('event_id', 'is', null).maybeSingle(),
      ])
      setEvent(ev)
      if (existing) { navigate('/captain-hub'); return }
      setInitialLoading(false)
    }
    load()
  }, [authLoading, user, year, navigate])

  function handleLogoSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!RASTER_IMAGE_TYPES.includes(file.type)) {
      setError('Logo must be a PNG, JPEG, or WebP image.')
      e.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) { setError('Logo must be under 2MB.'); return }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!teamName.trim()) { setError('Team name is required.'); return }
    if (!teamState) { setError('Please select your home state.'); return }
    if (!agreed) { setError('You must agree to the captain responsibilities.'); return }

    setSaving(true)
    setError('')

    // The API resolves the event again inside the transaction. This local guard
    // prevents uploading a logo when the page failed to load an event.
    if (!event?.id) {
      setError('Could not find the ZLTAC event for this year.')
      setSaving(false)
      return
    }

    let logo_url = null
    let uploadedLogoPath = null
    if (logoFile) {
      const ext = extensionForMime(logoFile.type)
      const path = `${user.id}/${Date.now()}.${ext}`
      const { data: up, error: upErr } = await supabase.storage.from('team-logos').upload(path, logoFile, { upsert: true, contentType: logoFile.type })
      if (upErr) { setError(`Logo upload failed: ${upErr.message}`); setSaving(false); return }
      const { data: urlData } = supabase.storage.from('team-logos').getPublicUrl(up.path)
      logo_url = urlData.publicUrl
      uploadedLogoPath = up.path
    }

    try {
      const result = await apiFetch('/api/captain', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create-team',
          year: parseInt(year),
          name: teamName.trim(),
          state: teamState,
          homeVenue: homeVenue.trim() || null,
          colour,
          logoUrl: logo_url,
        }),
      })
      setSubmittedTeam(result.team)
      setStep(2)
    } catch (err) {
      if (uploadedLogoPath) {
        await supabase.storage.from('team-logos').remove([uploadedLogoPath])
      }
      setError(err?.message || 'Could not create the team. Please try again.')
    } finally {
      setSaving(false)
    }
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
        <p className="text-3xl mb-4">🚫</p>
        <h1 className="text-2xl font-black text-white mb-2">Registration Closed</h1>
        <p className="text-[#e5e5e5]/60 text-sm mb-6">Captain registration for {event?.name ?? `ZLTAC ${year}`} is not currently open.</p>
        <Link to={`/events/${year}`} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
      </div>
    )
  }

  // Team creation is locked once the event passes reg_close_date, even while
  // status is still 'open'. Server-side RLS blocks the team insert regardless;
  // this stops captains reaching the form.
  if (event && eventPhase(event) !== 'open') {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <p className="text-3xl mb-4">🔒</p>
        <h1 className="text-2xl font-black text-white mb-2">Registrations Locked</h1>
        <p className="text-[#e5e5e5]/60 text-sm mb-6">Team creation for {event?.name ?? `ZLTAC ${year}`} is locked. Contact the committee if you need to register a team.</p>
        <Link to={`/events/${year}`} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
      </div>
    )
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (step === 2 && submittedTeam) {
    return (
      <div className="min-h-screen bg-base text-white flex flex-col">
        <section className="flex-1 flex flex-col items-center justify-center px-6 py-20">
          <div className="max-w-lg w-full">
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-black text-2xl font-black mx-auto mb-5"
                style={{ background: '#00FF41' }}
              >✓</div>
              <h1 className="text-3xl font-black text-white mb-2">Team Submitted!</h1>
              <p className="text-[#e5e5e5]/60 max-w-sm mx-auto">
                Your team registration has been submitted for ZLTAC {year} approval.
              </p>
            </div>

            <div className="bg-surface border border-brand/20 rounded-2xl p-6 mb-5">
              <p className="text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-3">What's next</p>
              <p className="text-white text-sm leading-relaxed">
                Head to your Team Hub to build your roster. Use the search tool to find players who have signed up to the ALSA portal and registered for ZLTAC {year}, then add them to your team.
              </p>
            </div>

            <div className="bg-surface border border-yellow-500/20 rounded-xl px-4 py-3 mb-6">
              <p className="text-yellow-400 text-sm font-semibold">⏳ Awaiting ZLTAC committee approval</p>
              <p className="text-[#e5e5e5]/60 text-xs mt-1">You will be notified once your team has been approved.</p>
            </div>

            <Link
              to="/captain-hub"
              className="block w-full bg-brand hover:bg-brand-hover text-black font-bold py-3.5 rounded-xl text-center transition-all"
            >
              Go to Team Hub →
            </Link>
          </div>
        </section>
        <Footer />
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="bg-base text-white">
      <section
        className="relative py-20 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.06) 0%, transparent 60%), #0F0F0F' }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`, backgroundSize: '72px 72px' }} />
        <div className="relative text-center px-6">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">ZLTAC {year}</p>
          <div className="text-4xl mb-3">👑</div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-2">Captain Registration</h1>
          <p className="text-[#e5e5e5]/60 text-lg max-w-md mx-auto">Register your team for ZLTAC {year}</p>
        </div>
      </section>

      <section className="max-w-xl mx-auto px-6 py-16">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Team name */}
          <div>
            <label htmlFor={`${uid}-team-name`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Team Name *</label>
            <input
              id={`${uid}-team-name`}
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="e.g. Midnight Force"
              className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
            />
          </div>

          {/* State */}
          <div>
            <label htmlFor={`${uid}-home-state`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Home State / Territory *</label>
            <select
              id={`${uid}-home-state`}
              value={teamState}
              onChange={e => setTeamState(e.target.value)}
              className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand transition-colors"
            >
              <option value="">Select state…</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Home venue */}
          <div>
            <label htmlFor={`${uid}-home-venue`} className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">Home Venue / Arena</label>
            <input
              id={`${uid}-home-venue`}
              type="text"
              value={homeVenue}
              onChange={e => setHomeVenue(e.target.value)}
              placeholder="e.g. Zone300 Sydney"
              className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
            />
          </div>

          {/* Team colour */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-2">Team Colour</label>
            <div className="flex flex-wrap items-center gap-2">
              {TEAM_COLOURS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColour(c)}
                  className="w-8 h-8 rounded-full border-2 transition-all"
                  style={{ background: c, borderColor: colour === c ? '#fff' : 'transparent' }}
                />
              ))}
              <input
                type="color"
                value={colour}
                onChange={e => setColour(e.target.value)}
                className="w-8 h-8 rounded-full border border-line bg-surface cursor-pointer p-0.5"
                title="Custom colour"
              />
              <span className="text-xs text-[#e5e5e5]/60 font-mono ml-1">{colour}</span>
            </div>
          </div>

          {/* Logo upload */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5">
              Team Logo <span className="text-[#e5e5e5]/60 font-normal normal-case">(PNG, JPEG or WebP, max 2MB)</span>
            </label>
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoSelect} className="hidden" />
            {logoPreview ? (
              <div className="flex items-center gap-4">
                <img src={logoPreview} alt="Preview" className="h-16 w-16 object-contain rounded-xl border border-line bg-base p-1" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => logoRef.current.click()} className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/70 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">Change</button>
                  <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(null) }} className="text-xs text-red-400/60 hover:text-red-400 transition-colors">Remove</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => logoRef.current.click()} className="w-full border border-dashed border-line hover:border-brand rounded-xl py-6 text-center transition-colors group">
                <p className="text-[#e5e5e5]/60 group-hover:text-brand text-sm transition-colors">Click to upload team logo</p>
              </button>
            )}
          </div>

          {/* Agreement */}
          <div className="bg-surface border border-line rounded-xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-[#00FF41]" />
              <span className="text-[#e5e5e5]/70 text-sm leading-relaxed">
                I agree to manage this team's entry into ZLTAC {year} and ensure all players meet registration requirements before the event.
              </span>
            </label>
          </div>

          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold py-3.5 rounded-xl transition-all"
          >
            {saving ? 'Submitting…' : `Submit Team for ZLTAC ${year}`}
          </button>

          <Link to={`/events/${year}`} className="block text-center text-[#e5e5e5]/60 hover:text-white text-sm transition-colors">
            ← Back to event
          </Link>
        </form>
      </section>
      <Footer />
    </div>
  )
}
