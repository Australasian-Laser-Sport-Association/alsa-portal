import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-navy-deep border-t border-line mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">

          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-5">
              <img src="/alsa-logo.png" alt="ALSA" style={{ height: 44 }} />
              <div>
                <p className="font-black text-base tracking-wider text-brand uppercase leading-none">ALSA</p>
                <p className="text-[#e5e5e5]/30 text-xs mt-0.5 leading-none">Australasian Laser Sport Association</p>
              </div>
            </div>
            <p className="text-[#e5e5e5]/40 text-sm leading-relaxed max-w-xs">
              The governing body for competitive laser sport across Australia and New Zealand.
              Hosting the annual ZLTAC championship since 2018.
            </p>
            <div className="flex gap-4 mt-6">
              {['Facebook', 'Instagram', 'YouTube'].map(s => (
                <a key={s} href="#" className="text-[#e5e5e5]/30 hover:text-brand text-xs transition-colors">
                  {s}
                </a>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#e5e5e5]/25 mb-4">Navigation</p>
            <div className="flex flex-col gap-2.5">
              {[
                { label: 'Home', to: '/' },
                { label: 'About ALSA', to: '/about' },
                { label: 'ZLTAC History', to: '/zltac' },
                { label: 'Contact', to: '/contact' },
              ].map(({ label, to }) => (
                <Link key={to} to={to} className="text-[#e5e5e5]/45 hover:text-brand text-sm transition-colors">
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* ZLTAC 2027 */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand/50 mb-4">ZLTAC 2027</p>
            <div className="flex flex-col gap-2.5">
              {[
                { label: 'Event Hub', to: '/zltac/2027' },
                { label: 'Player Registration', to: '/zltac/register' },
                { label: 'Register as Captain', to: '/captain' },
                { label: 'Results', to: '/results' },
              ].map(({ label, to }) => (
                <Link key={to} to={to} className="text-[#e5e5e5]/45 hover:text-brand text-sm transition-colors">
                  {label}
                </Link>
              ))}
            </div>
          </div>

        </div>

        {/* Bottom */}
        <div className="border-t border-line pt-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-[#e5e5e5]/25 text-xs">
            © 2025 Australasian Laser Sport Association (ALSA). All rights reserved.
          </p>
          <div className="flex gap-6">
            <a href="#" className="text-[#e5e5e5]/25 hover:text-brand text-xs transition-colors">Privacy Policy</a>
            <a href="#" className="text-[#e5e5e5]/25 hover:text-brand text-xs transition-colors">Terms of Use</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
