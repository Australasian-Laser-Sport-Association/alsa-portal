import { zltacHistory } from '../../data/zltacHistory'

const REGION_LABEL = {
  VIC: 'Victoria',
  QLD: 'Queensland',
  TAS: 'Tasmania',
  NSW: 'New South Wales',
  ACT: 'Australian Capital Territory',
  WA:  'Western Australia',
  NT:  'Northern Territory',
  SA:  'South Australia',
  NZ:  'New Zealand',
}

function HostingTile({ region, years, count, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(region)}
      aria-pressed={selected}
      className={`text-left text-white bg-base border rounded-xl px-4 py-4 transition-all hover:border-brand/40 ${
        selected ? 'border-brand bg-brand/5' : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-white font-black text-sm">{region}</span>
        <span className="text-brand font-black text-2xl tabular-nums">{count}</span>
      </div>
      <p className="text-[#e5e5e5]/40 text-[11px] uppercase tracking-wider mb-2">{REGION_LABEL[region]}</p>
      <div className="flex flex-wrap gap-1">
        {years.map(y => (
          <span key={y} className="text-[10px] text-[#e5e5e5]/50 bg-line/40 px-1.5 py-0.5 rounded">
            {y}
          </span>
        ))}
      </div>
    </button>
  )
}

export default function HostingGrid({ selectedRegion, onSelectRegion }) {
  const au = zltacHistory.hosting.filter(h => h.country === 'AU')
  const nz = zltacHistory.hosting.filter(h => h.country === 'NZ')

  return (
    <section className="bg-surface border-y border-line">
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
        <div className="text-center mb-10">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Hosting</p>
          <h2 className="text-3xl md:text-4xl font-black text-white mb-3">28 Years, 9 Regions</h2>
          <p className="text-[#e5e5e5]/45 text-sm max-w-xl mx-auto">
            Every Australian state and territory has hosted the championship at least once. Click a region to filter the year explorer below.
          </p>
        </div>

        <div className="mb-3 flex items-center gap-3">
          <p className="text-[10px] uppercase tracking-widest text-[#e5e5e5]/40 font-bold">Australia</p>
          <div className="flex-1 h-px bg-line" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
          {au.map(h => (
            <HostingTile
              key={h.region}
              {...h}
              selected={selectedRegion === h.region}
              onClick={onSelectRegion}
            />
          ))}
        </div>

        <div className="mb-3 flex items-center gap-3">
          <p className="text-[10px] uppercase tracking-widest text-[#e5e5e5]/40 font-bold">New Zealand</p>
          <div className="flex-1 h-px bg-line" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {nz.map(h => (
            <HostingTile
              key={h.region}
              {...h}
              selected={selectedRegion === h.region}
              onClick={onSelectRegion}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
