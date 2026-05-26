import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Footer from '../../components/Footer'

// Public listing of ALSA events. No auth required.
//   - Mirrors ZLTACLanding's hero + content layout (no shared PublicLayout
//     exists; pages roll their own).
//   - Two sections: "Main Event" (ZLTAC) and "Pre-Nationals & Other Events"
//     (competitions). Hidden if empty; combined empty state if both are.
//   - Fetches /api/public?resource=competitions which now returns
//     { main_events, competitions } — bank details stripped server-side and
//     visibility filters mirror the anon RLS policies on both tables.

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

function windowStatus(comp) {
  const now = new Date()
  const open = comp.registration_open_at ? new Date(comp.registration_open_at) : null
  const close = comp.registration_close_at ? new Date(comp.registration_close_at) : null
  if (open && now < open) {
    return { label: `Opens ${formatDateTime(comp.registration_open_at)}`, tone: 'amber' }
  }
  if (close && now > close) {
    // Should not appear given the server filter, but defensive.
    return { label: 'Closed', tone: 'grey' }
  }
  if (close) {
    return { label: `Closes ${formatDateTime(comp.registration_close_at)}`, tone: 'green' }
  }
  if (open && now >= open) {
    return { label: 'Open now', tone: 'green' }
  }
  return { label: 'Open', tone: 'green' }
}

// ZLTAC events use a different date-bounded shape (reg_open_date /
// reg_close_date + status) than competitions. Map them to the same pill model
// so the cards look architecturally similar.
function zltacStatus(ev) {
  const now = new Date()
  const regOpen = ev.reg_open_date ? new Date(ev.reg_open_date) : null
  const regClose = ev.reg_close_date ? new Date(ev.reg_close_date) : null
  if (ev.status === 'archived') return { label: 'Archived', tone: 'grey' }
  if (ev.status === 'closed') return { label: 'Closed', tone: 'grey' }
  if (regOpen && now < regOpen) {
    return { label: `Opens ${formatDateTime(ev.reg_open_date)}`, tone: 'amber' }
  }
  if (regClose && now > regClose) {
    return { label: 'Closed', tone: 'grey' }
  }
  if (regClose) {
    return { label: `Closes ${formatDateTime(ev.reg_close_date)}`, tone: 'green' }
  }
  return { label: 'Open', tone: 'green' }
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

// Shared card chrome so the ZLTAC and pre-nats cards look architecturally the
// same — the section header does the differentiation, not the card itself.
function EventCard({ to, title, subtitle, dateLine, priceLine, pill }) {
  return (
    <Link
      to={to}
      className="block bg-surface border border-line hover:border-brand/40 rounded-2xl p-6 transition-colors"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-white text-xl font-black">{title}</h2>
          {subtitle && <p className="text-white opacity-50 text-xs mt-1">{subtitle}</p>}
          {dateLine && <p className="text-white opacity-70 text-sm mt-2">{dateLine}</p>}
          {priceLine && <p className="text-white opacity-50 text-xs mt-1">{priceLine}</p>}
        </div>
        <Pill tone={pill.tone}>{pill.label}</Pill>
      </div>
      <p className="text-brand text-xs font-bold uppercase tracking-wider mt-4">
        View details →
      </p>
    </Link>
  )
}

export default function CompetitionsList() {
  const [feed, setFeed] = useState(null) // null = loading; { main_events, competitions }
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/public?resource=competitions')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        if (cancelled) return
        // Tolerate the old array shape (during the brief window between API
        // and client deploys) so the page doesn't crash on a stale payload.
        if (Array.isArray(data)) {
          setFeed({ main_events: [], competitions: data })
        } else {
          setFeed({
            main_events: Array.isArray(data?.main_events) ? data.main_events : [],
            competitions: Array.isArray(data?.competitions) ? data.competitions : [],
          })
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setFeed({ main_events: [], competitions: [] })
        }
      })
    return () => { cancelled = true }
  }, [])

  const mainEvents = feed?.main_events ?? []
  const comps = feed?.competitions ?? []
  const bothEmpty = feed !== null && mainEvents.length === 0 && comps.length === 0

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
        <div className="relative text-center px-6">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">ALSA</p>
          <h1 className="text-4xl md:text-6xl font-black text-white mb-3">Competitions</h1>
          <p className="text-white opacity-60 text-base md:text-lg">Upcoming and open events</p>
        </div>
      </section>

      <section className="flex-1 max-w-4xl w-full mx-auto px-6 py-12 space-y-10">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm"><strong>Error:</strong> {error}</p>
          </div>
        )}

        {feed === null ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : bothEmpty ? (
          <div className="bg-surface border border-line rounded-2xl px-6 py-16 text-center">
            <p className="text-white text-base font-semibold mb-2">No competitions available right now.</p>
            <p className="text-white opacity-70 text-sm">Check back soon.</p>
          </div>
        ) : (
          <>
            {mainEvents.length > 0 && (
              <div>
                <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Main Event</h2>
                <div className="space-y-4">
                  {mainEvents.map(ev => {
                    const pill = zltacStatus(ev)
                    const location = [ev.location, ev.venue].filter(Boolean).join(' · ')
                    return (
                      <EventCard
                        key={ev.id}
                        to={`/events/${ev.year}`}
                        title={`${ev.name}`}
                        subtitle={location || null}
                        dateLine={formatDateRange(ev.start_date, ev.end_date)}
                        priceLine={null}
                        pill={pill}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {comps.length > 0 && (
              <div>
                <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Pre-Nationals &amp; Other Events</h2>
                <div className="space-y-4">
                  {comps.map(c => {
                    const pill = windowStatus(c)
                    return (
                      <EventCard
                        key={c.id}
                        to={`/competitions/${c.slug}`}
                        title={c.name}
                        subtitle={null}
                        dateLine={formatDateRange(c.start_date, c.end_date)}
                        priceLine={c.price_per_player != null ? `$${Number(c.price_per_player).toFixed(2)} AUD per player` : null}
                        pill={pill}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <Footer />
    </div>
  )
}
