import { Link } from 'react-router-dom'
import { MapPin, Calendar } from 'lucide-react'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { formatDate } from '../lib/dateFormat'

function formatDateRange(start, end) {
  if (!start && !end) return ''
  if (!end) return formatDate(start)
  if (!start) return formatDate(end)
  const s = new Date(start)
  const e = new Date(end)
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}-${e.getDate()} ${e.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}`
  }
  return `${formatDate(start, 'short')} - ${formatDate(end, 'short')}`
}

export default function ActiveEventBanner() {
  const { event } = useCurrentEvent()
  if (!event || event.status !== 'open') return null

  const dateRange = formatDateRange(event.start_date, event.end_date)
  const titleParts = [`${event.name} ${event.year}`]
  if (event.location) titleParts.push(event.location)
  const eventTitle = titleParts.join(' · ')

  return (
    <section className="bg-gradient-to-r from-green-500/15 via-green-500/10 to-green-500/15 border-y border-green-500/30">
      <div className="max-w-7xl mx-auto px-6 py-5 md:py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-8">

        {/* LEFT — status */}
        <div className="flex items-center gap-3 justify-center md:justify-start">
          <span
            className="h-2.5 w-2.5 rounded-full bg-green-400 animate-pulse flex-shrink-0 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
            aria-hidden
          />
          <p className="text-green-400 text-sm font-bold tracking-widest uppercase">
            Registration Open
          </p>
        </div>

        {/* MIDDLE — event */}
        <div className="flex items-center gap-3 justify-center md:justify-start min-w-0">
          <MapPin className="h-5 w-5 text-green-400 flex-shrink-0" aria-hidden />
          <h2 className="text-white text-xl md:text-2xl font-bold leading-tight truncate">
            {eventTitle}
          </h2>
        </div>

        {/* RIGHT — dates + CTA */}
        <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 md:flex-shrink-0">
          {dateRange && (
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-green-400 flex-shrink-0" aria-hidden />
              <span className="text-base font-semibold text-white whitespace-nowrap">{dateRange}</span>
            </div>
          )}
          <Link
            to={`/events/${event.year}`}
            className="px-6 py-3 bg-green-500 hover:bg-green-400 text-black font-bold rounded-lg transition w-full sm:w-auto text-center"
          >
            Register Now
          </Link>
        </div>
      </div>
    </section>
  )
}
