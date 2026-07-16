import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { COMMITTEE_ROLES } from '../lib/roles'
import LoadError from './LoadError'

function RouteLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function CommitteeRoute({ children, allowedRoles = COMMITTEE_ROLES }) {
  const { user, profile, loading, profileLoading, profileError, refreshProfile } = useAuth()
  const location = useLocation()
  const outletContext = useOutletContext()

  if (loading || profileLoading) return <RouteLoading />
  if (!user) {
    const target = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} replace />
  }
  if (profileError) {
    return <LoadError title="Could not verify your access" message={profileError.message} onRetry={refreshProfile} />
  }

  const roles = profile?.roles ?? []
  if (!roles.some(role => allowedRoles.includes(role))) {
    return <Navigate to="/dashboard" replace state={{ accessDenied: true }} />
  }

  return children ?? <Outlet context={outletContext} />
}
