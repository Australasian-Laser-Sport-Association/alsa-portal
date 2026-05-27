import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiFetch } from '../lib/apiFetch.js'

// Single dropdown that gathers a player's active event memberships into one
// place: ZLTAC (Player Hub + Team Hub if applicable) and one entry per active
// pre-nats registration. Replaces the previous standalone Player Hub / Team
// Hub pills.
//
// Visibility rules:
//   - Pill is hidden while the my-registrations probe is in flight on first
//     mount (avoids a flash of an empty dropdown).
//   - Pill is hidden if the user has neither a ZLTAC registration nor any
//     pre-nats registration.
//   - The ZLTAC section is rendered only if hasZltacReg.
//   - Team Hub link is rendered only if hasZltacTeam (mirrors the existing
//     pill's captain-or-manager visibility from NavBar).
//
// NavBar already fetches hasZltacReg / hasZltacTeam / teamStatus via its own
// event-scoped queries, so they're passed in rather than re-fetched here.
// The pre-nats list is self-fetched (new endpoint, no other surface uses it).

const PILL_COLOUR = '#FF6B00' // Reuses the old Player Hub colour so the visual landmark stays familiar.

function pillStyle(variant) {
  if (variant === 'mobile') {
    return {
      backgroundColor: PILL_COLOUR,
      color: '#fff',
      fontWeight: 600,
    }
  }
  return {
    backgroundColor: PILL_COLOUR,
    fontSize: '13px',
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: '20px',
    color: '#fff',
    transition: 'opacity 0.15s',
    whiteSpace: 'nowrap',
  }
}

export default function MyEventsPill({
  variant = 'desktop',
  user,
  hasZltacReg = false,
  hasZltacTeam = false,
  teamStatus = null,
  onNavigate,
}) {
  const [regs, setRegs] = useState(null) // null = loading; array = loaded (player scope)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const location = useLocation()

  // Refetch on user identity change AND on route navigation. The
  // location.pathname dep keeps this fresh after the user registers /
  // cancels without needing a global refresh signal. setState is inside the
  // async .then() so the cascading-renders lint rule does not fire. No
  // anon-reset branch: NavBar gates this component on `{user && ...}`, so
  // it never mounts without a user. Manager-scope rows live on
  // AdminHubPill — this pill is player-scope only.
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/superadmin/my-registrations')
      .then(data => { if (!cancelled) setRegs(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setRegs([]) })
    return () => { cancelled = true }
  }, [user, location.pathname])

  // Close on outside click / Escape. Attached only while open to avoid
  // document-listener cost on every render.
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

  // Hide while loading on first fetch. Hide if the user has no event
  // memberships (ZLTAC registration or any pre-nats registration).
  if (regs === null) return null
  const hasPreNats = regs.length > 0
  if (!hasZltacReg && !hasPreNats) return null

  function handleNavigate() {
    setOpen(false)
    if (onNavigate) onNavigate()
  }

  const teamAmberDot = hasZltacTeam && teamStatus && teamStatus !== 'approved'

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen(v => !v)}
      aria-haspopup="menu"
      aria-expanded={open}
      style={pillStyle(variant)}
      className={variant === 'mobile'
        ? 'flex items-center justify-between py-2.5 px-3 rounded-lg w-full text-left text-sm transition-colors'
        : 'flex items-center gap-1.5'}
    >
      <span className="flex items-center gap-1.5">
        My Events
        {teamAmberDot && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
        )}
      </span>
      <svg
        className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )

  const panelInner = (
    <>
      {hasZltacReg && (
        <>
          <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-white opacity-50">
            ZLTAC
          </p>
          <Link
            to="/player-hub"
            onClick={handleNavigate}
            role="menuitem"
            className="block px-6 py-2 text-sm text-white hover:bg-line/40 transition-colors"
          >
            Player Hub
          </Link>
          {hasZltacTeam && (
            <Link
              to="/captain-hub"
              onClick={handleNavigate}
              role="menuitem"
              className="flex items-center gap-2 px-6 py-2 text-sm text-white hover:bg-line/40 transition-colors"
            >
              Team Hub
              {teamAmberDot && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </Link>
          )}
        </>
      )}

      {hasZltacReg && hasPreNats && (
        <div className="border-t border-line my-1" />
      )}

      {hasPreNats && (
        <>
          <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-white opacity-50">
            Pre-Nationals
          </p>
          {regs.map(r => (
            <Link
              key={r.competition.id}
              to={`/competitions/${r.competition.slug}/hub`}
              onClick={handleNavigate}
              role="menuitem"
              className="block px-4 py-2 text-sm text-white hover:bg-line/40 transition-colors"
            >
              {r.competition.name}
            </Link>
          ))}
        </>
      )}
    </>
  )

  if (variant === 'desktop') {
    return (
      <div className="relative">
        {trigger}
        {open && (
          <div
            ref={panelRef}
            role="menu"
            className="absolute top-full right-0 mt-1 min-w-[240px] bg-surface border border-line rounded-lg shadow-lg py-1 overflow-hidden z-50"
          >
            {panelInner}
          </div>
        )}
      </div>
    )
  }

  // Mobile variant — inline expansion inside the menu drawer.
  return (
    <div className="w-full">
      {trigger}
      {open && (
        <div
          ref={panelRef}
          role="menu"
          className="mt-1 bg-surface border border-line rounded-lg py-1 overflow-hidden"
        >
          {panelInner}
        </div>
      )}
    </div>
  )
}
