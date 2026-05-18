const SIZE_CLS = {
  xs: 'text-[9px] px-1.5 py-0.5',
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2 py-1',
}

// Render a small emerald pill when the user is a current ALSA member.
// Pass isMember (boolean) — typically derived from /api/me/membership's
// `current` field or another current-period check.
export default function MemberBadge({ isMember, size = 'sm', className = '' }) {
  if (!isMember) return null
  const sizeCls = SIZE_CLS[size] ?? SIZE_CLS.sm
  return (
    <span
      className={`inline-block font-bold uppercase tracking-wide rounded border whitespace-nowrap align-middle bg-emerald-500/15 text-emerald-400 border-emerald-500/30 ${sizeCls} ${className}`}
    >
      ALSA Member
    </span>
  )
}
