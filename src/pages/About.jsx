import { Link } from 'react-router-dom'
import Footer from '../components/Footer'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

const COMMITTEE_DEFAULT = [
  {
    initials: 'JP',
    name: 'Name Placeholder',
    role: 'President',
    bio: 'Founding member and President of ALSA since its inception. A passionate advocate for competitive laser sport across Australasia, instrumental in establishing the ZLTAC championship as the premier event in the region.',
  },
  {
    initials: 'SR',
    name: 'Name Placeholder',
    role: 'Vice President',
    bio: 'Leads competition operations and event coordination. Instrumental in growing ZLTAC from a small interstate tournament to a nationally recognised championship attracting teams from across Australia and New Zealand.',
  },
  {
    initials: 'MK',
    name: 'Name Placeholder',
    role: 'Secretary',
    bio: 'Manages all administrative functions, member communications, player registrations, and official correspondence for the association. The backbone of ALSA\'s day-to-day operations.',
  },
  {
    initials: 'AL',
    name: 'Name Placeholder',
    role: 'Treasurer',
    bio: 'Oversees financial management, event budgeting, and sponsorship accounting for all ALSA activities. Ensures the association operates sustainably and transparently for the benefit of all members.',
  },
  {
    initials: 'TC',
    name: 'Name Placeholder',
    role: 'General Member',
    bio: 'Represents the player community on the committee, advocating for competitive standards, fair play, and a positive player experience at all ALSA events. A competitor at heart.',
  },
]

const STATIC_MILESTONES = [
  { year: '2017', label: 'ALSA Founded', desc: 'The association is established with a mission to grow competitive laser sport.' },
  { year: '2018', label: 'ZLTAC Inaugural', desc: 'The first Zone Laser Tag Australasian Championship is held.' },
  { year: '2020', label: 'NZ Expansion', desc: 'New Zealand competitors join the championship, making it truly Australasian.' },
  { year: '2024', label: 'Digital Portal', desc: 'Launch of the ALSA portal for permanent player registration.' },
]

export default function About() {
  const { event: currentEvent, eventName } = useCurrentEvent()
  const committee = COMMITTEE_DEFAULT

  const milestones = currentEvent
    ? [...STATIC_MILESTONES, { year: String(currentEvent.year), label: eventName, desc: 'The championship enters its most ambitious season yet.' }]
    : STATIC_MILESTONES

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
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">The Association</p>
          <h1 className="text-5xl md:text-6xl font-black text-white">About ALSA</h1>
          <p className="text-[#e5e5e5]/50 mt-4 text-lg max-w-lg mx-auto">
            The governing body for competitive laser sport in Australasia
          </p>
        </div>
      </section>

      {/* ── History ── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">Our Story</p>
            <h2 className="text-4xl font-black text-white mb-8 leading-tight">A Championship Born from Passion</h2>
            <div className="space-y-5 text-[#e5e5e5]/60 leading-relaxed text-sm">
              <p>ALSA was founded in 2017 by a group of dedicated laser tag enthusiasts who shared a vision: to elevate competitive laser sport to the level it deserved.</p>
              <p>In 2018, ALSA hosted the inaugural Zone Laser Tag Australasian Championship (ZLTAC) — a landmark moment for the sport.</p>
              <p>Since then, ALSA has grown steadily, expanding to include New Zealand competitors, implementing a permanent player registry, and developing structured team formats that mirror the professionalism of other national sporting bodies.</p>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            {milestones.map(({ year, label, desc }) => (
              <div key={year} className="flex gap-5 items-start">
                <div className="flex-shrink-0 w-14 text-right">
                  <span className="text-brand font-black text-sm">{year}</span>
                </div>
                <div className="flex-shrink-0 flex flex-col items-center pt-1">
                  <div className="w-2 h-2 rounded-full bg-brand" />
                  <div className="w-px flex-1 bg-line mt-1" style={{ minHeight: 40 }} />
                </div>
                <div className="pb-4">
                  <p className="text-white font-semibold text-sm mb-0.5">{label}</p>
                  <p className="text-[#e5e5e5]/45 text-xs leading-relaxed">{desc}</p>
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
            {[
              { title: 'Develop', desc: 'Build pathways for new players entering competitive play.' },
              { title: 'Promote', desc: 'Grow the profile of laser sport across Australia and NZ.' },
              { title: 'Govern', desc: 'Maintain fair, consistent standards across all events.' },
            ].map(({ title, desc }) => (
              <div key={title} className="bg-base border border-line rounded-xl p-6">
                <p className="text-brand font-black text-lg mb-2">{title}</p>
                <p className="text-[#e5e5e5]/50 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Committee ── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Leadership</p>
        <h2 className="text-3xl font-black text-white text-center mb-3">The Committee</h2>
        <p className="text-[#e5e5e5]/40 text-sm text-center mb-14 max-w-md mx-auto">
          ALSA is led by a volunteer committee of players and organisers committed to the growth of the sport.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {committee.map((member, i) => {
            const name = member.name ?? 'Committee Member'
            const role = member.role ?? ''
            const bio = member.bio ?? ''
            const imageUrl = member.image_url ?? null
            const initials = member.initials ?? (name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?')
            return (
              <div
                key={i}
                className="bg-surface border border-line hover:border-brand/30 rounded-2xl p-8 flex flex-col items-center text-center transition-all group"
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={name}
                    className="w-20 h-20 rounded-full object-cover mb-5 flex-shrink-0 border-2 border-line group-hover:border-brand/30 transition-colors"
                  />
                ) : (
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-xl font-black text-[#e5e5e5]/60 mb-5 flex-shrink-0 border-2 border-line group-hover:border-brand/30 transition-colors"
                    style={{ background: 'linear-gradient(135deg, #2D2D2D 0%, #191919 100%)' }}
                  >
                    {initials}
                  </div>
                )}
                <p className="text-white font-bold text-base mb-1">{name}</p>
                <p className="text-brand text-xs font-bold uppercase tracking-wider mb-4">{role}</p>
                <p className="text-[#e5e5e5]/45 text-xs leading-relaxed">{bio}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Partners ── */}
      <section className="bg-surface border-t border-line">
        <div className="max-w-7xl mx-auto px-6 py-20 text-center">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Supporters</p>
          <h2 className="text-3xl font-black text-white mb-4">Our Partners</h2>
          <p className="text-[#e5e5e5]/40 text-sm mb-12 max-w-md mx-auto">
            ALSA is supported by industry partners who share our passion for competitive laser sport.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {['Partner Logo', 'Partner Logo', 'Partner Logo', 'Partner Logo'].map((label, i) => (
              <div
                key={i}
                className="border border-line rounded-xl h-24 flex items-center justify-center hover:border-brand/30 transition-colors"
              >
                <p className="text-[#e5e5e5]/20 text-xs uppercase tracking-wider">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-[#e5e5e5]/25 text-xs mt-8">
            Interested in partnering with ALSA?{' '}
            <Link to="/contact" className="text-brand hover:underline">Get in touch</Link>
          </p>
        </div>
      </section>

      <Footer />
    </div>
  )
}
