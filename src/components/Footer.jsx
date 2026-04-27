import { Link } from 'react-router-dom'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

const QUICK_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'ZLTAC', to: '/zltac' },
  { label: 'Contact', to: '/contact' },
]

const ACKNOWLEDGEMENT =
  'ALSA acknowledges the Traditional Custodians of the lands on which we play laser sport across Australasia, and pays respect to Elders past and present.'

function getCountdown(event) {
  if (!event?.start_date || !event?.end_date) return null
  const todayMs = new Date(new Date().toDateString()).getTime()
  const startMs = new Date(`${event.start_date}T00:00:00`).getTime()
  const endMs = new Date(`${event.end_date}T00:00:00`).getTime()
  if (todayMs >= startMs && todayMs <= endMs) {
    return { type: 'live', text: `ZLTAC ${event.year} — Live Now` }
  }
  if (todayMs < startMs) {
    const days = Math.floor((startMs - todayMs) / 86400000)
    return { type: 'upcoming', text: `${days} days until ZLTAC ${event.year}` }
  }
  return null
}

export default function Footer() {
  const { event } = useCurrentEvent()
  const countdown = getCountdown(event)
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-navy-deep border-t border-line mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">

          {/* Brand + Legal */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-5">
              <img src="/alsa-logo.png" alt="ALSA" style={{ height: 44 }} />
              <div>
                <p className="font-black text-base tracking-wider text-brand uppercase leading-none">ALSA</p>
                <p className="text-[#e5e5e5]/30 text-xs mt-0.5 leading-none">Australasian Laser Sport Association</p>
              </div>
            </div>
            <p className="text-[#e5e5e5]/40 text-sm leading-relaxed max-w-xs mb-6">
              The governing body for competitive laser sport across Australasia.
              Hosting the ZLTAC championship since 1999.
            </p>
            <div className="text-[#e5e5e5]/30 text-xs space-y-1">
              <p>Australasian Laser Sport Association Inc.</p>
              <p>ABN 82 796 875 094</p>
              <p>Reg. A0127794G (Vic.)</p>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#e5e5e5]/25 mb-4">Quick Links</p>
            <div className="flex flex-col gap-2.5">
              {QUICK_LINKS.map(({ label, to }) => (
                <Link key={to} to={to} className="text-[#e5e5e5]/45 hover:text-brand text-sm transition-colors">
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Connect + Countdown */}
          <div className="flex flex-col gap-8">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#e5e5e5]/25 mb-4">Connect</p>
              <a
                href="https://www.facebook.com/AustralasianLaserSport"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#e5e5e5]/45 hover:text-brand text-sm transition-colors"
                aria-label="ALSA on Facebook"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/>
                </svg>
                Facebook
              </a>
            </div>

            {countdown && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand/50 mb-2">
                  {countdown.type === 'live' ? 'Happening Now' : 'Coming Up'}
                </p>
                <p className={`text-sm font-bold ${countdown.type === 'live' ? 'text-brand' : 'text-white'}`}>
                  {countdown.text}
                </p>
              </div>
            )}
          </div>

        </div>

        {/* Acknowledgement of Country */}
        <div className="mt-12 pt-8 border-t border-line">
          <p className="text-[#e5e5e5]/35 text-xs leading-relaxed max-w-3xl">
            {ACKNOWLEDGEMENT}
          </p>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-6 border-t border-line">
          <p className="text-[#e5e5e5]/25 text-xs">
            © {currentYear} Australasian Laser Sport Association Inc. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
