import { useState, useEffect } from 'react'
import { formatInEventTz } from '../lib/eventTimezone'

// Three-tile lifecycle countdown: Registration Opens → Locks → Closes.
// Public-safe (dates aren't sensitive). All times rendered in the event's
// timezone with a short abbreviation (e.g. "22 May 2026, 7:00 PM AEST").
//
// Sources: event.reg_open_date, event.reg_close_date, event.event_starts_at.
// The first tile whose date is still in the future is the "active deadline" —
// it gets the yellow accent + DEADLINE badge + sub-note. Past tiles dim to a
// terminal label ("Open" / "Locked" / "Closed"); null dates show "Not set".

function toMs(value) {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

function fmtDate(value, timezone) {
  if (!value) return null
  return formatInEventTz(value, timezone, 'shortWithTime') || null
}

// Returns { text, urgency }. Drops leading zero units (no "0d 12h 34m").
// Last hour → "Xm Ys"; last minute → "Ys" (critical).
function fmtCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (totalSec < 60) return { text: `${secs}s`, urgency: 'critical' }
  if (totalSec < 3600) return { text: `${mins}m ${secs}s`, urgency: 'soon' }
  if (days > 0) return { text: `${days}d ${hours}h ${mins}m`, urgency: 'normal' }
  return { text: `${hours}h ${mins}m`, urgency: 'normal' }
}

// Tick cadence based on the nearest future deadline: 1s within 1h, 30s within
// 24h, 1min otherwise. Re-running the effect only when this value changes keeps
// re-renders cheap (the effect re-creates the interval on threshold crossings).
function tickMsFor(event, now) {
  const future = [event?.reg_open_date, event?.reg_close_date, event?.event_starts_at]
    .map(toMs)
    .filter(t => t != null && t > now)
  if (future.length === 0) return 60000
  const nearest = Math.min(...future) - now
  if (nearest < 3600000) return 1000
  if (nearest < 86400000) return 30000
  return 60000
}

// Permanent per-tile identity colours (by tile index): Tile 0 brand green,
// Tile 1 orange, Tile 2 red. A tile shows its colour whenever its phase hasn't
// ended; once past it greys out. Same glow intensity/pattern, just different
// colour. Red matches the app's red-500 family (e.g. the admin "Remove" pill).
const TILE_THEME = [
  { chrome: 'border-brand/60 bg-brand/[0.07] shadow-[0_0_24px_-6px_rgba(0,255,65,0.45)]',      focal: 'text-brand' },
  { chrome: 'border-orange-400/60 bg-orange-500/[0.07] shadow-[0_0_24px_-6px_rgba(251,146,60,0.45)]', focal: 'text-orange-300' },
  { chrome: 'border-red-500/60 bg-red-500/[0.07] shadow-[0_0_24px_-6px_rgba(239,68,68,0.45)]', focal: 'text-red-400' },
]

function SkeletonTile() {
  return (
    <div className="rounded-2xl border border-line bg-surface/50 p-4 sm:p-5 animate-pulse">
      <div className="h-2.5 w-24 bg-line rounded mb-3" />
      <div className="h-3 w-32 bg-line rounded mb-4" />
      <div className="h-7 w-20 bg-line rounded" />
    </div>
  )
}

export default function EventLifecycleCountdown({ event, className = '' }) {
  const [now, setNow] = useState(() => Date.now())

  const loading = event == null
  const tickMs = loading ? 60000 : tickMsFor(event, now)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  if (loading) {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 ${className}`}>
        <SkeletonTile /><SkeletonTile /><SkeletonTile />
      </div>
    )
  }

  const tiles = [
    {
      title: 'Registration Opens',
      value: event.reg_open_date,
      pastLabel: 'Open',
      bullets: ['Sign up online', 'Join or create a team', 'Pick your side events'],
    },
    {
      title: 'Registration Locks / Payment Opens',
      value: event.reg_close_date,
      pastLabel: 'Locked',
      bullets: ['Online changes locked', 'Payments open', 'Changes via committee email', 'Refunds available for confirmed pull-outs'],
    },
    {
      title: 'Registration Closes',
      value: event.event_starts_at,
      pastLabel: 'Closed',
      bullets: ['Final cut-off', 'All entries locked in', 'No refunds for withdrawals'],
    },
  ]

  // Current phase index (0 open, 1 locked, 2 closed). A tile greys out once its
  // phase has ended: tiles with index < activeIdx are past/grey; tiles at or
  // after activeIdx keep their identity colour. Mirrors eventPhase. (Greying is
  // driven by the phase boundary, not the tile's own date, so the active tile
  // stays coloured throughout its phase — e.g. green stays green while
  // registration is open, even after reg_open_date has passed.)
  const lockMs = toMs(event.reg_close_date)
  const closeMs = toMs(event.event_starts_at)
  let activeIdx = 0
  if (closeMs != null && now >= closeMs) activeIdx = 2
  else if (lockMs != null && now >= lockMs) activeIdx = 1

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 ${className}`}>
      {tiles.map((tile, i) => {
        const ms = toMs(tile.value)
        const isNull = ms == null
        const isFuture = !isNull && ms > now
        const isPast = !isNull && ms <= now
        const cd = isFuture ? fmtCountdown(ms - now) : null
        const critical = cd?.urgency === 'critical'
        // Coloured while this tile's phase hasn't ended (index >= current phase);
        // greys out once past. Colour is the tile's permanent identity.
        const isColored = i >= activeIdx && !isNull
        const theme = TILE_THEME[i]

        // Tile chrome — glassmorphic. Coloured tiles get their identity border +
        // glow (same intensity for all); past tiles grey out; null = "Not set".
        const chrome = isNull
          ? 'border-line bg-surface/30 opacity-45'
          : isColored
            ? theme.chrome
            : 'border-line bg-surface/40 opacity-55'

        // Focal colour: coloured tiles use their identity colour; a last-minute
        // countdown overrides to a red pulse; greyed tiles stay white (dimmed by
        // the tile opacity).
        const focalColor = critical
          ? 'text-red-400 animate-pulse'
          : isColored
            ? theme.focal
            : 'text-white'

        return (
          <div key={tile.title} className={`relative rounded-2xl border p-4 sm:p-5 backdrop-blur-sm transition-colors ${chrome}`}>
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#e5e5e5]/45 mb-1.5">
              {tile.title}
            </p>

            {isNull ? (
              <p className="text-sm text-[#e5e5e5]/40 italic mt-1">Not set</p>
            ) : (
              <>
                <p className="text-xs sm:text-sm text-[#e5e5e5]/70 mb-3 leading-snug">
                  {fmtDate(tile.value, event.timezone)}
                </p>
                <p className={`font-black tabular-nums leading-none text-2xl sm:text-3xl ${focalColor}`}>
                  {isPast ? tile.pastLabel : cd.text}
                </p>
                <ul className="mt-3 space-y-0.5">
                  {tile.bullets.map(b => (
                    <li key={b} className="flex items-start gap-1.5 text-[11px] text-[#e5e5e5]/55 leading-snug">
                      <span className="text-[#e5e5e5]/30 flex-shrink-0">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
