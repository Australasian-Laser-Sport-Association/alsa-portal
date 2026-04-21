const PLACEHOLDER_EVENTS = [
  { year: 2026, name: 'ZLTAC 2026', status: 'Upcoming', winner: '—' },
]

export default function ResultsArchive() {
  return (
    <div className="min-h-screen bg-base p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-1">Results Archive</h1>
        <p className="text-[#e5e5e5]/60 mb-8">Historical ALSA championship results</p>

        <div className="bg-surface rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left px-6 py-3 text-[#e5e5e5]/60 font-medium">Year</th>
                <th className="text-left px-6 py-3 text-[#e5e5e5]/60 font-medium">Event</th>
                <th className="text-left px-6 py-3 text-[#e5e5e5]/60 font-medium">Status</th>
                <th className="text-left px-6 py-3 text-[#e5e5e5]/60 font-medium">Champion</th>
              </tr>
            </thead>
            <tbody>
              {PLACEHOLDER_EVENTS.map((event) => (
                <tr key={event.year} className="border-b border-line/50 hover:bg-brand/5 transition-colors">
                  <td className="px-6 py-4 text-white font-semibold">{event.year}</td>
                  <td className="px-6 py-4 text-brand">{event.name}</td>
                  <td className="px-6 py-4">
                    <span className="bg-brand/10 text-brand text-xs px-2 py-1 rounded-full border border-brand/30">
                      {event.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-[#e5e5e5]/60">{event.winner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
