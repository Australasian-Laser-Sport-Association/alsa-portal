import { useState, useEffect } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV_ITEMS = [
  {
    to: '/admin',
    end: true,
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    label: 'Dashboard',
  },
  {
    to: '/admin/event',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    label: 'Current Event',
  },
  {
    to: '/admin/event-history',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    label: 'Event History',
  },
  {
    to: '/admin/registrations',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
    label: 'Registrations',
  },
  {
    to: '/admin/coc',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: 'Code of Conduct',
  },
  {
    to: '/admin/referee-test',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
    label: 'Referee Test',
  },
  {
    to: '/admin/users',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    label: 'Users',
  },
  {
    to: '/admin/under18-form',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    label: 'Under 18 Forms',
  },
  {
    to: '/admin/media-release',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    label: 'Media Release',
  },
  {
    to: '/admin/teams',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    label: 'Teams',
  },
]

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
            : 'text-[#e5e5e5]/60 hover:text-white hover:bg-line'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

const ADMIN_ROLES = ['alsa_committee', 'zltac_committee', 'superadmin', 'advisor']

export default function AdminLayout() {
  const { user, userRoles, loading: authLoading, profileLoading } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const hasAdminAccess = userRoles.some(r => ADMIN_ROLES.includes(r))
  const isSuperAdmin = userRoles.includes('superadmin')
  const role = isSuperAdmin ? 'superadmin'
    : userRoles.includes('alsa_committee') ? 'alsa_committee'
    : userRoles.includes('zltac_committee') ? 'zltac_committee'
    : userRoles.includes('advisor') ? 'advisor'
    : null

  useEffect(() => {
    if (authLoading || profileLoading) return
    if (!user || !hasAdminAccess) {
      navigate('/dashboard', { state: { accessDenied: true } })
    }
  }, [user, authLoading, profileLoading, hasAdminAccess, navigate])

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasAdminAccess) return null

  return (
    <div className="min-h-screen bg-base flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-16 bottom-0 left-0 z-30 w-56 bg-[#111] border-r border-line flex flex-col transform transition-transform duration-200 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Admin badge */}
        <div className="px-4 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-brand">Admin Panel</span>
            {isSuperAdmin && (
              <span className="text-[10px] bg-brand/10 text-brand border border-brand/20 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                Super
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#e5e5e5]/30 mt-0.5">ALSA Committee</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          {NAV_ITEMS.map((item, i) =>
            item.sectionLabel ? (
              <div key={`section-${i}`} className="mt-4 mb-1 px-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/25">{item.sectionLabel}</p>
                <div className="flex-1 h-px bg-line" />
              </div>
            ) : (
              <SidebarLink key={item.to} {...item} onClick={() => setSidebarOpen(false)} />
            )
          )}
        </nav>

        {/* Back to site */}
        <div className="px-3 py-4 border-t border-line">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2 text-xs text-[#e5e5e5]/40 hover:text-white rounded-lg hover:bg-line transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to site
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 md:ml-56 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-16 z-10 bg-surface border-b border-line px-4 py-2 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-line text-[#e5e5e5]/70 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold text-brand uppercase tracking-widest">Admin Panel</span>
        </div>

        <div className="flex-1 p-6 md:p-8">
          <Outlet context={{ role, userRoles }} />
        </div>
      </div>
    </div>
  )
}
