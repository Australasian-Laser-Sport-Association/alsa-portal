import { Link } from 'react-router-dom'
import { Target, ClipboardList, User, CreditCard } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

function formatDateRange(start, end) {
  if (!start && !end) return ''
  if (!end) return new Date(start).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  if (!start) return new Date(end).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

  const s = new Date(start)
  const e = new Date(end)
  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()

  if (sameMonth) {
    return `${s.getDate()}–${e.getDate()} ${e.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}`
  }
  if (sameYear) {
    return `${s.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })} – ${e.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`
  }
  return `${s.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} – ${e.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

export default function Welcome() {
  const { profile } = useAuth()
  const { event, loading: eventLoading } = useCurrentEvent()

  const firstName = profile?.first_name
  const heading = firstName
    ? `Email confirmed. Welcome, ${firstName}.`
    : 'Email confirmed. Welcome.'

  const dateRange = event ? formatDateRange(event.start_date, event.end_date) : ''
  const subhead = event ? [event.location, dateRange].filter(Boolean).join(' · ') : ''

  return (
    <div className="min-h-screen bg-base text-white py-12 px-6">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-black text-white mb-3">{heading}</h1>
          <p className="text-brand text-sm font-bold uppercase tracking-[0.15em] mb-4">
            You're now a registered ALSA Portal Member.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 mb-10">
            <div className="flex items-center gap-3">
              <Target className="w-5 h-5 text-brand shrink-0" />
              <span className="text-white/90 text-sm">Register for ZLTAC</span>
            </div>
            <div className="flex items-center gap-3">
              <ClipboardList className="w-5 h-5 text-brand shrink-0" />
              <span className="text-white/90 text-sm">Complete required forms</span>
            </div>
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-brand shrink-0" />
              <span className="text-white/90 text-sm">Manage your details</span>
            </div>
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-brand shrink-0" />
              <span className="text-white/90 text-sm">Handle event payments</span>
            </div>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Profile card */}
          <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col">
            <h2 className="text-xl font-bold text-white mb-2">Your Profile</h2>
            <p className="text-[#e5e5e5]/60 text-sm mb-6 flex-grow">
              Edit personal details and member info anytime.
            </p>
            <Link
              to="/dashboard"
              className="inline-block bg-line hover:bg-[#374056] text-white font-semibold rounded-lg px-4 py-2.5 text-sm text-center transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>

          {/* ZLTAC card — three render branches: loading / open / closed */}
          {eventLoading ? (
            <div className="bg-surface border border-line rounded-2xl p-6 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : event ? (
            <div className="bg-brand/10 border border-brand/40 rounded-2xl p-6 flex flex-col">
              {event.logo_url && (
                <img src={event.logo_url} alt="" style={{ height: 80 }} className="mb-4 self-start" />
              )}
              <h2 className="text-2xl font-black text-white mb-2">
                ZLTAC {event.year} is open!
              </h2>
              {subhead && (
                <p className="text-[#e5e5e5]/80 text-sm mb-6">{subhead}</p>
              )}
              <Link
                to={`/events/${event.year}`}
                className="inline-block bg-brand hover:bg-brand-hover text-black font-bold rounded-lg px-4 py-3 text-sm text-center transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.35)] mt-auto"
              >
                Register for ZLTAC {event.year}
              </Link>
            </div>
          ) : (
            <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col">
              <h2 className="text-xl font-bold text-white mb-2">ZLTAC registration not yet open</h2>
              <p className="text-[#e5e5e5]/60 text-sm mb-6 flex-grow">
                When the next ZLTAC is announced, you'll be able to register here. In the meantime, browse past championships.
              </p>
              <Link
                to="/zltac"
                className="inline-block bg-line hover:bg-[#374056] text-white font-semibold rounded-lg px-4 py-2.5 text-sm text-center transition-colors"
              >
                View Past Events
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
