import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ─── Event definitions ───────────────────────────────────────────────────────
// Update these slugs/names when the official ZLTAC 2026 event list is confirmed.

const MAIN_EVENTS = [
  {
    slug: 'solo-open',
    name: 'Solo Open',
    desc: 'Individual competitive play, open to all.',
    badge: 'Competitive',
  },
  {
    slug: 'solo-female',
    name: 'Solo Female',
    desc: 'Individual competitive play, women\'s category.',
    badge: 'Competitive',
  },
  {
    slug: 'solo-junior',
    name: 'Solo Junior',
    desc: 'Individual competitive play, under 18s.',
    badge: 'Under 18',
  },
  {
    slug: 'solo-masters',
    name: 'Solo Masters',
    desc: 'Individual competitive play, age 40 and over.',
    badge: '40+',
  },
  {
    slug: 'pairs',
    name: 'Pairs (2-player)',
    desc: 'Partner-based team format. Register your team in the Captain Portal.',
    badge: 'Team',
  },
  {
    slug: 'squad',
    name: 'Squad (5-player)',
    desc: 'Five-player team format — the flagship ZLTAC event.',
    badge: 'Team',
  },
]

const SIDE_EVENTS = [
  {
    slug: 'accuracy-challenge',
    name: 'Accuracy Challenge',
    desc: 'Precision shooting at timed targets. Highest accuracy score wins.',
    badge: 'Side event',
  },
  {
    slug: 'endurance-run',
    name: 'Endurance Run',
    desc: 'Extended solo session testing stamina and consistency over multiple games.',
    badge: 'Side event',
  },
  {
    slug: 'rookie-rumble',
    name: 'Rookie Rumble',
    desc: 'First-time ALSA competitors only. Great intro to championship play.',
    badge: 'First-timers',
  },
  {
    slug: 'last-shot-shootout',
    name: 'Last-Shot Shootout',
    desc: 'Elimination bracket — last player standing takes the title.',
    badge: 'Side event',
  },
]

const EVENT_YEAR = 2026

// ─── Sub-components ──────────────────────────────────────────────────────────

function EventCard({ event, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(event.slug)}
      className={`w-full text-left rounded-xl border p-4 transition-all
        ${selected
          ? 'bg-brand/10 border-brand shadow-[0_0_12px_rgba(0,255,65,0.15)]'
          : 'bg-base border-line hover:border-[#374056]'
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-semibold ${selected ? 'text-brand' : 'text-white'}`}>
              {event.name}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-line text-[#e5e5e5]/50">
              {event.badge}
            </span>
          </div>
          <p className="text-[#e5e5e5]/50 text-xs leading-relaxed">{event.desc}</p>
        </div>
        <div className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded border flex items-center justify-center text-xs font-bold transition-colors
          ${selected ? 'bg-brand border-brand text-black' : 'border-line'}`}>
          {selected ? '✓' : ''}
        </div>
      </div>
    </button>
  )
}

function StepIndicator({ current }) {
  const steps = ['Main Events', 'Side Events', 'Confirm']
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const num = i + 1
        const done = num < current
        const active = num === current
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                ${done ? 'bg-brand text-black' : active ? 'bg-brand text-black' : 'bg-line text-[#e5e5e5]/40'}`}>
                {done ? '✓' : num}
              </div>
              <span className={`text-sm ${active ? 'text-white font-medium' : done ? 'text-brand' : 'text-[#e5e5e5]/40'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-3 h-px w-8 ${done ? 'bg-brand' : 'bg-line'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ZLTACRegister() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Load any existing registrations so returning players see their prior picks
  useEffect(() => {
    if (!user) return
    supabase
      .from('event_registrations')
      .select('event_slug')
      .eq('player_id', user.id)
      .eq('event_year', EVENT_YEAR)
      .then(({ data }) => {
        if (data?.length) setSelected(new Set(data.map(r => r.event_slug)))
        setLoading(false)
      })
  }, [user])

  function toggle(slug) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(slug) ? next.delete(slug) : next.add(slug)
      return next
    })
  }

  async function handleSubmit() {
    if (selected.size === 0) {
      setError('Please select at least one event before confirming.')
      return
    }
    setError('')
    setSubmitting(true)

    // Replace all existing entries for this player + year
    const { error: delError } = await supabase
      .from('event_registrations')
      .delete()
      .eq('player_id', user.id)
      .eq('event_year', EVENT_YEAR)

    if (delError) {
      setError(delError.message)
      setSubmitting(false)
      return
    }

    const rows = [...selected].map(slug => ({
      player_id: user.id,
      event_slug: slug,
      event_year: EVENT_YEAR,
    }))

    const { error: insError } = await supabase.from('event_registrations').insert(rows)

    if (insError) {
      setError(insError.message)
      setSubmitting(false)
      return
    }

    navigate('/dashboard')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <p className="text-[#e5e5e5]/40">Loading…</p>
      </div>
    )
  }

  const selectedMain = MAIN_EVENTS.filter(e => selected.has(e.slug))
  const selectedSide = SIDE_EVENTS.filter(e => selected.has(e.slug))

  return (
    <div className="min-h-screen bg-base py-10 px-6">
      <div className="max-w-2xl mx-auto">

        {/* Page header */}
        <div className="mb-6">
          <p className="text-brand text-sm font-semibold uppercase tracking-widest mb-1">ZLTAC 2026</p>
          <h1 className="text-2xl font-bold text-white">Event Registration</h1>
          <p className="text-[#e5e5e5]/50 text-sm mt-1">
            Zone Laser Tag Australasian Championship
          </p>
        </div>

        <StepIndicator current={step} />

        {/* ── Step 1: Main Events ── */}
        {step === 1 && (
          <div>
            <div className="mb-5">
              <h2 className="text-white font-semibold text-lg">Main Events</h2>
              <p className="text-[#e5e5e5]/50 text-sm mt-1">
                Select every main event you want to compete in. You may enter multiple.
              </p>
            </div>
            <div className="flex flex-col gap-3 mb-8">
              {MAIN_EVENTS.map(event => (
                <EventCard key={event.slug} event={event} selected={selected.has(event.slug)} onToggle={toggle} />
              ))}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="bg-brand hover:bg-brand-hover text-black font-semibold rounded-lg px-6 py-2.5 transition-colors"
              >
                Next: Side Events →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Side Events ── */}
        {step === 2 && (
          <div>
            <div className="mb-5">
              <h2 className="text-white font-semibold text-lg">Side Events</h2>
              <p className="text-[#e5e5e5]/50 text-sm mt-1">
                Side events are optional bonus competitions. Add any that interest you.
              </p>
            </div>
            <div className="flex flex-col gap-3 mb-8">
              {SIDE_EVENTS.map(event => (
                <EventCard key={event.slug} event={event} selected={selected.has(event.slug)} onToggle={toggle} />
              ))}
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="bg-line hover:bg-[#374056] text-white font-semibold rounded-lg px-6 py-2.5 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="bg-brand hover:bg-brand-hover text-black font-semibold rounded-lg px-6 py-2.5 transition-colors"
              >
                Review Entry →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Confirm ── */}
        {step === 3 && (
          <div>
            <div className="mb-5">
              <h2 className="text-white font-semibold text-lg">Review Your Entry</h2>
              <p className="text-[#e5e5e5]/50 text-sm mt-1">
                Confirm your event selections below. You can come back and update before registrations close.
              </p>
            </div>

            {selected.size === 0 ? (
              <div className="bg-surface border border-line rounded-xl p-6 mb-6 text-center">
                <p className="text-[#e5e5e5]/40 text-sm">No events selected.</p>
                <button onClick={() => setStep(1)} className="mt-3 text-brand text-sm hover:underline">
                  Go back and select events
                </button>
              </div>
            ) : (
              <div className="bg-surface border border-line rounded-xl overflow-hidden mb-6">
                {selectedMain.length > 0 && (
                  <div className="px-6 py-4 border-b border-line">
                    <p className="text-[#e5e5e5]/50 text-xs uppercase tracking-wider mb-3">Main Events</p>
                    <div className="flex flex-col gap-2">
                      {selectedMain.map(e => (
                        <div key={e.slug} className="flex items-center gap-2">
                          <span className="text-brand text-sm">✓</span>
                          <span className="text-white text-sm">{e.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedSide.length > 0 && (
                  <div className="px-6 py-4">
                    <p className="text-[#e5e5e5]/50 text-xs uppercase tracking-wider mb-3">Side Events</p>
                    <div className="flex flex-col gap-2">
                      {selectedSide.map(e => (
                        <div key={e.slug} className="flex items-center gap-2">
                          <span className="text-brand text-sm">✓</span>
                          <span className="text-white text-sm">{e.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="bg-brand/5 border-t border-brand/20 px-6 py-3 flex items-center justify-between">
                  <span className="text-[#e5e5e5]/60 text-sm">Total events selected</span>
                  <span className="text-brand font-bold">{selected.size}</span>
                </div>
              </div>
            )}

            {error && (
              <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/30 rounded-lg px-4 py-2 mb-4">
                {error}
              </p>
            )}

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="bg-line hover:bg-[#374056] text-white font-semibold rounded-lg px-6 py-2.5 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || selected.size === 0}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-lg px-8 py-2.5 transition-colors"
              >
                {submitting ? 'Submitting…' : 'Confirm Entry'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
