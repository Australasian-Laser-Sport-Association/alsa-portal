import { Link } from 'react-router-dom'

// Tile + TileSection — shared between AdminHub (the navigation landing at
// /admin) and any other admin surface that wants the same visual.
//
// Two tones:
//   brand (default) — green admin styling
//   purple          — used for the "My Dashboard" section on AdminHub
//                     (and any future surface that wants to distinguish a
//                     section from the main admin tiles). Palette mirrors
//                     the superadmin-badge tokens in AdminUsers /
//                     PlayerDashboard (purple-400 text, purple-500/15 bg,
//                     purple-500/30 border) so no new colour values land.

export function Tile({ label, to, description, Icon, tone = 'brand' }) {
  const isPurple = tone === 'purple'
  const outerCls = isPurple
    ? 'bg-surface border border-purple-500/30 rounded-xl p-5 hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors block'
    : 'bg-surface border border-line rounded-xl p-5 hover:border-brand/40 hover:bg-line/20 transition-colors block'
  const badgeCls = isPurple
    ? 'w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center flex-shrink-0'
    : 'w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0'
  const iconCls = isPurple ? 'w-5 h-5 text-purple-400' : 'w-5 h-5 text-brand'
  return (
    <Link to={to} className={outerCls}>
      <div className="flex items-start gap-3">
        <div className={badgeCls}>
          <Icon className={iconCls} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="text-white font-bold text-sm">{label}</p>
          <p className="text-[#e5e5e5]/50 text-xs mt-1 leading-snug">{description}</p>
        </div>
      </div>
    </Link>
  )
}

export function TileSection({ title, children, tone = 'default' }) {
  const headerCls = tone === 'purple'
    ? 'text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-3'
    : 'text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/40 mb-3'
  return (
    <div className="mb-8">
      <p className={headerCls}>{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {children}
      </div>
    </div>
  )
}
