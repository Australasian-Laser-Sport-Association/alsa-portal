import { Link } from 'react-router-dom'
import Footer from '../components/Footer'

export default function CaptainRegister2027() {
  return (
    <div className="bg-base text-white">
      <section
        className="relative py-24 border-b border-line overflow-hidden"
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
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">ZLTAC 2027</p>
          <div className="text-5xl mb-4">👑</div>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-3">Captain Registration</h1>
          <p className="text-[#e5e5e5]/50 text-lg max-w-lg mx-auto">Create your team and lead your squad to the championship</p>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-6 py-20 text-center">
        <div className="bg-surface border border-brand/20 rounded-2xl p-10">
          <div className="w-16 h-16 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center text-3xl mx-auto mb-6">
            🚧
          </div>
          <h2 className="text-2xl font-black text-white mb-3">Coming Soon</h2>
          <p className="text-[#e5e5e5]/50 text-sm leading-relaxed mb-8">
            Captain registration for ZLTAC 2027 is being finalised. Once open, captains will be able to create a team,
            generate an invite code for players, manage their roster, and submit the official team entry.
          </p>
          <div className="bg-base border border-line rounded-xl p-5 text-left mb-8">
            <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider font-bold mb-3">What you'll need as captain:</p>
            <ul className="space-y-2">
              {[
                'A registered ALSA account',
                'Your team name',
                'Your team roster (players register separately using your invite code)',
                'Completed Code of Conduct and Referee Test',
                'Payment of team entry fee',
              ].map(item => (
                <li key={item} className="flex items-start gap-2 text-sm text-[#e5e5e5]/60">
                  <span className="text-brand mt-0.5 flex-shrink-0">·</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/zltac/2027"
              className="border border-line hover:border-brand text-[#e5e5e5]/70 hover:text-brand font-semibold px-6 py-3 rounded-xl text-sm transition-all"
            >
              ← Back to ZLTAC 2027
            </Link>
            <Link
              to="/contact"
              className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
            >
              Contact ALSA for Updates
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
