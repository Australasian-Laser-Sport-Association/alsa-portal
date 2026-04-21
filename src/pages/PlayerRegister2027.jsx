import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { SIDE_EVENTS, DINNER_GUEST_PRICE, MAIN_EVENT_FEE, calcTotal, dollars } from '../lib/pricing'

const EVENT_YEAR = 2027

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current }) {
  const steps = ['Select Team', 'Side Events', 'Dinner', 'Confirm']
  return (
    <div className="flex items-center mb-10 overflow-x-auto pb-1">
      {steps.map((label, i) => {
        const num = i + 1
        const done = num < current
        const active = num === current
        return (
          <div key={label} className="flex items-center flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0
                ${done ? 'bg-brand text-black' : active ? 'bg-brand text-black' : 'bg-line text-[#e5e5e5]/40'}`}>
                {done ? '✓' : num}
              </div>
              <span className={`text-sm whitespace-nowrap ${active ? 'text-white font-semibold' : done ? 'text-brand' : 'text-[#e5e5e5]/35'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-3 h-px w-6 flex-shrink-0 ${done ? 'bg-brand' : 'bg-line'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Side event card ──────────────────────────────────────────────────────────

function SideEventCard({ event, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(event.slug)}
      className={`w-full text-left rounded-xl border p-5 transition-all
        ${selected
          ? 'bg-brand/10 border-brand shadow-[0_0_14px_rgba(0,255,65,0.12)]'
          : 'bg-base border-line hover:border-[#374056]'
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-sm font-bold ${selected ? 'text-brand' : 'text-white'}`}>{event.name}</span>
            {event.highlight && (
              <span className="text-[10px] bg-brand text-black px-2 py-0.5 rounded-full font-black uppercase tracking-wide">
                Featured
              </span>
            )}
          </div>
          <p className="text-[#e5e5e5]/50 text-xs leading-relaxed">{event.desc}</p>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`text-sm font-bold ${selected ? 'text-brand' : 'text-[#e5e5e5]/60'}`}>
            {dollars(event.price)}
          </span>
          <div className={`w-5 h-5 rounded border flex items-center justify-center text-xs font-bold transition-colors
            ${selected ? 'bg-brand border-brand text-black' : 'border-line'}`}>
            {selected ? '✓' : ''}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PlayerRegister2027() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)

  // Step 1 state
  const [inviteCode, setInviteCode] = useState('')
  const [team, setTeam] = useState(null)
  const [sideEventsOnly, setSideEventsOnly] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState('')

  // Step 2 state
  const [selected, setSelected] = useState(new Set())

  // Step 3 state
  const [dinnerGuests, setDinnerGuests] = useState(0)

  // Step 4 state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) navigate('/login')
  }, [authLoading, user, navigate])

  // Load any existing registration
  useEffect(() => {
    if (!user) return
    supabase
      .from('zltac_registrations')
      .select('*, teams(id, name)')
      .eq('player_id', user.id)
      .eq('event_year', EVENT_YEAR)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        if (data.teams) setTeam(data.teams)
        else setSideEventsOnly(true)
        setSelected(new Set(data.side_events ?? []))
        setDinnerGuests(data.dinner_guests ?? 0)
      })
  }, [user])

  async function lookupTeam() {
    if (!inviteCode.trim()) return
    setLookingUp(true)
    setLookupError('')
    setTeam(null)
    const { data, error } = await supabase
      .from('teams')
      .select('id, name, logo_url')
      .eq('invite_code', inviteCode.trim().toUpperCase())
      .eq('event_year', EVENT_YEAR)
      .maybeSingle()
    if (error || !data) {
      setLookupError('Team not found. Double-check your invite code with your captain.')
    } else {
      setTeam(data)
    }
    setLookingUp(false)
  }

  function toggleSideEvent(slug) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(slug) ? next.delete(slug) : next.add(slug)
      return next
    })
  }

  async function handleConfirm() {
    setSubmitError('')
    setSubmitting(true)
    const { error } = await supabase.from('zltac_registrations').upsert({
      player_id: user.id,
      event_year: EVENT_YEAR,
      team_id: team?.id ?? null,
      side_events: [...selected],
      dinner_guests: dinnerGuests,
      status: 'pending',
      updated_at: new Date().toISOString(),
    })
    if (error) {
      setSubmitError(error.message)
      setSubmitting(false)
      return
    }
    navigate('/zltac/2027/player-hub')
  }

  const canProceedStep1 = team !== null || sideEventsOnly
  const selectedSlugs = [...selected]
  const total = calcTotal(selectedSlugs, dinnerGuests)
  const selectedEvents = SIDE_EVENTS.filter(e => selected.has(e.slug))

  if (authLoading || !user) return null

  return (
    <div className="min-h-screen bg-base text-white py-10 px-6">
      <div className="max-w-xl mx-auto">

        {/* Page header */}
        <div className="mb-8">
          <Link to="/zltac/2027" className="text-[#e5e5e5]/40 hover:text-brand text-xs transition-colors mb-3 inline-block">
            ← ZLTAC 2027
          </Link>
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-1">ZLTAC 2027</p>
          <h1 className="text-2xl font-black text-white">Register as a Player</h1>
        </div>

        <StepIndicator current={step} />

        {/* ── Step 1: Select Team ── */}
        {step === 1 && (
          <div>
            <h2 className="text-white font-bold text-lg mb-1">Select your team</h2>
            <p className="text-[#e5e5e5]/50 text-sm mb-6">Enter your team invite code, or register for side events only.</p>

            {/* Option A: Invite code */}
            <div className={`rounded-xl border p-5 mb-4 transition-all ${team ? 'border-brand/40 bg-brand/5' : 'border-line bg-surface'}`}>
              <p className="text-white font-semibold text-sm mb-3">Enter team invite code</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => { setInviteCode(e.target.value.toUpperCase()); setTeam(null); setLookupError('') }}
                  placeholder="e.g. ALPHA7"
                  disabled={sideEventsOnly}
                  className="flex-1 bg-base text-white rounded-lg px-4 py-2 border border-line focus:outline-none focus:border-brand text-sm font-mono uppercase disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={lookupTeam}
                  disabled={!inviteCode.trim() || lookingUp || sideEventsOnly}
                  className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  {lookingUp ? '…' : 'Find'}
                </button>
              </div>
              {lookupError && <p className="text-red-400 text-xs mt-2">{lookupError}</p>}
              {team && (
                <div className="flex items-center gap-3 mt-3 p-3 bg-brand/10 border border-brand/30 rounded-lg">
                  {team.logo_url
                    ? <img src={team.logo_url} alt="Team logo" className="w-10 h-10 rounded-lg object-cover" />
                    : <div className="w-10 h-10 rounded-lg bg-line flex items-center justify-center text-[#e5e5e5]/40 text-xs font-bold">LOGO</div>
                  }
                  <div>
                    <p className="text-brand font-bold text-sm">{team.name}</p>
                    <p className="text-[#e5e5e5]/50 text-xs">Team found ✓</p>
                  </div>
                </div>
              )}
            </div>

            {/* Option B: Side events only */}
            <button
              type="button"
              onClick={() => { setSideEventsOnly(v => !v); if (!sideEventsOnly) { setTeam(null); setInviteCode(''); setLookupError('') } }}
              className={`w-full rounded-xl border p-5 text-left transition-all ${sideEventsOnly ? 'border-brand/40 bg-brand/5' : 'border-line bg-surface hover:border-[#374056]'}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded border flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors
                  ${sideEventsOnly ? 'bg-brand border-brand text-black' : 'border-line'}`}>
                  {sideEventsOnly ? '✓' : ''}
                </div>
                <div>
                  <p className={`font-semibold text-sm ${sideEventsOnly ? 'text-brand' : 'text-white'}`}>
                    I'm not joining a team — side events only
                  </p>
                  <p className="text-[#e5e5e5]/40 text-xs mt-0.5">Register for individual side events without a team entry.</p>
                </div>
              </div>
            </button>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-colors"
              >
                Next: Side Events →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Side Events ── */}
        {step === 2 && (
          <div>
            <h2 className="text-white font-bold text-lg mb-1">Select your side events</h2>
            <p className="text-[#e5e5e5]/50 text-sm mb-6">Choose any side events you'd like to enter. Each is priced separately.</p>

            <div className="flex flex-col gap-3 mb-6">
              {SIDE_EVENTS.map(event => (
                <SideEventCard key={event.slug} event={event} selected={selected.has(event.slug)} onToggle={toggleSideEvent} />
              ))}
            </div>

            {/* Running total */}
            <div className="bg-surface border border-line rounded-xl px-5 py-4 flex items-center justify-between mb-6">
              <span className="text-[#e5e5e5]/60 text-sm">Side events total</span>
              <span className="text-white font-bold">{dollars(calcTotal(selectedSlugs, 0))}</span>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="bg-line hover:bg-[#374056] text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-colors">
                ← Back
              </button>
              <button onClick={() => setStep(3)} className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-colors">
                Next: Dinner →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Presentation Dinner ── */}
        {step === 3 && (
          <div>
            <h2 className="text-white font-bold text-lg mb-1">Presentation dinner</h2>
            <p className="text-[#e5e5e5]/50 text-sm mb-6">
              All registered players are included in the presentation dinner at no extra cost.
            </p>

            <div className="bg-brand/10 border border-brand/30 rounded-xl p-5 mb-6">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-brand">✓</span>
                <p className="text-brand font-semibold text-sm">Your dinner seat is included</p>
              </div>
              <p className="text-[#e5e5e5]/50 text-xs">All registered ZLTAC 2027 players receive a complimentary seat at the presentation dinner.</p>
            </div>

            <div className="bg-surface border border-line rounded-xl p-5 mb-6">
              <p className="text-white font-semibold text-sm mb-1">Additional guests</p>
              <p className="text-[#e5e5e5]/50 text-xs mb-4">Bring additional guests to the dinner. Each additional guest is {dollars(DINNER_GUEST_PRICE)}.</p>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setDinnerGuests(v => Math.max(0, v - 1))}
                  className="w-9 h-9 rounded-lg bg-line hover:bg-[#374056] text-white font-bold text-lg transition-colors flex items-center justify-center"
                >
                  −
                </button>
                <span className="text-white font-black text-2xl w-8 text-center tabular-nums">{dinnerGuests}</span>
                <button
                  type="button"
                  onClick={() => setDinnerGuests(v => Math.min(5, v + 1))}
                  className="w-9 h-9 rounded-lg bg-line hover:bg-[#374056] text-white font-bold text-lg transition-colors flex items-center justify-center"
                >
                  +
                </button>
                <span className="text-[#e5e5e5]/40 text-sm ml-2">
                  {dinnerGuests > 0 ? `${dollars(dinnerGuests * DINNER_GUEST_PRICE)} total` : 'No additional guests'}
                </span>
              </div>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className="bg-line hover:bg-[#374056] text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-colors">
                ← Back
              </button>
              <button onClick={() => setStep(4)} className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-colors">
                Review Entry →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Confirm ── */}
        {step === 4 && (
          <div>
            <h2 className="text-white font-bold text-lg mb-1">Confirm your registration</h2>
            <p className="text-[#e5e5e5]/50 text-sm mb-6">Review your entry below before confirming.</p>

            {/* Summary */}
            <div className="bg-surface border border-line rounded-xl overflow-hidden mb-5">
              <div className="px-5 py-4 border-b border-line">
                <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-2">Team</p>
                <p className="text-white font-semibold text-sm">
                  {team ? team.name : 'Side events only — no team'}
                </p>
              </div>

              {selectedEvents.length > 0 ? (
                <div className="px-5 py-4 border-b border-line">
                  <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-2">Side Events</p>
                  <div className="flex flex-col gap-2">
                    {selectedEvents.map(e => (
                      <div key={e.slug} className="flex justify-between items-center">
                        <span className="text-white text-sm">{e.name}</span>
                        <span className="text-[#e5e5e5]/60 text-sm">{dollars(e.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="px-5 py-4 border-b border-line">
                  <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-1">Side Events</p>
                  <p className="text-[#e5e5e5]/40 text-sm">None selected</p>
                </div>
              )}

              <div className="px-5 py-4 border-b border-line">
                <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-2">Presentation Dinner</p>
                <div className="flex justify-between items-center">
                  <span className="text-white text-sm">Your seat (included)</span>
                  <span className="text-brand text-sm font-semibold">Free</span>
                </div>
                {dinnerGuests > 0 && (
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-white text-sm">{dinnerGuests} additional guest{dinnerGuests > 1 ? 's' : ''}</span>
                    <span className="text-[#e5e5e5]/60 text-sm">{dollars(dinnerGuests * DINNER_GUEST_PRICE)}</span>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 bg-brand/5 flex justify-between items-center">
                <span className="text-white font-bold text-sm">Total</span>
                <span className="text-brand font-black text-lg">{dollars(total)}</span>
              </div>
            </div>

            {/* CoC notice */}
            <div className="bg-brand/10 border border-brand/30 rounded-xl p-5 mb-5">
              <p className="text-brand font-bold text-sm mb-2">⚠ Important — registration confirmation</p>
              <p className="text-[#e5e5e5]/70 text-xs leading-relaxed">
                You will need to complete the <strong className="text-white">Code of Conduct</strong> and the{' '}
                <strong className="text-white">Referee Test</strong> for your player registration to be fully confirmed.
                ZLTAC has the final say in all player registrations.
              </p>
            </div>

            {submitError && (
              <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/30 rounded-xl px-4 py-3 mb-4">
                {submitError}
              </p>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(3)} className="bg-line hover:bg-[#374056] text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-colors">
                ← Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-black px-8 py-2.5 rounded-xl text-sm transition-all hover:shadow-[0_0_16px_rgba(0,255,65,0.4)]"
              >
                {submitting ? 'Confirming…' : 'Confirm Registration'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
