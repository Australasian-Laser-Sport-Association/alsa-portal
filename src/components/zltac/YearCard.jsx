const DIVISION_LABELS = {
  team:    'Teams',
  solos:   'Solos',
  doubles: 'Doubles',
  triples: 'Triples',
  masters: 'Masters',
  womens:  'Womens',
  juniors: 'Juniors',
  lotr:    'Lord of the Rings',
}

// Side-event order in the expanded grid (Team is rendered separately as the main event).
const SIDE_FORMATS = ['solos', 'doubles', 'triples', 'masters', 'womens', 'juniors', 'lotr']

function RankChip({ rank, glow }) {
  const styles = {
    1: 'bg-brand text-black',
    2: 'bg-[#C0C0C0] text-black',
    3: 'bg-[#CD7F32] text-black',
    4: 'bg-line text-[#e5e5e5]/70',
  }
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-black flex-shrink-0 ${styles[rank] ?? styles[4]}`}
      style={glow ? { boxShadow: '0 0 12px rgba(74,222,128,0.45)' } : undefined}
    >
      {rank}
    </span>
  )
}

function FormatList({ name, entries, highlightFirstRank }) {
  return (
    <div>
      <p className="text-[#e5e5e5]/35 text-[10px] uppercase tracking-widest font-bold mb-2">{name}</p>
      <div className="space-y-1.5">
        {entries.map((e) => {
          const emphasize = highlightFirstRank && e.rank === 1
          return (
            <div key={`${e.rank}-${e.name}`} className="flex items-center gap-2.5">
              <RankChip rank={e.rank} glow={emphasize} />
              <div className="min-w-0">
                <span className={emphasize ? 'text-white text-base font-bold' : 'text-white text-sm font-medium'}>
                  {e.name}
                </span>
                {e.subtitle && (
                  <span className="text-[#e5e5e5]/40 text-xs ml-2">({e.subtitle})</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function YearCard({ event, expanded, onToggle, matchesSearch }) {
  // Cancelled 2021
  if (event.cancelled) {
    return (
      <div className="bg-surface border border-red-500/20 rounded-2xl p-5 opacity-90">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-white font-black text-2xl">{event.year}</span>
          <span className="text-[10px] font-black uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
            Cancelled
          </span>
        </div>
        <p className="text-[#e5e5e5]/50 text-sm leading-relaxed">{event.notes}</p>
      </div>
    )
  }

  // Upcoming 2027
  if (event.upcoming) {
    return (
      <div className="bg-surface border-2 border-brand/40 rounded-2xl p-5 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.08) 0%, #191919 60%)' }}
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-brand/60" />
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-brand font-black text-2xl">{event.year}</span>
          <span className="text-[10px] font-black uppercase tracking-wider bg-brand text-black px-2 py-0.5 rounded-full">
            Upcoming
          </span>
        </div>
        <p className="text-white text-sm font-bold mb-1">{event.location}</p>
        <p className="text-[#e5e5e5]/50 text-xs">{event.state}, Australia</p>
      </div>
    )
  }

  // Standard year card
  const teamWinner = event.divisions?.team?.[0]
  const locationLabel = [event.location, event.state].filter(Boolean).join(' · ')

  const teamEntries = event.divisions?.team
  const sideFormatKeys = SIDE_FORMATS.filter(key => event.divisions?.[key]?.length > 0)
  const totalFormats = (teamEntries?.length > 0 ? 1 : 0) + sideFormatKeys.length

  return (
    <div className={`bg-surface border rounded-2xl overflow-hidden transition-all ${
      matchesSearch
        ? 'border-brand/60 shadow-[0_0_16px_rgba(0,255,65,0.15)]'
        : expanded
          ? 'border-brand/30'
          : 'border-line hover:border-brand/30'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`year-${event.year}-details`}
        className="w-full text-left text-white p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-brand font-black text-2xl tabular-nums">{event.year}</span>
          <span className="text-[#e5e5e5]/30 text-xs">{totalFormats} format{totalFormats !== 1 ? 's' : ''}</span>
        </div>
        <p className="text-white text-sm font-bold leading-tight mb-1 truncate">{locationLabel}</p>
        {teamWinner && (
          <p className="text-[#e5e5e5]/55 text-xs leading-snug">
            <span className="text-[#e5e5e5]/55" aria-hidden>🏆 </span>
            <span className="font-semibold text-[#e5e5e5]/80">{teamWinner.name}</span>
            {teamWinner.subtitle && <span className="text-[#e5e5e5]/45">, {teamWinner.subtitle}</span>}
          </p>
        )}
        <div className="flex items-center gap-2 mt-3 text-[10px] font-bold uppercase tracking-wider text-brand/80">
          <span className="text-brand/80">{expanded ? 'Hide details' : 'Show all formats'}</span>
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div
          id={`year-${event.year}-details`}
          className="px-5 pb-5 pt-2 border-t border-line bg-base/40"
        >
          {/* Main event — Team (full width) */}
          {teamEntries?.length > 0 && (
            <div className="mt-4">
              <p className="text-green-400 text-[10px] uppercase tracking-widest font-bold mb-2">Main Event</p>
              <div className="border-l-2 border-green-400/30 pl-4">
                <FormatList name="Teams" entries={teamEntries} highlightFirstRank />
              </div>
            </div>
          )}

          {/* Side events */}
          {sideFormatKeys.length > 0 && (
            <>
              <div className="flex items-center gap-3 mt-6 mb-3">
                <p className="text-[#e5e5e5]/40 text-[10px] uppercase tracking-widest font-bold">Side Events</p>
                <div className="flex-1 h-px bg-line" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {sideFormatKeys.map(key => (
                  <FormatList
                    key={key}
                    name={DIVISION_LABELS[key]}
                    entries={event.divisions[key]}
                  />
                ))}
              </div>
            </>
          )}

          {event.notes && (
            <div className="mt-5 pt-4 border-t border-line">
              <p className="text-[#e5e5e5]/55 text-xs leading-relaxed italic">{event.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
