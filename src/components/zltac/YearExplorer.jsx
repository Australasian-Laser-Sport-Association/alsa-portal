import { useMemo, useState } from 'react'
import { zltacHistory } from '../../data/zltacHistory'
import YearCard from './YearCard'

const DECADES = [
  { key: 'all',       label: 'All' },
  { key: '1999-2009', label: '1999-2009' },
  { key: '2010-2019', label: '2010-2019' },
  { key: '2020+',     label: '2020+' },
]

const STATES = ['all', 'VIC', 'QLD', 'NSW', 'TAS', 'WA', 'SA', 'ACT', 'NT', 'NZ']

function inDecade(year, key) {
  if (key === 'all') return true
  if (key === '1999-2009') return year >= 1999 && year <= 2009
  if (key === '2010-2019') return year >= 2010 && year <= 2019
  if (key === '2020+') return year >= 2020
  return true
}

function eventMatchesSearch(event, q) {
  if (!q) return false
  if (event.divisions) {
    for (const key of Object.keys(event.divisions)) {
      const list = event.divisions[key]
      if (!list) continue
      for (const entry of list) {
        if (entry.name?.toLowerCase().includes(q)) return true
        if (entry.subtitle?.toLowerCase().includes(q)) return true
      }
    }
  }
  if (event.location?.toLowerCase().includes(q)) return true
  if (event.notes?.toLowerCase().includes(q)) return true
  return false
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border transition-all ${
        active
          ? 'bg-brand text-black border-brand shadow-[0_0_12px_rgba(0,255,65,0.3)]'
          : 'bg-surface text-[#e5e5e5]/60 border-line hover:border-brand/40 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

export default function YearExplorer({ stateFilter, onStateFilterChange }) {
  const [decadeFilter, setDecadeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())

  const trimmedQuery = search.trim().toLowerCase()
  const isSearching = trimmedQuery.length > 0

  const { historicEvents, upcomingEvent, matchCount } = useMemo(() => {
    const allEvents = zltacHistory.events
    const upcomingEvent = allEvents.find(e => e.upcoming) ?? null

    // Render newest first; exclude the upcoming tile from the main grid
    const candidates = allEvents
      .filter(e => !e.upcoming)
      .slice()
      .sort((a, b) => b.year - a.year)

    const filtered = candidates.filter(e => {
      if (!inDecade(e.year, decadeFilter)) return false
      if (stateFilter !== 'all') {
        // 2021 cancelled has no state — only include when state filter is "all"
        if (!e.state) return false
        if (e.state !== stateFilter) return false
      }
      if (isSearching) {
        return eventMatchesSearch(e, trimmedQuery)
      }
      return true
    })

    const matchCount = isSearching ? filtered.length : null
    return { historicEvents: filtered, upcomingEvent, matchCount }
  }, [decadeFilter, stateFilter, isSearching, trimmedQuery])

  function toggleExpanded(year) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  function clearFilters() {
    setDecadeFilter('all')
    onStateFilterChange('all')
    setSearch('')
  }

  const filtersActive = decadeFilter !== 'all' || stateFilter !== 'all' || isSearching

  return (
    <section id="year-explorer" className="max-w-7xl mx-auto px-6 pt-10 md:pt-12 pb-20 md:pb-24">
      <div className="text-center mb-10">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Year Explorer</p>
        <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Every Championship, 1999-2026</h2>
        <p className="text-[#e5e5e5]/45 text-sm max-w-xl mx-auto">
          Filter by decade or state, search across team names and player aliases, and click any year to see the full format results.
        </p>
      </div>

      {/* Filter controls */}
      <div className="bg-surface border border-line rounded-2xl p-5 md:p-6 mb-8 space-y-5">

        {/* Search */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/40 mb-2">
            Search players or teams
          </label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e5e5e5]/30 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="e.g. Bootza, Wolfpack, Sinclair…"
              className="w-full bg-base border border-line rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
            />
          </div>
        </div>

        {/* Decade chips */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/40 mb-2">Decade</p>
          <div className="flex flex-wrap gap-2">
            {DECADES.map(d => (
              <Chip key={d.key} active={decadeFilter === d.key} onClick={() => setDecadeFilter(d.key)}>
                {d.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* State chips */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/40 mb-2">Host region</p>
          <div className="flex flex-wrap gap-2">
            {STATES.map(s => (
              <Chip key={s} active={stateFilter === s} onClick={() => onStateFilterChange(s)}>
                {s === 'all' ? 'All' : s}
              </Chip>
            ))}
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-[#e5e5e5]/40">
            {isSearching
              ? `${matchCount} year${matchCount === 1 ? '' : 's'} match "${search.trim()}"`
              : `${historicEvents.length} year${historicEvents.length === 1 ? '' : 's'} shown`}
          </p>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-brand/70 hover:text-brand font-bold uppercase tracking-wider transition-colors"
            >
              Clear filters ✕
            </button>
          )}
        </div>
      </div>

      {/* Year grid */}
      {historicEvents.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl py-16 px-6 text-center">
          <p className="text-[#e5e5e5]/40 text-sm font-medium">No years match your filters.</p>
          <p className="text-[#e5e5e5]/25 text-xs mt-1">Try removing a chip or clearing the search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {historicEvents.map(event => (
            <YearCard
              key={event.year}
              event={event}
              expanded={expanded.has(event.year)}
              onToggle={() => toggleExpanded(event.year)}
              matchesSearch={isSearching}
            />
          ))}
        </div>
      )}

      {/* Upcoming tile */}
      {upcomingEvent && (
        <>
          <div className="flex items-center gap-3 mt-12 mb-4">
            <p className="text-[10px] uppercase tracking-widest text-[#e5e5e5]/40 font-bold">On the horizon</p>
            <div className="flex-1 h-px bg-line" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <YearCard event={upcomingEvent} expanded={false} onToggle={() => {}} matchesSearch={false} />
          </div>
        </>
      )}
    </section>
  )
}
