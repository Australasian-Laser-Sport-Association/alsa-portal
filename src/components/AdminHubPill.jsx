import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiFetch } from '../lib/apiFetch.js'

// Admin Hub dropdown. Visible to:
//   - committee members (any committee role) → see Admin Panel + every
//     competition they can manage
//   - non-committee competition managers → see only their managed
//     competitions (no Admin Panel link, since /admin gates on committee)
//
// Visual + interaction model mirrors MyEventsPill: pill trigger + dropdown
// panel, click-outside / Escape close, refetch on route navigation so the
// list stays fresh after a manager grant lands.

const PILL_COLOUR = '#7C3AED' // matches the previous Admin Hub pill colour

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

export default function AdminHubPill({
  variant = 'desktop',
  user,
  isCommittee = false,
  onNavigate,
}) {
  const [managed, setManaged] = useState(null) // null = loading; array = loaded
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const location = useLocation()

  // Refetch on user identity change AND on route navigation. Keeps the list
  // fresh after a manager grant lands without needing a hard refresh. Same
  // freshness pattern as MyEventsPill. NavBar gates this component on user
  // presence, so no anon-reset branch.
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/superadmin/my-competitions')
      .then(data => { if (!cancelled) setManaged(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setManaged([]) })
    return () => { cancelled = true }
  }, [user, location.pathname])

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

  // Hide while the my-competitions probe is in flight. Hide if neither
  // committee role nor any manager grants apply.
  if (managed === null) return null
  const hasManaged = managed.length > 0
  if (!isCommittee && !hasManaged) return null

  function handleNavigate() {
    setOpen(false)
    if (onNavigate) onNavigate()
  }

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
      <span>Admin Hub</span>
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
      {isCommittee && (
        <Link
          to="/admin"
          onClick={handleNavigate}
          role="menuitem"
          className="block px-4 py-2 text-sm text-white hover:bg-line/40 transition-colors"
        >
          Admin Panel
        </Link>
      )}

      {isCommittee && hasManaged && (
        <div className="border-t border-line my-1" />
      )}

      {hasManaged && (
        <>
          <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-white opacity-50">
            Other Competitions
          </p>
          {managed.map(m => (
            <Link
              key={m.id}
              to={`/manage/competitions/${m.slug}`}
              onClick={handleNavigate}
              role="menuitem"
              className="block px-4 py-2 text-sm text-white hover:bg-line/40 transition-colors"
            >
              {m.name}
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
