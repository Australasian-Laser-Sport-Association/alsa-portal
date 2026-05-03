import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import Footer from '../components/Footer'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']
const TEAM_COLOURS = ['#00E6FF', '#FF3B30', '#0A84FF', '#FF9F0A', '#BF5AF2', '#FF375F', '#30D158', '#64D2FF']

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function CaptainRegister() {
  const { year } = useParams()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1) // 1 = form, 2 = success
  const [submittedTeam, setSubmittedTeam] = useState(null)
  const [event, setEvent] = useState(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copyDone, setCopyDone] = useState(false)

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
        supabase.from('zltac_events').select('id, name, year, status').eq('year', parseInt(year)).maybeSingle(),
        supabase.from('teams').select('id').eq('captain_id', user.id).maybeSingle(),
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

    let logo_url = null
    if (logoFile) {
      const ext = logoFile.name.split('.').pop()
      const path = `${user.id}/${Date.now()}.${ext}`
      const { data: up, error: upErr } = await supabase.storage.from('team-logos').upload(path, logoFile, { upsert: true })
      if (upErr) { setError(`Logo upload failed: ${upErr.message}`); setSaving(false); return }
      const { data: urlData } = supabase.storage.from('team-logos').getPublicUrl(up.path)
      logo_url = urlData.publicUrl
    }

    const invite_code = generateInviteCode()

    const { data: newTeam, error: insertError } = await supabase.from('teams').insert({
      name: teamName.trim(),
      captain_id: user.id,
      status: 'pending',
      state: teamState,
      home_venue: homeVenue.trim() || null,
      colour,
      logo_url,
      invite_code,
      invite_active: true,
    }).select().single()

    if (insertError) { setError(insertError.message); setSaving(false); return }

    // Register the captain as a player on their own team
    await supabase.from('zltac_registrations').upsert({
      user_id: user.id,
      year: parseInt(year),
      team_id: newTeam.id,
      side_events: null,
      status: 'pending',
    }, { onConflict: 'user_id,year' })

    // Phase B.3a dual-write: populate unified teams schema alongside legacy.
    try {
      if (event?.id) {
        const { error: teamUpdateErr } = await supabase.from('teams').update({
          manager_id: user.id,
          format: 'team',
          event_id: event.id,
        }).eq('id', newTeam.id)
        if (teamUpdateErr) console.error('[CaptainRegister] dual-write teams update failed:', teamUpdateErr.message)
      }
      const { error: memberErr } = await supabase.from('team_members').insert({
        team_id: newTeam.id,
        user_id: user.id,
        roles: ['manager', 'captain', 'player'],
        invite_status: 'accepted',
        responded_at: new Date().toISOString(),
      })
      if (memberErr) console.error('[CaptainRegister] dual-write team_members insert failed:', memberErr.message)
    } catch (err) {
      console.error('[CaptainRegister] dual-write threw:', err)
    }

    setSaving(false)
    setSubmittedTeam(newTeam)
    setStep(2)
  }

  function copyInviteLink() {
    if (!submittedTeam) return
    const url = `${window.location.origin}/join/${submittedTeam.invite_code}`
    navigator.clipboard.writeText(url)
    setCopyDone(true)
    setTimeout(() => setCopyDone(false), 2000)
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
        <p className="text-[#e5e5e5]/40 text-sm mb-6">Captain registration for {event?.name ?? `ZLTAC ${year}`} is not currently open.</p>
        <Link to={`/events/${year}`} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
      </div>
    )
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (step === 2 && submittedTeam) {
    const inviteUrl = `${window.location.origin}/join/${submittedTeam.invite_code}`
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
              <p className="text-[#e5e5e5]/50 max-w-sm mx-auto">
                Your team registration has been submitted for ZLTAC {year} approval.
              </p>
            </div>

            <div className="bg-surface border border-brand/20 rounded-2xl p-6 mb-5">
              <p className="text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-3">Team Invite Link</p>
              <div className="flex items-center gap-2 bg-base border border-line rounded-xl px-4 py-3 mb-3">
                <span className="text-brand text-sm font-mono flex-1 break-all">{inviteUrl}</span>
                <button
                  onClick={copyInviteLink}
                  className="text-xs bg-brand/10 hover:bg-brand/20 text-brand font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                >
                  {copyDone ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-[#e5e5e5]/40 text-xs leading-relaxed">
                Share this link with your players. Once approved by the ZLTAC committee, players can join your team using this link.
              </p>
            </div>

            <div className="bg-surface border border-yellow-500/20 rounded-xl px-4 py-3 mb-6">
              <p className="text-yellow-400 text-sm font-semibold">⏳ Awaiting ZLTAC committee approval</p>
              <p className="text-[#e5e5e5]/40 text-xs mt-1">You will be notified once your team has been approved.</p>
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
          <p className="text-[#e5e5e5]/50 text-lg max-w-md mx-auto">Register your team for ZLTAC {year}</p>
        </div>
      </section>

      <section className="max-w-xl mx-auto px-6 py-16">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Team name */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Team Name *</label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="e.g. Midnight Force"
              className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
            />
          </div>

          {/* State */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Home State / Territory *</label>
            <select
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
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Home Venue / Arena</label>
            <input
              type="text"
              value={homeVenue}
              onChange={e => setHomeVenue(e.target.value)}
              placeholder="e.g. Zone300 Sydney"
              className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
            />
          </div>

          {/* Team colour */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-2">Team Colour</label>
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
              <span className="text-xs text-[#e5e5e5]/40 font-mono ml-1">{colour}</span>
            </div>
          </div>

          {/* Logo upload */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">
              Team Logo <span className="text-[#e5e5e5]/30 font-normal normal-case">(PNG or JPG, max 2MB)</span>
            </label>
            <input ref={logoRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoSelect} className="hidden" />
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
                <p className="text-[#e5e5e5]/30 group-hover:text-brand text-sm transition-colors">Click to upload team logo</p>
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

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold py-3.5 rounded-xl transition-all"
          >
            {saving ? 'Submitting…' : `Submit Team for ZLTAC ${year}`}
          </button>

          <Link to={`/events/${year}`} className="block text-center text-[#e5e5e5]/40 hover:text-white text-sm transition-colors">
            ← Back to event
          </Link>
        </form>
      </section>
      <Footer />
    </div>
  )
}
