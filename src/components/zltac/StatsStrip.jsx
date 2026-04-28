import { Calendar, Map, Users, Trophy } from 'lucide-react'

function Tile({ icon: Icon, children }) {
  return (
    <div className="bg-base border border-line rounded-2xl px-4 py-6 md:py-8 text-center h-full flex flex-col items-center justify-center">
      <Icon className="w-8 h-8 text-brand mb-2" aria-hidden />
      {children}
    </div>
  )
}

// Single canonical class for every green headline across the four tiles.
const HEADLINE_GREEN = 'text-xl md:text-3xl font-black text-brand leading-tight'
const HEADLINE_GREEN_STYLE = { textShadow: '0 0 20px rgba(0,255,65,0.25)' }

// Single canonical class for every white sub-text line across the four tiles.
const SUBLINE_WHITE = 'text-white text-xs md:text-sm font-bold uppercase tracking-wider'

export default function StatsStrip() {
  return (
    <section className="bg-surface border-y border-line">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-white/80 text-center text-base md:text-lg font-bold uppercase tracking-wider leading-relaxed mb-10 max-w-3xl mx-auto">
          AUSTRALASIA'S PREMIER LASER TAG CHAMPIONSHIP SINCE 1999.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 items-stretch">

          {/* Tile 1 — 28 Years */}
          <Tile icon={Calendar}>
            <p className={HEADLINE_GREEN} style={HEADLINE_GREEN_STYLE}>28 YEARS</p>
            <p className={`${SUBLINE_WHITE} mt-3`}>SINCE 1999</p>
          </Tile>

          {/* Tile 2 — Multi-State */}
          <Tile icon={Map}>
            <p className={HEADLINE_GREEN} style={HEADLINE_GREEN_STYLE}>MULTI-STATE</p>
            <p className={`${SUBLINE_WHITE} mt-3`}>VIC, QLD, NSW, TAS, WA, SA, ACT, NT + NEW ZEALAND</p>
          </Tile>

          {/* Tile 3 — Average team / player counts */}
          <Tile icon={Users}>
            <p className={HEADLINE_GREEN} style={HEADLINE_GREEN_STYLE}>AVERAGE</p>
            <p className={`${SUBLINE_WHITE} mt-3`}>25 TEAMS</p>
            <p className={`${SUBLINE_WHITE} mt-1`}>140 PLAYERS</p>
          </Tile>

          {/* Tile 4 — 8 Formats */}
          <Tile icon={Trophy}>
            <p className={HEADLINE_GREEN} style={HEADLINE_GREEN_STYLE}>8 FORMATS</p>
            <p className={`${SUBLINE_WHITE} mt-3`}>1 MAIN EVENT</p>
            <p className={`${SUBLINE_WHITE} mt-1`}>7 SIDE EVENTS</p>
          </Tile>

        </div>
      </div>
    </section>
  )
}
