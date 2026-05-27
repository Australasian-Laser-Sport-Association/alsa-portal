import { useEffect } from 'react'
import { Link, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { isCommittee } from '../lib/roles'

// Stripped layout for pre-nationals managers. Mirrors AdminLayout structure
// (sticky sidebar + outlet) so the visual language stays familiar, but the
// nav is intentionally minimal — just one entry. Managers who are ALSO
// committee members get redirected to /admin, since the admin shell is wider.
//
// Auth gating: requires an authenticated user. The pages inside (ManagerHub,
// ManagerCompetitionDetail) re-validate per-competition access against
// /api/superadmin/my-competitions so the layout doesn't need to know about
// manager grants itself.

function SidebarLink({ to, end, icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand/10 text-brand border border-brand/20'
            : 'text-white opacity-60 hover:opacity-100 hover:bg-line'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

export default function ManagerLayout() {
  const { user, profile, loading, profileLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (loading || profileLoading) return
    if (!user) {
      navigate('/login')
      return
    }
    // Committee users land on the per-competition page from the Admin Hub
    // tile + sidebar (post feature/admin-hub-separation). They should NOT
    // see the bare /manage listing — they have richer tooling on /admin —
    // so the redirect fires only when the route is exactly /manage.
    const onManageIndex = location.pathname.replace(/\/$/, '') === '/manage'
    if (isCommittee(profile) && onManageIndex) {
      navigate('/admin', { replace: true })
    }
  }, [user, profile, loading, profileLoading, navigate, location.pathname])

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-base flex">
      <aside className="fixed top-16 bottom-0 left-0 z-30 w-56 bg-[#111] border-r border-line flex flex-col">
        <div className="px-4 py-4 border-b border-line">
          <span className="text-xs font-bold uppercase tracking-widest text-brand">Manager Hub</span>
          <p className="text-white opacity-30 text-[11px] mt-0.5">Pre-nationals</p>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          <SidebarLink
            to="/manage"
            end
            label="My Competitions"
            icon={(
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            )}
          />
        </nav>

        <div className="px-3 py-4 border-t border-line">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2 text-xs text-white opacity-40 hover:opacity-100 rounded-lg hover:bg-line transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to site
          </Link>
        </div>
      </aside>

      <div className="flex-1 md:ml-56 flex flex-col min-h-screen">
        <div className="flex-1 p-6 md:p-8">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
