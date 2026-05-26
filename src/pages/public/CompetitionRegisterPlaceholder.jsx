import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Footer from '../../components/Footer'

// Stand-in for /competitions/:slug/register until Phase 3c ships the real
// registration flow. Validates the slug via the same anon public API used by
// CompetitionDetail, so unknown slugs render the same "Competition not found"
// state rather than a generic "Coming soon" for any path.
//
// When Phase 3c lands, replace this file with the real registration page and
// keep the route mounted at the same path.

export default function CompetitionRegisterPlaceholder() {
  const { slug } = useParams()
  const [comp, setComp] = useState(null) // null = loading; false = not found
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/public?resource=competitions&slug=${encodeURIComponent(slug)}`)
      .then(async r => {
        if (r.status === 404) return false
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { if (!cancelled) setComp(data) })
      .catch(err => { if (!cancelled) { setError(err.message); setComp(false) } })
    return () => { cancelled = true }
  }, [slug])

  if (comp === null) {
    return (
      <div className="bg-base text-white min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (comp === false) {
    return (
      <div className="bg-base text-white min-h-screen flex flex-col">
        <section className="flex-1 max-w-2xl w-full mx-auto px-6 py-16">
          <Link to="/competitions" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to competitions
          </Link>
          <div className="bg-surface border border-line rounded-2xl p-6">
            <p className="text-white font-bold mb-2">Competition not found</p>
            <p className="text-white text-sm opacity-70">
              We could not find a competition with that URL. It may have been archived or the registration window may have closed.
            </p>
            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
          </div>
        </section>
        <Footer />
      </div>
    )
  }

  return (
    <div className="bg-base text-white min-h-screen flex flex-col">
      <section
        className="relative py-20 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.07) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative max-w-3xl mx-auto px-6">
          <Link to={`/competitions/${comp.slug}`} className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to {comp.name}
          </Link>
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Registration</p>
          <h1 className="text-4xl md:text-5xl font-black text-white">{comp.name}</h1>
        </div>
      </section>

      <section className="flex-1 max-w-2xl w-full mx-auto px-6 py-12">
        <div className="bg-surface border border-brand/30 rounded-2xl p-8 text-center">
          <p className="text-white font-bold text-xl mb-3">Registration coming soon</p>
          <p className="text-white text-sm opacity-70 leading-relaxed mb-6">
            Registration for <span className="text-white font-semibold">{comp.name}</span> is being built.
            Check back in the next few days, or contact a superadmin if you need to register manually.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to={`/competitions/${comp.slug}`}
              className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
            >
              Back to competition
            </Link>
            <Link
              to="/competitions"
              className="border border-line text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              Back to all competitions
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
