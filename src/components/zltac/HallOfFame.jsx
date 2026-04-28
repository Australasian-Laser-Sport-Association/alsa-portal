import { Award } from 'lucide-react'
import { zltacHistory } from '../../data/zltacHistory'

function surname(realName) {
  const parts = (realName ?? '').trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

function InducteeCard({ realName, alias, inductionYear, contribution }) {
  const hasCitation = contribution && contribution.trim().length > 0
  return (
    <div
      className="bg-base border border-line rounded-xl p-5 flex flex-col h-full relative overflow-hidden"
      style={{ borderTop: '2px solid rgba(251, 191, 36, 0.35)' }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-amber-400 text-xs leading-none flex-shrink-0" aria-hidden>★</span>
        <h4 className="text-white font-bold text-xl leading-tight">{realName}</h4>
      </div>

      <div className="mt-3 ml-5">
        <p className="text-white/40 text-xs uppercase tracking-widest font-bold">Alias</p>
        <p className="text-amber-400 text-2xl font-bold leading-tight mt-0.5">{alias}</p>
      </div>

      <div className="mt-4 flex-1">
        {hasCitation ? (
          <p
            className="text-white/80 text-xs leading-relaxed"
            style={{ color: 'rgba(255, 255, 255, 0.8)' }}
          >
            {contribution}
          </p>
        ) : (
          <p className="text-white/30 text-xs italic">Citation to be added</p>
        )}
      </div>

      <p className="text-white/50 text-xs mt-4 text-right">
        Inducted {inductionYear}
      </p>
    </div>
  )
}

export default function HallOfFame() {
  // Alphabetical sort by surname (last word of realName), ascending.
  // Computed in the component so the source data stays in chronological order
  // for easier future editing.
  const inductees = [...zltacHistory.hallOfFame].sort((a, b) =>
    surname(a.realName).localeCompare(surname(b.realName))
  )

  return (
    <section className="bg-surface border-y border-line">
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
        <div className="text-center mb-12">
          <Award className="w-10 h-10 text-amber-400 mx-auto mb-4" aria-hidden />
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">Hall of Fame</h2>
          <p
            className="text-white/80 text-sm md:text-base leading-relaxed max-w-3xl mx-auto text-left md:text-center"
            style={{ color: 'rgba(255, 255, 255, 0.8)' }}
          >
            Recognising those whose unparalleled contribution to the competition and to laser sporting in Australasia has shaped what ZLTAC is today. This list reflects publicly recorded inductees and is not exhaustive.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {inductees.map(i => (
            <InducteeCard key={`${i.realName}-${i.inductionYear}`} {...i} />
          ))}
        </div>
      </div>
    </section>
  )
}
