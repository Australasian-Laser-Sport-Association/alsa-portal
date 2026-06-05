import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { toLocalDate } from '../lib/dateFormat'

// Global "EVENT OPEN" pill in the nav. Self-fetches the public competitions
// feed and renders one of three states based on how many active events are
// currently surfaced:
//   0 events: renders nothing
//   1 event:  single pill, links straight to the event page (preserves the
//             pre-Phase-3d UX)
//   2+:       "EVENTS OPEN" trigger pill + click-to-open dropdown panel
//
// Active = ZLTAC events with status='open' OR pre-nats competitions whose
// registration window is still open. The API already filters competitions
// server-side; we mirror that client-side so the pill self-corrects if the
// tab sits open through a close cutoff.

const TYPE_LABEL = {
  main: 'Annual Championship',
  comp: 'Pre-Nationals',
}

function formatDateRange(start, end) {
  if (!start || !end) return ''
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  const s = toLocalDate(start).toLocaleDateString('en-AU', opts)
  const e = toLocalDate(end).toLocaleDateString('en-AU', opts)
  return s === e ? s : `${s} to ${e}`
}

export default function ActiveEventsPill({ variant = 'desktop', onNavigate }) {
  const [events, setEvents] = useState([])
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const location = useLocation()

  // Fetch on mount and on route change. We do NOT reset events to [] before
  // the new fetch resolves, so the pill stays stable across navigation rather
  // than flickering empty.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/public?resource=competitions')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const nowMs = Date.now()
        const main = (data.main_events ?? [])
          .filter(e => e.status === 'open')
          .map(e => ({
            kind: 'main',
            key: `main-${e.id}`,
            name: `${e.name} ${e.year}`,
            start_date: e.start_date,
            end_date: e.end_date,
            href: `/events/${e.year}`,
          }))
        const comps = (data.competitions ?? [])
          .filter(c => {
            if (c.archived_at) return false
            if (c.registration_close_at && new Date(c.registration_close_at).getTime() <= nowMs) return false
            return true
          })
          .slice()
          .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
          .map(c => ({
            kind: 'comp',
            key: `comp-${c.id}`,
            name: c.name,
            start_date: c.start_date,
            end_date: c.end_date,
            href: `/competitions/${c.slug}`,
          }))
        setEvents([...main, ...comps])
      } catch {
        // Silent fail — leave the previous list intact.
      }
    }
    load()
    return () => { cancelled = true }
  }, [location.pathname])

  // Click-outside + Escape to close. Attached only while open so we don't pay
  // for document listeners on every page load.
  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (triggerRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (events.length === 0) return null

  // Single-event fallback — same render shape as the pre-Phase-3d pill so
  // the existing visual contract is preserved.
  if (events.length === 1) {
    const e = events[0]
    const single = variant === 'desktop'
      ? 'ml-2 flex items-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 text-xs font-semibold px-3 py-1 rounded-full transition-colors whitespace-nowrap'
      : 'flex items-center justify-center gap-2 mt-1 py-2.5 px-3 rounded-full bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 text-xs font-semibold transition-colors'
    return (
      <Link to={e.href} onClick={onNavigate} className={single}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
        EVENT OPEN — {e.name}
      </Link>
    )
  }

  // 2+ events: dropdown trigger.
  const triggerClass = variant === 'desktop'
    ? 'ml-2 flex items-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 text-xs font-semibold px-3 py-1 rounded-full transition-colors whitespace-nowrap'
    : 'flex items-center justify-center gap-2 mt-1 py-2.5 px-3 rounded-full bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 text-xs font-semibold transition-colors w-full'

  return (
    <div className={variant === 'desktop' ? 'relative' : 'relative w-full'}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClass}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
        EVENTS OPEN
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          className={
            variant === 'desktop'
              ? 'absolute top-full right-0 mt-1 min-w-[280px] bg-surface border border-line rounded-lg shadow-lg overflow-hidden z-50'
              : 'mt-1 w-full bg-surface border border-line rounded-lg shadow-lg overflow-hidden'
          }
        >
          {events.map(e => (
            <Link
              key={e.key}
              to={e.href}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                if (onNavigate) onNavigate()
              }}
              className="block px-4 py-2.5 text-sm hover:bg-line/40 transition-colors border-b border-line last:border-b-0"
            >
              <p className="text-white font-bold">{e.name}</p>
              <p className="text-white opacity-50 text-[11px] mt-0.5">
                {TYPE_LABEL[e.kind]}
                {formatDateRange(e.start_date, e.end_date) && (
                  <span> · {formatDateRange(e.start_date, e.end_date)}</span>
                )}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
