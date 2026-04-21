import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Footer from '../components/Footer'

// Placeholder event date — update when confirmed
const EVENT_DATE = new Date('2027-10-11T09:00:00+11:00')

const SIDE_EVENTS = [
  {
    name: 'Lord of the Rings',
    badge: 'Featured',
    desc: 'An epic multi-game tournament format — only the finest warriors survive each ring to claim the ultimate title.',
    highlight: true,
  },
  {
    name: 'Solos',
    badge: 'Individual',
    desc: 'Head-to-head individual competition. Prove you are the best single player in Australasia.',
  },
  {
    name: 'Doubles',
    badge: 'Team of 2',
    desc: 'Partner with a teammate and coordinate your strategy to outmanoeuvre the field.',
  },
  {
    name: 'Triples',
    badge: 'Team of 3',
    desc: 'Fast-paced three-player team format. Communication and chemistry decide the winners.',
  },
  {
    name: 'Additional Dinner Guest',
    badge: 'Social',
    desc: 'Register an additional guest to join you at the official ZLTAC 2027 championship dinner.',
  },
]

function CountdownUnit({ value, label }) {
  return (
    <div className="text-center">
      <div
        className="bg-surface border border-line rounded-2xl px-5 py-4 min-w-[72px] mb-2"
        style={{ boxShadow: '0 0 20px rgba(0,255,65,0.05)' }}
      >
        <span className="text-brand font-black text-4xl md:text-5xl tabular-nums"
          style={{ textShadow: '0 0 20px rgba(0,255,65,0.4)' }}
        >
          {String(value).padStart(2, '0')}
        </span>
      </div>
      <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-widest">{label}</p>
    </div>
  )
}

export default function ZLTAC2027() {
  const { user } = useAuth()
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })

  useEffect(() => {
    function update() {
      const diff = EVENT_DATE - new Date()
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 })
        return
      }
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      })
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="bg-base text-white">

      {/* ── Hero ── */}
      <section
        className="relative min-h-[70vh] flex flex-col items-center justify-center border-b border-line overflow-hidden px-6"
        style={{
          background: 'radial-gradient(ellipse at 50% 60%, rgba(0,255,65,0.09) 0%, transparent 65%), #0F0F0F',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.04) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="absolute bottom-0 left-0 right-0 h-32"
          style={{ background: 'linear-gradient(to bottom, transparent, #0F0F0F)' }} />

        <div className="relative text-center max-w-3xl mx-auto">
          <span className="inline-block bg-brand text-black text-xs font-black px-4 py-1.5 rounded-full uppercase tracking-widest mb-6">
            Registration Open
          </span>
          <h1 className="text-5xl md:text-7xl font-black uppercase leading-none tracking-tight mb-4">
            ZLTAC <span className="text-brand" style={{ textShadow: '0 0 40px rgba(0,255,65,0.5)' }}>2027</span>
          </h1>
          <p className="text-[#e5e5e5]/60 text-lg mb-3">Zone Laser Tag Australasian Championship</p>
          <p className="text-[#e5e5e5]/35 text-sm mb-12">
            Date: TBC 2027 &nbsp;·&nbsp; Location: TBC &nbsp;·&nbsp; Format: Teams Championship + Side Events
          </p>

          {/* Countdown */}
          <div className="flex items-center justify-center gap-4 md:gap-6">
            <CountdownUnit value={timeLeft.days} label="Days" />
            <span className="text-brand/50 text-3xl font-bold mb-8">:</span>
            <CountdownUnit value={timeLeft.hours} label="Hours" />
            <span className="text-brand/50 text-3xl font-bold mb-8">:</span>
            <CountdownUnit value={timeLeft.minutes} label="Minutes" />
            <span className="text-brand/50 text-3xl font-bold mb-8">:</span>
            <CountdownUnit value={timeLeft.seconds} label="Seconds" />
          </div>
        </div>
      </section>

      {/* ── CTA Cards ── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">How to Enter</p>
        <h2 className="text-3xl font-black text-white text-center mb-14">Register for ZLTAC 2027</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">

          {/* Register as Captain */}
          <div
            className="relative border border-brand/30 rounded-2xl p-8 overflow-hidden hover:border-brand/60 transition-all group flex flex-col"
            style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.07) 0%, #191919 60%)' }}
          >
            <div className="absolute top-0 left-0 right-0 h-px bg-brand/40" />
            <div className="text-4xl mb-5">👑</div>
            <h3 className="text-white font-black text-lg mb-2 group-hover:text-brand transition-colors">Register as Captain</h3>
            <p className="text-[#e5e5e5]/50 text-sm leading-relaxed mb-6 flex-1">
              Create and lead your team. Manage your roster, submit team entries, and captain your squad to the championship.
            </p>
            <Link
              to="/zltac/2027/captain-register"
              className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all hover:shadow-[0_0_16px_rgba(0,255,65,0.4)] text-center"
            >
              Register as Captain →
            </Link>
          </div>

          {/* Register as Player */}
          <div className="bg-surface border border-line rounded-2xl p-8 hover:border-brand/30 transition-all group flex flex-col">
            <div className="text-4xl mb-5">🎮</div>
            <h3 className="text-white font-black text-lg mb-2 group-hover:text-brand transition-colors">Register as a Player</h3>
            <p className="text-[#e5e5e5]/50 text-sm leading-relaxed mb-6 flex-1">
              Enter via your team's invite code, or register for side events only. Select your events and complete your registration.
            </p>
            <Link
              to="/zltac/2027/player-register"
              className="inline-block border border-line hover:border-brand text-[#e5e5e5]/70 hover:text-brand font-bold px-5 py-2.5 rounded-xl text-sm transition-all text-center"
            >
              Register as Player →
            </Link>
          </div>

          {/* Player Hub */}
          <div className="bg-base border border-line rounded-2xl p-8 hover:border-[#374056] transition-all group flex flex-col">
            <div className="text-4xl mb-5">📋</div>
            <h3 className="text-white font-black text-lg mb-2 group-hover:text-brand transition-colors">Already registered?</h3>
            <p className="text-[#e5e5e5]/50 text-sm leading-relaxed mb-6 flex-1">
              View your player hub — manage your registration, sign the Code of Conduct, check your payment, and view your team.
            </p>
            <Link
              to="/zltac/2027/player-hub"
              className="inline-block border border-line hover:border-brand/50 text-[#e5e5e5]/50 hover:text-brand font-bold px-5 py-2.5 rounded-xl text-sm transition-all text-center"
            >
              View Player Hub →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Event Details ── */}
      <section className="bg-surface border-y border-line">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Event Info</p>
          <h2 className="text-3xl font-black text-white text-center mb-12">Event Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {[
              { label: 'Date', value: 'TBC 2027', sub: 'Date to be confirmed' },
              { label: 'Location', value: 'TBC', sub: 'Venue to be confirmed' },
              { label: 'Format', value: 'Teams + Side Events', sub: 'Full championship programme' },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-base border border-line rounded-xl p-6 text-center">
                <p className="text-[#e5e5e5]/35 text-xs uppercase tracking-wider mb-2">{label}</p>
                <p className="text-brand font-black text-lg mb-1">{value}</p>
                <p className="text-[#e5e5e5]/35 text-xs">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Side Events ── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Programme</p>
        <h2 className="text-3xl font-black text-white text-center mb-3">Side Events</h2>
        <p className="text-[#e5e5e5]/40 text-sm text-center mb-14 max-w-md mx-auto">
          In addition to the main team championship, ZLTAC 2027 features the following side events.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {SIDE_EVENTS.map(({ name, badge, desc, highlight }) => (
            <div
              key={name}
              className={`rounded-2xl p-6 border transition-all hover:border-brand/40 group
                ${highlight
                  ? 'border-brand/30 bg-brand/5'
                  : 'border-line bg-surface'
                }`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className={`font-bold text-base group-hover:text-brand transition-colors ${highlight ? 'text-brand' : 'text-white'}`}>
                  {name}
                </h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide
                  ${highlight ? 'bg-brand text-black' : 'bg-line text-[#e5e5e5]/40'}`}>
                  {badge}
                </span>
              </div>
              <p className="text-[#e5e5e5]/50 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-12">
          <Link
            to={user ? '/zltac/register' : '/register'}
            className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-8 py-4 rounded-xl transition-all hover:shadow-[0_0_24px_rgba(0,255,65,0.4)]"
          >
            {user ? 'Select My Events →' : 'Register to Enter →'}
          </Link>
        </div>
      </section>

      {/* ── Login prompt ── */}
      {!user && (
        <section className="bg-surface border-t border-line">
          <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-white font-bold text-lg mb-1">Already registered?</p>
              <p className="text-[#e5e5e5]/45 text-sm">Sign in to your ALSA account to manage your event entries.</p>
            </div>
            <Link
              to="/login"
              className="border border-brand text-brand hover:bg-brand hover:text-black font-bold px-8 py-3 rounded-xl transition-all whitespace-nowrap"
            >
              Sign In to Portal
            </Link>
          </div>
        </section>
      )}

      <Footer />
    </div>
  )
}
