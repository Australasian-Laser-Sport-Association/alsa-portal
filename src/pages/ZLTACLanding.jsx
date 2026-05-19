import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Footer from '../components/Footer'
import StatsStrip from '../components/zltac/StatsStrip'
import FormatEvolutionTimeline from '../components/zltac/FormatEvolutionTimeline'
import YearExplorer from '../components/zltac/YearExplorer'
import HostingGrid from '../components/zltac/HostingGrid'
import LegendsAndDynasties from '../components/zltac/LegendsAndDynasties'
import HallOfFame from '../components/zltac/HallOfFame'

function memberInitials(p) {
  const a = (p.first_name?.[0] ?? '').toUpperCase()
  const b = (p.last_name?.[0] ?? '').toUpperCase()
  return (a + b) || (p.alias?.[0]?.toUpperCase() ?? '?')
}

function memberFullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.alias || 'Committee Member'
}

export default function ZLTACLanding() {
  // State filter is lifted up so HostingGrid can drive YearExplorer.
  const [stateFilter, setStateFilter] = useState('all')
  const [committee, setCommittee] = useState([])
  const [historyRows, setHistoryRows] = useState([])
  const [placingRows, setPlacingRows] = useState([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/public?resource=committee')
      .then(r => r.ok ? r.json() : { zltac: [] })
      .then(data => { if (!cancelled) setCommittee(data.zltac ?? []) })
      .catch(() => { if (!cancelled) setCommittee([]) })
    return () => { cancelled = true }
  }, [])

  // Year-level metadata + all placings, fetched once at the page level and
  // composed into the events shape consumed by YearExplorer / YearCard /
  // FormatEvolutionTimeline (same shape the static file used).
  useEffect(() => {
    let cancelled = false

    supabase
      .from('zltac_event_history')
      .select('year, team_count, location_city, location_state, location_venue, location_country, is_cancelled, is_upcoming, description, historic_note')
      .order('year', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        setHistoryRows(error ? [] : (data ?? []))
      })

    supabase
      .from('zltac_event_placings')
      .select('tournament_year, division, rank, name, subtitle')
      .order('tournament_year', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        setPlacingRows(error ? [] : (data ?? []))
      })

    return () => { cancelled = true }
  }, [])

  const events = useMemo(() => {
    // Group placings: year → division → [{rank, name, subtitle}, …] sorted by rank.
    const byYear = new Map()
    for (const p of placingRows) {
      let divs = byYear.get(p.tournament_year)
      if (!divs) { divs = new Map(); byYear.set(p.tournament_year, divs) }
      let list = divs.get(p.division)
      if (!list) { list = []; divs.set(p.division, list) }
      list.push({ rank: p.rank, name: p.name, subtitle: p.subtitle })
    }
    for (const divs of byYear.values()) {
      for (const list of divs.values()) list.sort((a, b) => a.rank - b.rank)
    }

    return historyRows.map(h => {
      const divs = byYear.get(h.year)
      const divisions = divs
        ? Object.fromEntries(Array.from(divs.entries()))
        : undefined
      return {
        year: h.year,
        teamCount: h.team_count,
        location: h.location_venue,
        city: h.location_city,
        state: h.location_state,
        country: h.location_country,
        cancelled: !!h.is_cancelled,
        upcoming: !!h.is_upcoming,
        notes: h.description ?? null,
        historicNote: h.historic_note ?? null,
        divisions,
      }
    })
  }, [historyRows, placingRows])

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

      <StatsStrip />
      <FormatEvolutionTimeline events={events} />

      {/* ── ZLTAC Committee ── */}
      <section className="bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Governance</p>
          <h2 className="text-3xl font-black text-white text-center mb-2">ZLTAC Committee</h2>
          <p className="text-brand text-sm uppercase tracking-widest text-center mb-2">ALSA Sub-Committee</p>
          <p className="text-[#e5e5e5]/40 text-sm text-center mb-14 max-w-md mx-auto">
            The ZLTAC committee runs the championship year-round under the ALSA umbrella — formats, scheduling, host coordination, and the rules of play.
          </p>
          {committee.length === 0 ? (
            <p className="text-center text-[#e5e5e5]/30 text-sm">Committee details will appear here soon.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
              {committee.map(p => (
                <div
                  key={p.id}
                  className="bg-base border border-line hover:border-brand/30 rounded-2xl p-4 md:p-5 flex flex-col items-center text-center transition-all"
                >
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5 flex-shrink-0 bg-brand/20 mx-auto overflow-hidden">
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt={memberFullName(p)} className="w-full h-full object-cover" />
                      : <span className="text-brand font-bold text-2xl">{memberInitials(p)}</span>
                    }
                  </div>
                  <p className="text-white font-bold text-lg mb-2">{memberFullName(p)}</p>
                  <p className="text-brand text-sm font-semibold uppercase tracking-wide mb-2">Committee Member</p>
                  {p.alias && (
                    <p className="text-white/80 text-base md:text-lg">
                      <span className="font-normal text-white/60">ALIAS</span> – <span className="font-bold">{p.alias}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <YearExplorer
        events={events}
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
