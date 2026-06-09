import { useState, useEffect } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Briefcase, LayoutDashboard } from 'lucide-react'
import { useAuth } from '../lib/useAuth'
import { COMMITTEE_ROLES } from '../lib/roles'
import { apiFetch } from '../lib/apiFetch.js'

const NAV_ITEMS = [
  // Admin section sits at the top. Purple tone differentiates the hub
  // entry from the green ZLTAC / Portal sections below, mirroring the
  // landing's "My Dashboard" purple distinction.
  { sectionLabel: 'Admin', tone: 'purple' },
  {
    to: '/admin',
    end: true,
    icon: <LayoutDashboard className="w-4 h-4" />,
    label: 'Admin Hub',
    tone: 'purple',
  },
  { sectionLabel: 'ZLTAC Event Management' },
  {
    to: '/admin/zltac-dashboard',
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
    label: 'Event Settings',
    bold: true,
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
    to: '/admin/required-documents',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: 'Required Documents',
  },
  {
    to: '/admin/under-18-approvals',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    label: 'Under 18 Approvals',
  },
  {
    to: '/admin/referee-test',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
    label: 'Rules Test',
  },
  {
    to: '/admin/volunteers',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5a1.5 1.5 0 00-3 0v2a6 6 0 006 6h2.5a6 6 0 006-6V8a1.5 1.5 0 00-3 0m-6 1.5V5a1.5 1.5 0 013 0v4.5m0 0V6.5a1.5 1.5 0 013 0V11" />
      </svg>
    ),
    label: 'Volunteers',
  },
  {
    to: '/admin/zltac-documents',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
    label: 'ZLTAC Documents',
  },
  // The Competitions section header and the superadmin "Competitions"
  // link below are gated dynamically in buildNavItems(). Managed
  // competition links are injected after the superadmin link so the
  // section shows the right set per role:
  //   superadmin only           → Competitions
  //   superadmin + manager      → Competitions + per-comp manage links
  //   committee manager only    → per-comp manage links
  //   committee, no grants      → section is hidden entirely
  { sectionLabel: 'Competitions' },
  {
    to: '/admin/competitions',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    label: 'Competitions',
    superadminOnly: true,
  },
  { sectionLabel: 'ALSA Portal Management' },
  {
    to: '/admin/portal-dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    label: 'Dashboard',
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
    to: '/admin/members',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    label: 'ALSA Members',
  },
  {
    to: '/admin/alsa-documents',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
    label: 'ALSA Documents',
  },
  {
    to: '/admin/zltac-hall-of-fame',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6zm-7-3a7 7 0 1014 0 7 7 0 00-14 0zm9.5 5L12 22l-2.5-5" />
      </svg>
    ),
    label: 'ZLTAC Hall of Fame',
  },
  {
    to: '/admin/zltac-results',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    ),
    label: 'ZLTAC Results',
  },
  {
    to: '/admin/backups',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    ),
    label: 'Backups',
  },
]

// Walks NAV_ITEMS and injects manager-scope entries: the Competitions
// section header shows when superadmin OR there's at least one managed
// competition; the "Competitions" CRUD link shows for superadmin only;
// each managed competition becomes a /manage/competitions/{slug} link.
function buildNavItems(managedCompetitions, isSuperAdmin) {
  const hasManaged = managedCompetitions.length > 0
  const out = []
  for (const item of NAV_ITEMS) {
    if (item.sectionLabel === 'Competitions') {
      if (isSuperAdmin || hasManaged) out.push(item)
      continue
    }
    if (item.to === '/admin/competitions') {
      if (isSuperAdmin) out.push(item)
      for (const c of managedCompetitions) {
        out.push({
          to: `/admin/manage/competitions/${c.slug}`,
          icon: <Briefcase className="w-4 h-4" />,
          label: c.name,
        })
      }
      continue
    }
    out.push(item)
  }
  return out
}

function SidebarLink({ to, end, icon, label, bold, onClick, tone }) {
  const isPurple = tone === 'purple'
  const activeCls = isPurple
    ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
    : 'bg-brand/10 text-brand border border-brand/20'
  const inactiveCls = isPurple
    ? 'text-purple-400/70 hover:text-purple-300 hover:bg-purple-500/10'
    : 'text-[#e5e5e5]/60 hover:text-white hover:bg-line'
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive ? activeCls : inactiveCls
        }`
      }
    >
      {icon}
      <span className={bold ? 'font-bold uppercase tracking-wide' : ''}>{label}</span>
    </NavLink>
  )
}

export default function AdminLayout() {
  const { user, userRoles, loading: authLoading, profileLoading } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // null = still fetching managed competitions. Both "is committee" and
  // "has a manager grant" admit the user into /admin; we need the manager
  // fetch to resolve before we can decide.
  const [managedCompetitions, setManagedCompetitions] = useState(null)

  const isCommittee = userRoles.some(r => COMMITTEE_ROLES.includes(r))
  const isSuperAdmin = userRoles.includes('superadmin')
  const role = isSuperAdmin ? 'superadmin'
    : userRoles.includes('alsa_committee') ? 'alsa_committee'
    : userRoles.includes('zltac_committee') ? 'zltac_committee'
    : userRoles.includes('advisor') ? 'advisor'
    : null

  // Fetch my-competitions so non-committee competition managers can reach
  // /admin and see their managed-competitions tile section. The same list
  // is forwarded via outlet context so the landing renders without a
  // second fetch.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    apiFetch('/api/superadmin/my-competitions')
      .then(data => { if (!cancelled) setManagedCompetitions(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setManagedCompetitions([]) })
    return () => { cancelled = true }
  }, [user])

  const hasManagedCompetitions = (managedCompetitions ?? []).length > 0
  const hasAdminAccess = isCommittee || hasManagedCompetitions

  useEffect(() => {
    if (authLoading || profileLoading) return
    // Wait for the manager fetch before deciding. Otherwise non-committee
    // managers get redirected to /dashboard before the gate can admit them.
    if (managedCompetitions === null) return
    if (!user || !hasAdminAccess) {
      navigate('/dashboard', { state: { accessDenied: true } })
    }
  }, [user, authLoading, profileLoading, managedCompetitions, hasAdminAccess, navigate])

  if (authLoading || profileLoading || managedCompetitions === null) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasAdminAccess) return null

  // Non-committee managers see no sidebar — they have no business in
  // event management. The page renders single-column.
  const showSidebar = isCommittee

  return (
    <div className="min-h-screen bg-base flex">
      {/* Mobile overlay */}
      {showSidebar && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — committee only. Non-committee managers get a
          single-column layout (the tile grid on the landing is their only
          /admin surface). */}
      {showSidebar && (
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
          <p className="text-[11px] text-[#e5e5e5]/60 mt-0.5">ALSA Committee</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          {buildNavItems(managedCompetitions ?? [], isSuperAdmin).filter(item => !item.superadminOnly || isSuperAdmin).map((item, i) =>
            item.sectionLabel ? (
              <div key={`section-${i}`} className="mt-4 mb-1 px-2 flex items-center gap-2">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${
                  item.tone === 'purple' ? 'text-purple-400' : 'text-[#e5e5e5]/60'
                }`}>{item.sectionLabel}</p>
                <div className={`flex-1 h-px ${
                  item.tone === 'purple' ? 'bg-purple-500/30' : 'bg-line'
                }`} />
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
            className="flex items-center gap-2 px-3 py-2 text-xs text-[#e5e5e5]/60 hover:text-white rounded-lg hover:bg-line transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to site
          </Link>
        </div>
      </aside>
      )}

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-h-screen ${showSidebar ? 'md:ml-56' : ''}`}>
        {/* Mobile top bar — only meaningful when there is a sidebar to toggle. */}
        {showSidebar && (
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
        )}

        <div className="flex-1 p-6 md:p-8">
          <Outlet context={{ role, userRoles, managedCompetitions: managedCompetitions ?? [] }} />
        </div>
      </div>
    </div>
  )
}
