import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Footer from '../components/Footer'
import StatsStrip from '../components/zltac/StatsStrip'
import FormatEvolutionTimeline from '../components/zltac/FormatEvolutionTimeline'
import YearExplorer from '../components/zltac/YearExplorer'
import HostingGrid from '../components/zltac/HostingGrid'
import LegendsAndDynasties from '../components/zltac/LegendsAndDynasties'
import HallOfFame from '../components/zltac/HallOfFame'
import { supabase } from '../lib/supabase'
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

function ActiveEventBanner({ event }) {
  if (!event) return null
  const dateRange = formatDateRange(event.start_date, event.end_date)
  const title = event.location
    ? `${event.name} ${event.year}, ${event.location}`
    : `${event.name} ${event.year}`
  return (
    <section className="bg-brand/5 border-b border-brand/30">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="w-2 h-2 rounded-full bg-brand animate-pulse flex-shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand mb-0.5">Registration Open</p>
            <p className="text-white font-bold text-sm md:text-base truncate">{title}</p>
            {dateRange && (
              <p className="text-white/60 text-xs mt-0.5">{dateRange}</p>
            )}
          </div>
        </div>
        <Link
          to={`/events/${event.year}`}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2 rounded-lg text-sm transition-all hover:shadow-[0_0_16px_rgba(0,255,65,0.35)] whitespace-nowrap text-center w-full sm:w-auto sm:flex-shrink-0"
        >
          Register Now
        </Link>
      </div>
    </section>
  )
}

function useActiveEvent() {
  const [event, setEvent] = useState(null)
  useEffect(() => {
    let cancelled = false
    supabase
      .from('zltac_events')
      .select('id, name, year, location, start_date, end_date, status')
      .in('status', ['open', 'upcoming'])
      .order('year', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setEvent(error ? null : (data ?? null))
      })
      .catch(() => { if (!cancelled) setEvent(null) })
    return () => { cancelled = true }
  }, [])
  return event
}

export default function ZLTACLanding() {
  // State filter is lifted up so HostingGrid can drive YearExplorer.
  const [stateFilter, setStateFilter] = useState('all')
  const activeEvent = useActiveEvent()

  function handleSelectRegion(region) {
    // Toggle off if already selected, otherwise apply the filter and scroll up.
    setStateFilter(prev => {
      const next = prev === region ? 'all' : region
      if (next !== 'all') {
        // Defer scroll to next frame so the filter has applied.
        requestAnimationFrame(() => {
          document.getElementById('year-explorer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
      return next
    })
  }

  return (
    <div className="bg-base text-white">

      {/* ── Hero ── */}
      <section
        className="relative py-24 md:py-32 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.07) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative text-center px-6 max-w-3xl mx-auto">
          <img
            src="/images/zltac-logo.png"
            alt="ZLTAC logo"
            loading="eager"
            className="mx-auto h-24 md:h-32 w-auto mb-6 md:mb-8"
          />
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">The Championship</p>
          <h1 className="text-5xl md:text-7xl font-black text-white mb-4 leading-none">ZLTAC</h1>
          <p className="text-brand font-semibold text-lg md:text-xl mb-6">Zone Laser Tag Australasian Championship</p>
          <p className="text-white/90 text-base md:text-lg leading-relaxed max-w-2xl mx-auto">
            28 years of Australasian laser sport history. The main team championship plus side events: Solos, Doubles, Triples, Masters, Womens, Juniors, and Lord of the Rings.
          </p>
        </div>
      </section>

      <ActiveEventBanner event={activeEvent} />
      <StatsStrip />
      <FormatEvolutionTimeline />
      <YearExplorer
        stateFilter={stateFilter}
        onStateFilterChange={setStateFilter}
      />
      <HostingGrid
        selectedRegion={stateFilter === 'all' ? null : stateFilter}
        onSelectRegion={handleSelectRegion}
      />
      <LegendsAndDynasties />
      <HallOfFame />

      <Footer />
    </div>
  )
}
