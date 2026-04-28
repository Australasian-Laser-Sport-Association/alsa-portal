import { Link } from 'react-router-dom'
import { Flag, TrendingUp, Trophy, Award, Network, Target, Users, Shield, ArrowRight } from 'lucide-react'
import Footer from '../components/Footer'

const COMMITTEE = [
  { initials: 'PH', name: 'Paige Horrigan',   role: 'President',        alias: 'Shifter'   },
  { initials: 'NR', name: 'Nick Risk',         role: 'Vice President',   alias: 'Wax'       },
  { initials: 'CR', name: 'Claire Roe-Smith',  role: 'Secretary',        alias: 'Pendragon' },
  { initials: 'AC', name: 'Adam Crouch',       role: 'Treasurer',        alias: 'Crouchy'   },
  { initials: 'MH', name: 'Matthew Hogan',     role: 'Committee Member', alias: 'Taipan'    },
]

const TIMELINE = [
  {
    period: '1999',
    title: 'ZLTAC begins',
    note: 'Originally known as the Australian Zone 3 Nationals.',
    body: 'The first Zone Laser Tag Australasian Championship is held. A handful of teams, one format, the start of a tradition.',
    Icon: Flag,
  },
  {
    period: '2000s – 2010s',
    title: 'Two decades of growth',
    note: 'Renamed ZLTAC in 2012 to include New Zealand.',
    body: 'ZLTAC expands across Australia, hosted in rotation by every state. The format grows from one to eight, spanning Teams, Doubles, Triples, Solos and specialty events.',
    Icon: TrendingUp,
  },
  {
    period: 'Late 2010s – 2024',
    title: 'The largest in the world',
    body: 'ZLTAC becomes the largest laser tag championship globally, drawing 25+ teams a year and a permanent community of competitors.',
    Icon: Trophy,
  },
  {
    period: '2025',
    title: 'ALSA Inc. founded',
    body: 'After 26 years of community-run competition, the players formalise what they had built. The Australasian Laser Sport Association is incorporated in Victoria as a registered association (A0127794G).',
    Icon: Award,
  },
  {
    period: '2025 – onward',
    title: 'ZLTAC under ALSA',
    body: 'The original ZLTAC committee continues as a sub-committee under ALSA, with new authority around governance, the player registry, and standards across the sport.',
    Icon: Network,
  },
]

const MISSION_PILLARS = [
  { Icon: Target, title: 'Develop', desc: 'Build pathways for new players entering competitive play.' },
  { Icon: Users,  title: 'Promote', desc: 'Grow the profile of laser sport across Australia and NZ.' },
  { Icon: Shield, title: 'Govern',  desc: 'Maintain fair, consistent standards across all events.' },
]

const PARTNERS = [
  { src: '/images/zltac-logo.png', alt: 'ZLTAC' },
  { src: '/zone_logo.png',         alt: 'Zone Laser Tag' },
  { src: '/zone3.png',             alt: 'Zone3' },
  { src: '/alsawhitelogo.png',     alt: 'ALSA' },
]

export default function About() {
  return (
    <div className="bg-base text-white">

      {/* ── Hero ── */}
      <section
        className="relative py-28 flex items-center justify-center overflow-hidden border-b border-line"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.06) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative text-center px-6">
          <img
            src="/alsa-logo.png"
            alt="ALSA"
            className="h-48 md:h-64 w-auto mx-auto mb-6"
          />
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">The Association</p>
          <h1 className="text-5xl md:text-6xl font-black text-white">About ALSA</h1>
          <p className="text-[#e5e5e5]/50 mt-4 text-lg max-w-lg mx-auto">
            The governing body for competitive laser sport in Australasia
          </p>
        </div>
      </section>

      {/* ── Origin Timeline ── */}
      <section className="bg-base py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16 md:mb-20">
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">Our Story</p>
            <h2 className="text-4xl md:text-5xl font-black text-white leading-tight">An Association Born from<br />25+ Years of Competition</h2>
          </div>

          {/* Horizontal — md and up */}
          <div className="hidden md:grid grid-cols-5 gap-4 md:gap-6">
            {TIMELINE.map(({ period, title, note, body, Icon }, i) => (
              <div key={period} className="flex flex-col items-center text-center">
                <p className="text-brand font-black text-lg md:text-xl mb-3">{period}</p>
                <div className="relative w-full flex justify-center mb-4">
                  {i !== 0 && (
                    <div className="absolute left-0 right-1/2 top-1/2 h-px bg-line/60 -translate-y-1/2" />
                  )}
                  {i !== TIMELINE.length - 1 && (
                    <div className="absolute left-1/2 right-0 top-1/2 h-px bg-line/60 -translate-y-1/2" />
                  )}
                  <div className="relative w-12 h-12 rounded-full border-2 border-brand bg-base flex items-center justify-center z-10">
                    <Icon className="w-5 h-5 text-brand" />
                  </div>
                </div>
                <h3 className="text-white font-bold text-base md:text-lg mb-2">{title}</h3>
                {note && <p className="text-white/60 italic text-sm mb-2">{note}</p>}
                <p className="text-white/70 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Vertical fallback — sm and below */}
          <div className="md:hidden space-y-10">
            {TIMELINE.map(({ period, title, note, body, Icon }) => (
              <div key={period} className="flex gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full border-2 border-brand bg-base flex items-center justify-center">
                  <Icon className="w-5 h-5 text-brand" />
                </div>
                <div>
                  <p className="text-brand font-black text-lg mb-1">{period}</p>
                  <h3 className="text-white font-bold text-base mb-1">{title}</h3>
                  {note && <p className="text-white/60 italic text-sm mb-1">{note}</p>}
                  <p className="text-white/70 text-sm leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Mission ── */}
      <section className="bg-surface border-y border-line">
        <div className="max-w-7xl mx-auto px-6 py-20 text-center">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">Our Purpose</p>
          <h2 className="text-3xl font-black text-white mb-6">Mission Statement</h2>
          <p className="text-[#e5e5e5]/60 text-lg leading-relaxed max-w-3xl mx-auto mb-10">
            "To develop, promote, and govern competitive laser sport across Australasia — fostering a professional, inclusive, and high-performance environment where players of all skill levels can compete, connect, and be part of a sport they love."
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {MISSION_PILLARS.map(({ Icon, title, desc }) => (
              <div key={title} className="bg-base border border-line rounded-xl p-6">
                <Icon className="w-12 h-12 md:w-14 md:h-14 text-brand mb-4 mx-auto" />
                <p className="text-brand font-black text-lg mb-2">{title}</p>
                <p className="text-[#e5e5e5]/50 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ZLTAC Teaser ── */}
      <section className="bg-base">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24 text-center">
          <p className="text-brand uppercase tracking-widest text-sm mb-4">The Flagship Event</p>
          <img
            src="/images/zltac-logo.png"
            alt="ZLTAC"
            className="h-20 md:h-28 w-auto mx-auto mb-4"
          />
          <h2 className="text-white font-black text-4xl md:text-6xl mb-2">ZLTAC</h2>
          <p className="text-brand text-lg md:text-xl font-semibold mb-6">
            Zone Laser Tag Australasian Championship
          </p>
          <p className="text-white/80 text-base md:text-lg max-w-3xl mx-auto mb-10">
            Australasia&apos;s premier laser tag championship since 1999. ZLTAC brings together the
            region&apos;s top players each year for the main Teams event plus seven side events
            spanning solos, doubles, triples, and specialty formats.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-8 md:gap-16">
            {[
              { value: '28', label: 'Years' },
              { value: '25', label: 'Teams / Year' },
              { value: '8',  label: 'Formats' },
            ].map(({ value, label }) => (
              <div key={label}>
                <p
                  className="text-4xl md:text-5xl font-black text-brand mb-1"
                  style={{ textShadow: '0 0 30px rgba(0,255,65,0.3)' }}
                >
                  {value}
                </p>
                <p className="text-white text-xs uppercase tracking-widest">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link
              to="/zltac"
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-black font-bold px-8 py-3.5 rounded-xl transition-all hover:shadow-[0_0_24px_rgba(0,255,65,0.4)]"
            >
              Explore ZLTAC History
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Committee ── */}
      <section className="bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Leadership</p>
          <h2 className="text-3xl font-black text-white text-center mb-3">The Committee</h2>
          <p className="text-[#e5e5e5]/40 text-sm text-center mb-14 max-w-md mx-auto">
            ALSA is led by a volunteer committee of players and organisers committed to the growth of the sport.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {COMMITTEE.map(({ initials, name, role, alias }) => (
              <div
                key={name}
                className="bg-base border border-line hover:border-brand/30 rounded-2xl p-4 md:p-5 flex flex-col items-center text-center transition-all"
              >
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5 flex-shrink-0 bg-brand/20 mx-auto">
                  <span className="text-brand font-bold text-2xl">{initials}</span>
                </div>
                <p className="text-white font-bold text-lg mb-2">{name}</p>
                <p className="text-brand text-sm font-semibold uppercase tracking-wide mb-2">{role}</p>
                <p className="text-white/80 text-base md:text-lg">
                  <span className="font-normal text-white/60">ALIAS</span> – <span className="font-bold">{alias}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Partners ── */}
      <section className="bg-base border-t border-line py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-brand text-sm uppercase tracking-widest mb-4">Our Partners</p>
          <h2 className="text-3xl md:text-4xl font-black text-white mb-12">Supported by</h2>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-16">
            {PARTNERS.map(({ src, alt }) => (
              <img
                key={src}
                src={src}
                alt={alt}
                className="h-16 md:h-20 w-auto opacity-80 hover:opacity-100 transition"
              />
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
