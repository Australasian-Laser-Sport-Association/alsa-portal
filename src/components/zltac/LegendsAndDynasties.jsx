import { Star, Trophy } from 'lucide-react'
import { zltacHistory } from '../../data/zltacHistory'

function LegendCard({ alias, titles, summary }) {
  return (
    <div className="bg-base border border-line rounded-xl p-5 hover:border-brand/30 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <span
          className="text-brand text-2xl"
          aria-hidden
        >
          ★
        </span>
        <h4 className="text-white font-black text-lg leading-tight">{alias}</h4>
      </div>
      <p className="text-brand text-xs leading-relaxed font-medium mb-2">{titles}</p>
      {summary && (
        <p className="text-[#e5e5e5]/45 text-xs leading-relaxed">{summary}</p>
      )}
    </div>
  )
}

function DynastyCard({ team, years, note, tier }) {
  // tier: 'threePeat' (most prestigious — bright brand-green trophy + green top accent)
  //       | 'backToBack' (still notable — dimmer brand-green trophy, no top accent)
  const isThreePeat = tier === 'threePeat'
  const badge = isThreePeat ? `${years.length}× champion` : 'Back-to-back'
  const trophyClass = isThreePeat ? 'text-brand' : 'text-brand/60'
  const accentClass = isThreePeat ? 'border-t-2 border-t-brand/40' : ''

  return (
    <div className={`bg-[#1a1a1a]/60 border border-white/10 rounded-lg p-4 transition-colors hover:border-brand/30 ${accentClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <Trophy className={`w-5 h-5 flex-shrink-0 ${trophyClass}`} aria-hidden />
        <h4 className="text-lg font-bold text-white leading-tight">{team}</h4>
      </div>
      <span className="inline-block text-[10px] uppercase tracking-wider font-bold text-brand bg-brand/10 border border-brand/20 px-2 py-0.5 rounded mb-3">
        {badge}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {years.map(y => (
          <span key={y} className="text-xs font-bold text-brand bg-brand/10 px-2 py-0.5 rounded tabular-nums">
            {y}
          </span>
        ))}
      </div>
      {note && <p className="text-white/40 text-xs italic mt-2">{note}</p>}
    </div>
  )
}

export default function LegendsAndDynasties() {
  const { legends, dynasties } = zltacHistory

  return (
    <section className="max-w-7xl mx-auto px-6 py-20 md:py-24">
      <div className="text-center mb-12">
        <Star className="w-10 h-10 text-brand mx-auto mb-4" aria-hidden />
        <h2 className="text-3xl md:text-4xl font-black text-white mb-4">Stand Out Players &amp; Teams</h2>
        <p
          className="text-white/80 text-sm md:text-base leading-relaxed max-w-3xl mx-auto text-center"
          style={{ color: 'rgba(255, 255, 255, 0.8)' }}
        >
          Special mention for players whose unparalleled contribution has helped shape and grow the competition and laser sporting in Australasia.
        </p>
      </div>

      <div className="space-y-12">

        {/* Team Dynasties — compact responsive grid, three-peats first */}
        <div>
          <h3 className="text-white font-black text-lg mb-4 flex items-center justify-center gap-2">
            <span className="text-brand">◆</span> Team Dynasties
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {dynasties.threePeats.map(d => (
              <DynastyCard key={d.team} {...d} tier="threePeat" />
            ))}
            {dynasties.backToBack.map(d => (
              <DynastyCard key={d.team} {...d} tier="backToBack" />
            ))}
          </div>
        </div>

        {/* Stand Out Players — responsive grid spanning full section width */}
        <div>
          <h3 className="text-white font-black text-lg mb-4 flex items-center justify-center gap-2">
            <span className="text-brand">◆</span> Stand Out Players (Legends)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {legends.map(l => <LegendCard key={l.alias} {...l} />)}
          </div>
        </div>

      </div>
    </section>
  )
}
