import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Footer from '../../components/Footer'
import { useAuth } from '../../lib/useAuth'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDateRange, formatDateTime } from '../../lib/dateFormat'

// Authenticated registration confirmation page for a pre-nationals
// competition. Validates the competition is open and the caller is not
// already registered, then exposes a single "Confirm Registration" CTA that
// POSTs /api/superadmin/competition-registration and navigates to the hub.

function windowState(comp) {
  const now = new Date()
  const open = comp.registration_open_at ? new Date(comp.registration_open_at) : null
  const close = comp.registration_close_at ? new Date(comp.registration_close_at) : null
  if (close && now > close) return 'closed'
  if (open && now < open) return 'not_yet_open'
  return 'open'
}

export default function CompetitionRegister() {
  const { slug } = useParams()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [comp, setComp] = useState(null) // null = loading; false = not found
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Auth gate. Non-authed users bounce to /login with a redirect back here.
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      const here = `/competitions/${slug}/register`
      navigate(`/login?redirect=${encodeURIComponent(here)}`, { replace: true })
    }
  }, [user, authLoading, slug, navigate])

  // Fetch competition + check existing registration in parallel. If already
  // registered, hop straight to the hub.
  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false

    fetch(`/api/public?resource=competitions&slug=${encodeURIComponent(slug)}`)
      .then(async r => {
        if (r.status === 404) return false
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(async data => {
        if (cancelled) return
        if (!data) { setComp(false); return }
        setComp(data)
        // Probe existing registration. If found, redirect to hub.
        try {
          await apiFetch(`/api/superadmin/competition-registration?competition_id=${data.id}`)
          if (!cancelled) navigate(`/competitions/${slug}/hub`, { replace: true })
        } catch {
          // 404 means not registered yet — that's the happy path here.
        }
      })
      .catch(err => { if (!cancelled) { setError(err.message); setComp(false) } })

    return () => { cancelled = true }
  }, [user, authLoading, slug, navigate])

  async function confirm() {
    if (!comp) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await apiFetch('/api/superadmin/competition-registration', {
        method: 'POST',
        body: JSON.stringify({ competition_id: comp.id }),
      })
      navigate(`/competitions/${slug}/hub`, { replace: true })
    } catch (err) {
      setSubmitError(err.message || 'Could not register. Please try again.')
      setSubmitting(false)
    }
  }

  if (authLoading || (user && comp === null)) {
    return (
      <div className="bg-base text-white min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return null // redirect is in flight

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
            {error && <p role="alert" className="text-red-400 text-xs mt-3">{error}</p>}
          </div>
        </section>
        <Footer />
      </div>
    )
  }

  const state = windowState(comp)
  const backToDetail = `/competitions/${comp.slug}`

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
          <Link to={backToDetail} className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to {comp.name}
          </Link>
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Registration</p>
          <h1 className="text-4xl md:text-5xl font-black text-white">{comp.name}</h1>
        </div>
      </section>

      <section className="flex-1 max-w-2xl w-full mx-auto px-6 py-12">
        {state === 'closed' && (
          <div className="bg-surface border border-line rounded-2xl p-6 text-center">
            <p className="text-white font-bold mb-2">Registration is closed for this event.</p>
            <Link to={backToDetail} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
          </div>
        )}

        {state === 'not_yet_open' && (
          <div className="bg-surface border border-line rounded-2xl p-6 text-center">
            <p className="text-white font-bold mb-2">
              Registration opens {formatDateTime(comp.registration_open_at)}.
            </p>
            <Link to={backToDetail} className="text-brand text-sm font-semibold hover:underline">← Back to event</Link>
          </div>
        )}

        {state === 'open' && (
          <div className="bg-surface border border-brand/30 rounded-2xl p-8">
            <p className="text-white text-xs font-bold uppercase tracking-wider opacity-60 mb-2">Confirm registration</p>
            <h2 className="text-white text-2xl font-black mb-4">{comp.name}</h2>

            <div className="space-y-2 mb-6">
              <p className="text-white text-sm">
                <span className="opacity-60">Dates:</span> {formatDateRange(comp.start_date, comp.end_date)}
              </p>
              {comp.price_per_player != null && (
                <p className="text-white text-sm">
                  <span className="opacity-60">Price:</span> ${Number(comp.price_per_player).toFixed(2)} AUD per player
                </p>
              )}
              {comp.registration_close_at && (
                <p className="text-white text-sm">
                  <span className="opacity-60">Closes:</span> {formatDateTime(comp.registration_close_at)}
                </p>
              )}
            </div>

            <p className="text-white text-sm opacity-70 leading-relaxed mb-6">
              By registering you confirm your attendance at this event. Payment instructions will be provided in your hub after registration.
            </p>

            {submitError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{submitError}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={submitting}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
              >
                {submitting ? 'Registering...' : 'Confirm registration'}
              </button>
              <Link
                to={backToDetail}
                className="border border-line text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
              >
                Back to event
              </Link>
            </div>
          </div>
        )}
      </section>

      <Footer />
    </div>
  )
}
