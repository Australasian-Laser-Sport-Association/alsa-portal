import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Footer from '../../components/Footer'
import { useAuth } from '../../lib/useAuth'

// Public competition detail page. Anon-readable. The registration CTA gates
// on auth: unauthenticated users are routed to /login?redirect=<this page>
// so they return here (the public registration target lives at
// /competitions/:slug/register, landing in Phase 3c — for now the CTA
// is a placeholder that surfaces 'Coming soon').

function formatDateRange(start, end) {
  if (!start || !end) return ''
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  const s = new Date(start).toLocaleDateString('en-AU', opts)
  const e = new Date(end).toLocaleDateString('en-AU', opts)
  return s === e ? s : `${s} to ${e}`
}

function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function windowState(comp) {
  const now = new Date()
  const open = comp.registration_open_at ? new Date(comp.registration_open_at) : null
  const close = comp.registration_close_at ? new Date(comp.registration_close_at) : null
  if (close && now > close) return 'closed'
  if (open && now < open) return 'not_yet_open'
  return 'open'
}

const TONE = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  grey:  'bg-[#374056] text-white border-line',
}

function Pill({ tone, children }) {
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <p className="text-white text-sm">{value || <span className="opacity-40">Not set</span>}</p>
    </div>
  )
}

export default function CompetitionDetail() {
  const { slug } = useParams()
  const { user, loading: authLoading } = useAuth()
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

  const state = windowState(comp)
  const winPill =
    state === 'closed' ? { tone: 'grey', label: 'Closed' } :
    state === 'not_yet_open' ? { tone: 'amber', label: `Opens ${formatDateTime(comp.registration_open_at)}` } :
    { tone: 'green', label: comp.registration_close_at ? `Closes ${formatDateTime(comp.registration_close_at)}` : 'Open' }

  // The registration target lives at /competitions/:slug/register (Phase 3c).
  // For now this page links there; until 3c ships, the route falls through to
  // the global NotFound route. The CTA text is honest about that for
  // authenticated users; sign-in users go through /login first and land on
  // the same target after auth.
  const registerPath = `/competitions/${comp.slug}/register`
  const signInPath = `/login?redirect=${encodeURIComponent(registerPath)}`

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
          <Link to="/competitions" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to competitions
          </Link>
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Competition</p>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">{comp.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-white text-sm opacity-80">
            <span>{formatDateRange(comp.start_date, comp.end_date)}</span>
            <span className="opacity-30">·</span>
            <Pill tone={winPill.tone}>{winPill.label}</Pill>
          </div>
        </div>
      </section>

      <section className="flex-1 max-w-3xl w-full mx-auto px-6 py-12 space-y-6">
        <div className="bg-surface border border-line rounded-2xl p-6">
          <p className="text-white text-xs font-bold uppercase tracking-wider mb-4">Quick facts</p>
          <div className="grid grid-cols-2 gap-4">
            <Fact label="Dates" value={formatDateRange(comp.start_date, comp.end_date)} />
            <Fact
              label="Price per player"
              value={comp.price_per_player != null ? `$${Number(comp.price_per_player).toFixed(2)} AUD` : null}
            />
            <Fact label="Registration opens" value={comp.registration_open_at ? formatDateTime(comp.registration_open_at) : null} />
            <Fact label="Registration closes" value={comp.registration_close_at ? formatDateTime(comp.registration_close_at) : null} />
          </div>
        </div>

        <div className="bg-surface border border-brand/30 rounded-2xl p-8 text-center">
          {state === 'closed' && (
            <>
              <p className="text-white text-lg font-bold mb-2">Registration is closed for this event.</p>
              <p className="text-white opacity-70 text-sm">Contact ALSA if you have any questions.</p>
            </>
          )}

          {state === 'not_yet_open' && (
            <>
              <p className="text-white text-lg font-bold mb-2">
                Registration opens {formatDateTime(comp.registration_open_at)}
              </p>
              <p className="text-white opacity-70 text-sm">Check back when registration opens to secure your spot.</p>
            </>
          )}

          {state === 'open' && (
            <>
              <p className="text-white text-lg font-bold mb-4">Ready to compete?</p>
              {authLoading ? (
                <div className="w-6 h-6 mx-auto border-2 border-brand border-t-transparent rounded-full animate-spin" />
              ) : user ? (
                <Link
                  to={registerPath}
                  className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
                >
                  Register now
                </Link>
              ) : (
                <Link
                  to={signInPath}
                  className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
                >
                  Sign in to register
                </Link>
              )}
              {comp.registration_close_at && (
                <p className="text-white opacity-50 text-xs mt-4">
                  Closes {formatDateTime(comp.registration_close_at)}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <Footer />
    </div>
  )
}
