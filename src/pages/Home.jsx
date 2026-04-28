import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Trophy, Users, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dateFormat'
import Footer from '../components/Footer'

const CrosshairIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="32" cy="32" r="20" stroke="#00FF41" strokeWidth="2.5"/>
    <circle cx="32" cy="32" r="8" stroke="#00FF41" strokeWidth="2.5"/>
    <line x1="32" y1="4" x2="32" y2="18" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="32" y1="46" x2="32" y2="60" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="4" y1="32" x2="18" y2="32" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="46" y1="32" x2="60" y2="32" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round"/>
    <circle cx="32" cy="32" r="2.5" fill="#00FF41"/>
  </svg>
)

const VestIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 14 L20 8 L32 16 L44 8 L52 14 L48 40 H16 Z" stroke="#00FF41" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
    <path d="M16 40 L14 56 H50 L48 40" stroke="#00FF41" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
    <rect x="24" y="22" width="16" height="10" rx="2" stroke="#00FF41" strokeWidth="2" fill="none"/>
    <line x1="24" y1="36" x2="40" y2="36" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="26" y1="39" x2="38" y2="39" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="20" cy="28" r="2" fill="#00FF41"/>
    <circle cx="44" cy="28" r="2" fill="#00FF41"/>
    <line x1="22" y1="28" x2="24" y2="27" stroke="#00FF41" strokeWidth="1.5"/>
    <line x1="42" y1="27" x2="40" y2="27" stroke="#00FF41" strokeWidth="1.5"/>
  </svg>
)

const TrophyIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 8 H44 V30 C44 41 32 46 32 46 C32 46 20 41 20 30 Z" stroke="#00FF41" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
    <path d="M20 14 H10 C10 14 8 26 20 30" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <path d="M44 14 H54 C54 14 56 26 44 30" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <line x1="32" y1="46" x2="32" y2="54" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M22 54 H42" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M27 22 L30 18 L32 22 L36 23 L33 26 L34 30 L32 28 L28 30 L29 26 L26 23 Z" fill="#00FF41"/>
  </svg>
)

const FEATURES = [
  {
    Icon: CrosshairIcon,
    title: 'Strategic & Fast-Paced',
    desc: 'Every game is a high-intensity tactical battle. Teams must communicate, adapt and outmanoeuvre opponents across a dynamic arena.',
  },
  {
    Icon: VestIcon,
    title: 'Hybrid Wearable Technology',
    desc: 'Players wear sensor-packed vests that track every hit in real time, feeding live data to scoreboards and creating a truly modern sport experience.',
  },
  {
    Icon: TrophyIcon,
    title: 'Community & Championship',
    desc: 'From grassroots local competitions to the annual ZLTAC Australasian Championship — there is a pathway for every competitive player.',
  },
]

export default function Home() {
  const [activeEvent, setActiveEvent] = useState(undefined) // undefined = loading, null = none found

  useEffect(() => {
    supabase
      .from('zltac_events')
      .select('id, name, year, location, status, logo_url, reg_open_date, reg_close_date')
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setActiveEvent(data ?? null))
  }, [])

  return (
    <div className="bg-base text-white">

      {/* ── Hero ── */}
      <section
        className="relative min-h-[calc(100vh-66px)] flex items-center justify-center overflow-hidden"
        style={{
          background: 'radial-gradient(ellipse at 50% 60%, rgba(0,255,65,0.05) 0%, transparent 65%), #0F0F0F',
        }}
      >
        {/* Grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)
            `,
            backgroundSize: '72px 72px',
          }}
        />
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #0F0F0F)' }} />

        <div className="relative text-center px-6 max-w-4xl mx-auto">
          <img
            src="/alsa-logo.png"
            alt="ALSA"
            className="mx-auto mb-10 drop-shadow-[0_0_40px_rgba(0,255,65,0.25)]"
            style={{ height: 360 }}
          />
          <h1 className="text-5xl md:text-7xl font-black uppercase leading-none tracking-tight mb-6">
            <span className="text-white block">Australasian Laser Sport Association</span>
          </h1>
          <p className="text-[#e5e5e5]/55 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            The governing body behind ZLTAC.
          </p>
        </div>
      </section>

      {/* ── About the Association ── */}
      <section className="bg-surface border-y border-line">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
          <div className="text-center">
            <p className="text-brand uppercase tracking-widest text-sm mb-4">About the Association</p>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-6">What is ALSA?</h2>
            <p className="text-white/80 text-lg md:text-xl leading-relaxed max-w-3xl mx-auto mb-16">
              ALSA, the Australasian Laser Sport Association, was formally established in 2025 to
              govern competitive laser tag across the region. It grew out of ZLTAC, the
              championship that has been running since 1999 and has become the largest laser tag
              tournament in the world. With ALSA now in place, the original ZLTAC committee
              continues as a sub-committee under the association. Built by players, run by
              players, for the sport we love.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-6xl mx-auto">
            {[
              {
                Icon: Trophy,
                title: 'Run the Championship',
                body: "ZLTAC is Australasia's premier laser tag tournament and the heart of competitive laser sport in the region. Eight formats, every state hosting in rotation, decades of history.",
              },
              {
                Icon: Users,
                title: 'Build the Player Community',
                body: 'A central place for players to register, manage their championship entries, and connect with the wider laser sport community across Australasia.',
              },
              {
                Icon: Shield,
                title: 'Govern the Sport',
                body: 'Standards, rules, and a representative committee structure. ALSA exists so laser sport in Australasia has a real association behind it — not just an annual event, but a sport with a future.',
              },
            ].map(({ Icon, title, body }) => (
              <div
                key={title}
                className="bg-white/[0.02] border border-white/10 rounded-xl p-6 hover:border-green-400/30 hover:bg-white/[0.04] transition"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="h-8 w-8 text-brand" />
                  <h3 className="text-lg font-semibold text-white leading-tight">{title}</h3>
                </div>
                <p className="text-sm text-white/60 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {[
              {
                year: '1999',
                label: 'ZLTAC First Run',
                body: 'First Australasian championship, Box Hill, VIC',
              },
              {
                year: '2025',
                label: 'ALSA Founded',
                body: 'Association formalised after 26 years of championship history',
              },
            ].map(({ year, label, body }) => (
              <div
                key={year}
                className="bg-surface border-l-2 border-brand/40 rounded-r-md p-4"
              >
                <p className="text-3xl font-black text-brand">{year}</p>
                <p className="text-xs uppercase tracking-widest text-white/50 mt-1">{label}</p>
                <p className="text-sm text-white/70 mt-2">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              to="/about"
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-black font-bold px-8 py-3.5 rounded-xl transition-all hover:shadow-[0_0_24px_rgba(0,255,65,0.4)]"
            >
              Learn More About ALSA
              <ArrowRight size={18} />
            </Link>
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
          <p className="text-white/80 text-base md:text-lg max-w-3xl mx-auto">
            Australasia&apos;s premier laser tag championship since 1999. ZLTAC brings together the
            region&apos;s top players each year for the main Teams event plus seven side events
            spanning solos, doubles, triples, and specialty formats.
          </p>
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

      {/* ── Active Event (live from DB, hidden if none open) ── */}
      {activeEvent && (
        <section className="bg-surface border-y border-line">
          <div className="max-w-7xl mx-auto px-6 py-16">
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-2 text-center">Active Event</p>
            <h2 className="text-3xl font-black text-white text-center mb-10">
              ZLTAC (Zone Laser Tag Australasian Championship) Annual Events
            </h2>
            <div
              className="relative rounded-2xl border border-brand/30 overflow-hidden"
              style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.06) 0%, #191919 60%)' }}
            >
              <div className="absolute top-0 left-0 right-0 h-px bg-brand/40" />
              <div className="px-8 md:px-12 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
                <div className="flex items-start gap-6">
                  {/* Logo */}
                  <img
                    src={activeEvent.logo_url || '/alsa-logo.png'}
                    alt={activeEvent.name}
                    className="h-20 w-20 object-contain rounded-xl border border-line bg-base p-1.5 flex-shrink-0"
                  />
                  <div>
                    {/* Status badge */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="bg-brand text-black text-xs font-black px-3 py-1 rounded-full uppercase tracking-wide">
                        Registration Open
                      </span>
                    </div>
                    <h3 className="text-3xl md:text-4xl font-black text-white mb-1">
                      {activeEvent.name} {activeEvent.year}
                    </h3>
                    {activeEvent.location && (
                      <p className="text-brand font-semibold mb-2">{activeEvent.location}</p>
                    )}
                    {(activeEvent.reg_open_date || activeEvent.reg_close_date) && (
                      <p className="text-[#e5e5e5]/45 text-sm">
                        {activeEvent.reg_open_date && (
                          <>Registration opens {formatDate(activeEvent.reg_open_date)}</>
                        )}
                        {activeEvent.reg_open_date && activeEvent.reg_close_date && ' · '}
                        {activeEvent.reg_close_date && (
                          <>closes {formatDate(activeEvent.reg_close_date)}</>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <Link
                    to={`/events/${activeEvent.year}`}
                    className="bg-brand hover:bg-brand-hover text-black font-bold px-8 py-3.5 rounded-xl transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] text-center whitespace-nowrap block"
                  >
                    View Event Info →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── What Is Laser Sport? ── */}
      <section className="bg-surface border-y border-line">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">The Sport</p>
          <h2 className="text-3xl font-black text-white text-center mb-3">What Is Laser Sport?</h2>
          <p className="text-[#e5e5e5]/45 text-center max-w-2xl mx-auto mb-14 text-sm leading-relaxed">
            Laser Sport is the competitive evolution of the popular recreational activity Laser Tag. While using the same equipment and arenas, it is a vastly different experience to a casual game. Laser Sport is a fast-paced, strategic 15-player, 3-team format that embraces the current era of hybrid wearable technology — pushing players to coordinate, communicate and compete at the highest level.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {FEATURES.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="bg-white/[0.02] border border-white/10 rounded-xl p-6 hover:border-green-400/30 hover:bg-white/[0.04] transition"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="h-8 w-8" />
                  <h3 className="text-lg font-semibold text-white leading-tight">{title}</h3>
                </div>
                <p className="text-sm text-white/60 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
