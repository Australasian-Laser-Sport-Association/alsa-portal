import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiFetch } from '../lib/apiFetch.js'

// Single-button Admin Hub entry point. The dropdown that used to live here
// listed "Admin Panel" plus every managed competition as separate links;
// that content has moved onto the /admin landing page as a tile grid, so
// the pill itself is now just a navigation trigger.
//
// Visibility predicate is unchanged from the dropdown era:
//   - committee members: always shown
//   - non-committee users: shown only when they have at least one
//     competition_managers grant (resolved via /api/superadmin/my-competitions)
// The fetch is co-located here because NavBar does not otherwise need
// manager scope, and AdminLayout's own fetch runs on the destination page
// (after navigation), not before.

const PILL_COLOUR = '#7C3AED'

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
  // null = still resolving the manager fetch on first render; false / true
  // afterwards. The pill stays hidden during the loading window so it does
  // not flash in/out for users who turn out to have no scope.
  const [hasManaged, setHasManaged] = useState(null)
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/superadmin/my-competitions')
      .then(data => { if (!cancelled) setHasManaged(Array.isArray(data) && data.length > 0) })
      .catch(() => { if (!cancelled) setHasManaged(false) })
    return () => { cancelled = true }
  }, [user, location.pathname])

  if (hasManaged === null) return null
  if (!isCommittee && !hasManaged) return null

  const baseClass = variant === 'mobile'
    ? 'flex items-center justify-center py-2.5 px-3 rounded-lg w-full text-sm transition-colors'
    : 'flex items-center transition-opacity'

  return (
    <Link
      to="/admin"
      onClick={onNavigate}
      style={pillStyle(variant)}
      className={baseClass}
      onMouseEnter={variant === 'desktop'
        ? e => { e.currentTarget.style.opacity = '0.85' }
        : undefined}
      onMouseLeave={variant === 'desktop'
        ? e => { e.currentTarget.style.opacity = '1' }
        : undefined}
    >
      Admin Hub
    </Link>
  )
}
