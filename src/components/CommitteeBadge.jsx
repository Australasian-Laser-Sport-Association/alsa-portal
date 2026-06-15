const BADGE_META = {
  alsa_committee:  { label: 'ALSA Committee',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  zltac_committee: { label: 'ZLTAC Committee', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
}

const SIZE_CLS = {
  xs: 'text-[9px] px-1.5 py-0.5',
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2 py-1',
}

export default function CommitteeBadge({ roles, size = 'sm', className = '' }) {
  if (!Array.isArray(roles)) return null
  const matched = ['alsa_committee', 'zltac_committee'].filter(r => roles.includes(r))
  if (matched.length === 0) return null
  const sizeCls = SIZE_CLS[size] ?? SIZE_CLS.sm
  return (
    <span className={`inline-flex flex-wrap gap-1 align-middle ${className}`}>
      {matched.map(r => {
        const m = BADGE_META[r]
        return (
          <span
            key={r}
            className={`font-bold uppercase tracking-wide rounded border whitespace-nowrap ${m.cls} ${sizeCls}`}
          >
            {m.label}
          </span>
        )
      })}
    </span>
  )
}
