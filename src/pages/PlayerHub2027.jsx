import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { SIDE_EVENTS, SIDE_PRICES, DINNER_GUEST_PRICE, MAIN_EVENT_FEE, calcTotal, dollars } from '../lib/pricing'

const EVENT_YEAR = 2027

const CODE_OF_CONDUCT = `ZLTAC 2027 — Code of Conduct

1. RESPECT
All participants must treat fellow competitors, officials, venue staff, and spectators with respect and courtesy at all times. Disrespectful, aggressive, or threatening behaviour will not be tolerated.

2. FAIR PLAY
All participants must compete honestly and in the spirit of the game. Deliberate cheating, exploitation of equipment faults, or any form of unsporting behaviour will result in immediate disqualification from the event.

3. COMPLIANCE WITH RULES
All participants must compete in accordance with the official ZLTAC 2027 rules as published by the Australasian Laser Sport Association. Ignorance of the rules is not a valid excuse.

4. BEHAVIOUR AT VENUE
Participants must comply with all venue rules and follow instructions from venue staff and ZLTAC officials at all times. Damage to venue property will be the financial responsibility of the participant.

5. ONLINE CONDUCT
Participants must not post defamatory, offensive, discriminatory, or harassing content relating to other participants, teams, officials, or ALSA in any online forum or social media channel.

6. ALCOHOL & PROHIBITED SUBSTANCES
Participants must not compete while under the influence of alcohol or prohibited substances. Participants found to be impaired will be immediately disqualified.

7. ACCEPTANCE OF DECISIONS
The decisions of ZLTAC officials and the ALSA committee are final. Disputes must be raised through the official protest process as outlined in the ZLTAC rules. Public complaints or appeals made outside this process will not be considered.

8. REGISTRATION ACCURACY
All registration information must be accurate and truthful. Providing false or misleading information may result in disqualification and permanent suspension from ALSA events.

9. PHOTOGRAPHY & MEDIA
By participating in ZLTAC 2027, participants consent to being photographed and filmed for ALSA's promotional and archival purposes.

10. CONSEQUENCES
Breach of this Code of Conduct may result in warnings, point deductions, disqualification, or permanent bans at the sole discretion of the ALSA committee.

By signing below, I confirm that I have read, understood, and agree to abide by this Code of Conduct for the duration of ZLTAC 2027 and all associated events.`

function ChecklistItem({ done, pending, label, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => children && setOpen(v => !v)}
        className={`w-full flex items-center gap-4 px-5 py-4 text-left ${children ? 'hover:bg-line/30 transition-colors' : ''}`}
      >
        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
          ${done ? 'bg-brand text-black' : pending ? 'bg-[#374056] text-[#e5e5e5]/40' : 'bg-red-500/20 border border-red-500/40 text-red-400'}`}>
          {done ? '✓' : pending ? '·' : '✗'}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-semibold ${done ? 'text-white' : 'text-[#e5e5e5]/70'}`}>{label}</p>
        </div>
        {children && (
          <svg className={`w-4 h-4 text-[#e5e5e5]/30 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {open && children && (
        <div className="px-5 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

function CoCPanel({ userId, onSigned }) {
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function sign() {
    if (!agreed) return
    setSaving(true)
    const { error } = await supabase.from('code_of_conduct_signatures').upsert({
      player_id: userId,
      event_year: EVENT_YEAR,
      signed_at: new Date().toISOString(),
    })
    if (error) { setErr(error.message); setSaving(false); return }
    onSigned()
  }

  return (
    <div>
      <div className="bg-base border border-line rounded-xl p-4 h-48 overflow-y-auto mb-4">
        <pre className="text-[#e5e5e5]/50 text-xs leading-relaxed whitespace-pre-wrap font-sans">
          {CODE_OF_CONDUCT}
        </pre>
      </div>
      <label className="flex items-start gap-3 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          className="mt-0.5 accent-[#00FF41]"
        />
        <span className="text-[#e5e5e5]/70 text-xs leading-relaxed">
          I have read and agree to the ZLTAC 2027 Code of Conduct
        </span>
      </label>
      {err && <p className="text-red-400 text-xs mb-2">{err}</p>}
      <button
        onClick={sign}
        disabled={!agreed || saving}
        className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-xs transition-colors"
      >
        {saving ? 'Signing…' : 'Sign Code of Conduct'}
      </button>
    </div>
  )
}

export default function PlayerHub2027() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [profile, setProfile] = useState(null)
  const [registration, setRegistration] = useState(null)
  const [team, setTeam] = useState(null)
  const [cocSigned, setCocSigned] = useState(false)
  const [testResult, setTestResult] = useState(undefined) // undefined = loading, null = not taken
  const [payment, setPayment] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) navigate('/login')
  }, [authLoading, user, navigate])

  useEffect(() => {
    if (!user) return
    async function load() {
      const [
        { data: profileData },
        { data: regData },
        { data: cocData },
        { data: paymentData },
        { data: testData },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('zltac_registrations').select('*').eq('player_id', user.id).eq('event_year', EVENT_YEAR).maybeSingle(),
        supabase.from('code_of_conduct_signatures').select('signed_at').eq('player_id', user.id).eq('event_year', EVENT_YEAR).maybeSingle(),
        supabase.from('payments').select('*').eq('player_id', user.id).eq('event_year', EVENT_YEAR).maybeSingle(),
        supabase.from('referee_test_results').select('score, passed').eq('player_id', user.id).eq('event_year', EVENT_YEAR).maybeSingle(),
      ])
      setProfile(profileData)
      setRegistration(regData)
      setCocSigned(!!cocData)
      setPayment(paymentData)
      setTestResult(testData ?? null)

      if (regData?.team_id) {
        const { data: teamData } = await supabase
          .from('teams')
          .select('name, captain_id, profiles!teams_captain_id_fkey(first_name, last_name)')
          .eq('id', regData.team_id)
          .maybeSingle()
        setTeam(teamData)
      }

      setLoading(false)
    }
    load()
  }, [user])

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <p className="text-[#e5e5e5]/40 text-sm">Loading your player hub…</p>
      </div>
    )
  }

  const firstName = profile?.first_name ?? 'Player'
  const lastName = profile?.last_name ?? ''
  const alias = profile?.alias
  const isRegistered = !!registration
  const sideEventSlugs = registration?.side_events ?? []
  const dinnerGuests = registration?.dinner_guests ?? 0
  const registeredSideEvents = SIDE_EVENTS.filter(e => sideEventSlugs.includes(e.slug))
  const total = calcTotal(sideEventSlugs, dinnerGuests)
  const amountPaid = payment?.amount_paid ?? 0
  const paymentStatus = payment?.status ?? (isRegistered ? 'unpaid' : null)

  const PAYMENT_STATUS_STYLES = {
    unpaid: 'bg-red-500/15 text-red-400 border-red-500/30',
    partial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    paid: 'bg-brand/15 text-brand border-brand/30',
  }

  return (
    <div className="min-h-screen bg-base text-white py-10 px-6">
      <div className="max-w-3xl mx-auto">

        {/* ── Header ── */}
        <div className="mb-8">
          <Link to="/zltac/2027" className="text-[#e5e5e5]/40 hover:text-brand text-xs transition-colors mb-3 inline-block">
            ← ZLTAC 2027
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-1">ZLTAC 2027 · Player Hub</p>
              <h1 className="text-3xl font-black text-white">
                {firstName} {lastName}
                {alias && <span className="text-brand ml-2 text-2xl">"{alias}"</span>}
              </h1>
              <p className="text-[#e5e5e5]/50 text-sm mt-1">
                {team ? team.name : registration ? 'Side events only — no team' : 'Not yet registered'}
              </p>
            </div>
            {isRegistered && (
              <span className={`self-start sm:self-auto text-xs font-bold px-3 py-1.5 rounded-full border
                ${registration.status === 'confirmed' ? 'bg-brand/15 text-brand border-brand/30' : 'bg-[#374056] text-[#e5e5e5]/60 border-line'}`}>
                {registration.status === 'confirmed' ? '✓ Confirmed' : '⏳ Pending'}
              </span>
            )}
          </div>
        </div>

        {!isRegistered && (
          <div className="bg-surface border border-line rounded-2xl p-6 mb-6 text-center">
            <p className="text-[#e5e5e5]/60 text-sm mb-3">You haven't registered for ZLTAC 2027 yet.</p>
            <Link
              to="/zltac/2027/player-register"
              className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
            >
              Register Now →
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* ── Registration Checklist ── */}
          <div className="md:col-span-2 bg-surface border border-line rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-line">
              <h2 className="text-white font-bold text-base">Registration Checklist</h2>
              <p className="text-[#e5e5e5]/40 text-xs mt-0.5">Complete all items for your registration to be fully confirmed.</p>
            </div>

            <ChecklistItem done={isRegistered} pending={!isRegistered} label="Player registration">
              {!isRegistered && (
                <Link to="/zltac/2027/player-register" className="text-brand text-xs hover:underline">
                  Complete registration →
                </Link>
              )}
            </ChecklistItem>

            <ChecklistItem
              done={cocSigned}
              pending={!isRegistered}
              label={cocSigned ? 'Code of Conduct — signed ✓' : 'Code of Conduct — not yet signed'}
            >
              {!cocSigned && isRegistered && (
                <CoCPanel userId={user.id} onSigned={() => setCocSigned(true)} />
              )}
            </ChecklistItem>

            <ChecklistItem
              done={testResult?.passed === true}
              pending={testResult === undefined || !isRegistered}
              label={
                testResult?.passed === true
                  ? `Referee Test — Passed (${testResult.score}%)`
                  : testResult === null
                    ? 'Referee Test — Not yet taken'
                    : 'Referee Test — Not yet taken'
              }
            >
              {isRegistered && !testResult?.passed && (
                <Link to="/referee-test" className="text-brand text-xs hover:underline">
                  Take the Referee Test →
                </Link>
              )}
            </ChecklistItem>

            <ChecklistItem
              done={paymentStatus === 'paid'}
              pending={!isRegistered || paymentStatus === null}
              label={
                paymentStatus === 'paid'
                  ? `Payment — Paid ${dollars(amountPaid)}`
                  : paymentStatus === 'partial'
                    ? `Payment — Partial (${dollars(amountPaid)} of ${dollars(total)} paid)`
                    : isRegistered
                      ? `Payment — ${dollars(total)} owing`
                      : 'Payment — pending registration'
              }
            >
              {isRegistered && paymentStatus !== 'paid' && (
                <button
                  disabled
                  className="mt-1 bg-brand/20 border border-brand/30 text-brand/60 text-xs font-semibold px-4 py-1.5 rounded-lg cursor-not-allowed"
                >
                  Pay Now (Stripe — coming soon)
                </button>
              )}
            </ChecklistItem>
          </div>

          {/* ── My Events ── */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h2 className="text-white font-bold text-base mb-4">My Events</h2>
            {registeredSideEvents.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {registeredSideEvents.map(e => (
                  <span key={e.slug} className="bg-brand/10 border border-brand/30 text-brand text-xs px-3 py-1.5 rounded-full font-semibold">
                    {e.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[#e5e5e5]/35 text-sm">
                {isRegistered ? 'No side events selected.' : 'Register to see your events.'}
              </p>
            )}
            {isRegistered && (
              <Link to="/zltac/2027/player-register" className="inline-block mt-4 text-brand/60 hover:text-brand text-xs transition-colors">
                Edit my events →
              </Link>
            )}
          </div>

          {/* ── Cost Breakdown ── */}
          <div className="bg-surface border border-line rounded-2xl p-5">
            <h2 className="text-white font-bold text-base mb-4">Cost Breakdown</h2>
            {isRegistered ? (
              <>
                <div className="flex flex-col gap-2 mb-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/60">Main event fee</span>
                    <span className="text-[#e5e5e5]/60">{MAIN_EVENT_FEE > 0 ? dollars(MAIN_EVENT_FEE) : 'TBC'}</span>
                  </div>
                  {registeredSideEvents.map(e => (
                    <div key={e.slug} className="flex justify-between text-sm">
                      <span className="text-[#e5e5e5]/60">{e.name}</span>
                      <span className="text-[#e5e5e5]/60">{dollars(e.price)}</span>
                    </div>
                  ))}
                  {dinnerGuests > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#e5e5e5]/60">
                        {dinnerGuests} dinner guest{dinnerGuests > 1 ? 's' : ''}
                      </span>
                      <span className="text-[#e5e5e5]/60">{dollars(dinnerGuests * DINNER_GUEST_PRICE)}</span>
                    </div>
                  )}
                </div>
                <div className="border-t border-line pt-3 flex justify-between items-center mb-4">
                  <span className="text-white font-bold text-sm">Total</span>
                  <span className="text-brand font-black text-lg">{dollars(total)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  {paymentStatus && (
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-bold uppercase tracking-wide ${PAYMENT_STATUS_STYLES[paymentStatus] ?? ''}`}>
                      {paymentStatus}
                    </span>
                  )}
                  <button
                    disabled
                    className="ml-auto bg-brand/10 border border-brand/20 text-brand/50 text-xs font-bold px-4 py-1.5 rounded-lg cursor-not-allowed"
                  >
                    Pay Now
                  </button>
                </div>
                <p className="text-[#e5e5e5]/25 text-xs mt-2">Stripe payment coming soon.</p>
              </>
            ) : (
              <p className="text-[#e5e5e5]/35 text-sm">Register to see your cost breakdown.</p>
            )}
          </div>

          {/* ── Team Card ── */}
          <div className="md:col-span-2 bg-surface border border-line rounded-2xl p-5">
            <h2 className="text-white font-bold text-base mb-4">Team</h2>
            {team ? (
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-line flex items-center justify-center text-[#e5e5e5]/30 text-xs font-bold flex-shrink-0">
                  LOGO
                </div>
                <div className="flex-1">
                  <p className="text-white font-bold">{team.name}</p>
                  {team.profiles && (
                    <p className="text-[#e5e5e5]/50 text-xs mt-0.5">
                      Captain: {team.profiles.first_name} {team.profiles.last_name}
                    </p>
                  )}
                  <Link to="/captain" className="inline-block mt-3 text-brand text-xs hover:underline">
                    View teammates →
                  </Link>
                </div>
              </div>
            ) : registration ? (
              <div>
                <p className="text-[#e5e5e5]/40 text-sm mb-2">Entered as side events only — no team.</p>
                <Link to="/zltac/2027/player-register" className="text-brand text-xs hover:underline">
                  Update registration to join a team →
                </Link>
              </div>
            ) : (
              <p className="text-[#e5e5e5]/35 text-sm">Register to see your team details.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
