import { useState, useEffect } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { isCommittee } from '../lib/roles'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import ActiveEventsPill from './ActiveEventsPill'
import MyEventsPill from './MyEventsPill'
import AdminHubPill from './AdminHubPill'

const DEFAULT_NAV_LINKS = [
  { label: 'Home', href: '/', visible: true },
  {
    label: 'ALSA',
    href: '/about',
    visible: true,
    children: [
      { label: 'About', href: '/about' },
      { label: 'Member Register', href: '/members' },
    ],
  },
  {
    label: 'ZLTAC',
    href: '/zltac',
    visible: true,
    children: [
      { label: 'ZLTAC', href: '/zltac' },
      { label: 'Competitions', href: '/competitions' },
    ],
  },
  { label: 'Contact', href: '/contact', visible: true },
]

function navLinkClass({ isActive }) {
  return `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-brand' : 'text-[#e5e5e5]/70 hover:text-white'}`
}

function DesktopDropdown({ link, currentPath }) {
  const parentActive = link.children.some(c => c.href === currentPath)
  return (
    <div className="relative group">
      <Link
        to={link.href}
        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
          parentActive ? 'text-brand' : 'text-[#e5e5e5]/70 hover:text-white'
        }`}
      >
        {link.label}
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Link>
      <div className="absolute top-full left-0 pt-1 min-w-[200px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
        <div className="bg-surface border border-line rounded-lg shadow-lg py-1 overflow-hidden">
          {link.children.map(c => (
            <NavLink
              key={c.href}
              to={c.href}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm transition-colors ${
                  isActive ? 'text-brand bg-line/30' : 'text-[#e5e5e5]/70 hover:text-white hover:bg-line/40'
                }`
              }
            >
              {c.label}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  )
}

function MobileDropdown({ link, onNavigate }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <button
        onClick={() => setExpanded(e => !e)}
        className="py-2.5 px-3 text-sm text-[#e5e5e5]/70 hover:text-brand rounded-lg hover:bg-line transition-colors flex items-center justify-between w-full text-left"
      >
        <span>{link.label}</span>
        <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && link.children.map(c => (
        <Link
          key={c.href}
          to={c.href}
          onClick={onNavigate}
          className="py-2 pl-7 pr-3 text-sm text-[#e5e5e5]/60 hover:text-brand rounded-lg hover:bg-line transition-colors"
        >
          {c.label}
        </Link>
      ))}
    </>
  )
}

// Player Hub / Team Hub moved into the My Events dropdown
// (src/components/MyEventsPill.jsx). Admin Hub also became a dropdown
// (src/components/AdminHubPill.jsx) so non-committee managers can land on
// /manage/competitions/:slug without a UI dead end. No top-level
// destination pills remain.

export default function NavBar() {
  const { user, signOut, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { event } = useCurrentEvent()
  const [hasPlayerReg, setHasPlayerReg] = useState(false)
  const [myTeamStatus, setMyTeamStatus] = useState(null)
  const navLinks = DEFAULT_NAV_LINKS
  const isAdmin = location.pathname.startsWith('/admin')

  // Look up player registration for the current event whenever user or event changes
  useEffect(() => {
    if (!user || !event?.year) return
    let cancelled = false
    supabase
      .from('zltac_registrations').select('id').eq('user_id', user.id).eq('year', event.year).maybeSingle()
      .then(({ data }) => { if (!cancelled) setHasPlayerReg(!!data) })
    return () => { cancelled = true }
  }, [user, event])

  // Look up the user's most recent ZLTAC team (as captain or manager) so the
  // Team Hub pill shows whenever they own a ZLTAC team — regardless of
  // approval state. event_id IS NOT NULL scopes this to ZLTAC teams (the xor
  // CHECK on teams guarantees event_id IS NOT NULL ⇔ competition_id IS NULL),
  // so a user who only captains a pre-nats team does NOT light up this pill —
  // pre-nats has its own /competitions/:slug/hub surface.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('teams')
      .select('status')
      .or(`captain_id.eq.${user.id},manager_id.eq.${user.id}`)
      .not('event_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setMyTeamStatus(null); return }
        setMyTeamStatus(data?.status ?? null)
      })
    return () => { cancelled = true }
  }, [user])

  const hasZltacTeam = !!myTeamStatus
  const userIsCommittee = isCommittee(profile)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-50 bg-surface border-b border-line">
      <div className="h-0.5 bg-brand" />

      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-6">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 flex-shrink-0 mr-2">
          <img src="/alsa-logo.png" alt="ALSA" style={{ height: 36 }} />
          {isAdmin && (
            <span className="hidden sm:inline-flex items-center text-[10px] font-bold uppercase tracking-widest bg-brand/10 text-brand border border-brand/20 px-2 py-0.5 rounded ml-1">
              Admin Panel
            </span>
          )}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1">
          {navLinks.map(link =>
            link.children
              ? <DesktopDropdown key={link.label} link={link} currentPath={location.pathname} />
              : (
                <NavLink key={link.href} to={link.href} end={link.href === '/'} className={navLinkClass}>
                  {link.label}
                </NavLink>
              )
          )}
          <ActiveEventsPill variant="desktop" />
        </nav>

        {/* Pills + auth controls */}
        <div className="ml-auto hidden md:flex items-center gap-2">
          {user && (
            <MyEventsPill
              variant="desktop"
              user={user}
              hasZltacReg={hasPlayerReg}
              hasZltacTeam={hasZltacTeam}
              teamStatus={myTeamStatus}
            />
          )}
          {user && (
            <AdminHubPill
              variant="desktop"
              user={user}
              isCommittee={userIsCommittee}
            />
          )}

          {user ? (
            <>
              <Link to="/dashboard" className="text-sm text-[#e5e5e5]/70 hover:text-brand transition-colors font-medium ml-1">
                Dashboard
              </Link>
              <button
                onClick={handleSignOut}
                className="border border-line hover:border-[#374056] bg-line hover:bg-[#374056] text-white text-sm font-semibold rounded-lg px-4 py-1.5 transition-colors"
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm text-[#e5e5e5]/70 hover:text-brand transition-colors font-medium ml-1">
                Login
              </Link>
              <Link
                to="/register"
                className="bg-brand hover:bg-brand-hover text-black text-sm font-bold rounded-lg px-4 py-1.5 transition-all hover:shadow-[0_0_16px_rgba(0,255,65,0.35)]"
              >
                Register
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden ml-auto text-[#e5e5e5]/70 hover:text-white p-1"
          onClick={() => setMobileOpen(v => !v)}
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {mobileOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[#191919] border-t border-line px-6 py-4 flex flex-col gap-1">
          {user && (
            <MyEventsPill
              variant="mobile"
              user={user}
              hasZltacReg={hasPlayerReg}
              hasZltacTeam={hasZltacTeam}
              teamStatus={myTeamStatus}
              onNavigate={() => setMobileOpen(false)}
            />
          )}
          {user && (
            <AdminHubPill
              variant="mobile"
              user={user}
              isCommittee={userIsCommittee}
              onNavigate={() => setMobileOpen(false)}
            />
          )}

          {navLinks.map(link =>
            link.children
              ? <MobileDropdown key={link.label} link={link} onNavigate={() => setMobileOpen(false)} />
              : (
                <Link
                  key={link.href}
                  to={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="py-2.5 px-3 text-sm text-[#e5e5e5]/70 hover:text-brand rounded-lg hover:bg-line transition-colors"
                >
                  {link.label}
                </Link>
              )
          )}

          {/* Active-events pill — sits in the link list, below Contact. Renders
              a single pill or a dropdown depending on how many events are active. */}
          <ActiveEventsPill variant="mobile" onNavigate={() => setMobileOpen(false)} />

          {(user
            ? [{ label: 'Dashboard', to: '/dashboard' }]
            : [{ label: 'Login', to: '/login' }, { label: 'Register', to: '/register' }]
          ).map(({ label, to }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className="py-2.5 px-3 text-sm text-[#e5e5e5]/70 hover:text-brand rounded-lg hover:bg-line transition-colors"
            >
              {label}
            </Link>
          ))}

          {user && (
            <button
              onClick={() => { setMobileOpen(false); handleSignOut() }}
              className="mt-2 text-left py-2.5 px-3 text-sm text-[#e5e5e5]/40 hover:text-white rounded-lg hover:bg-line transition-colors"
            >
              Sign Out
            </button>
          )}
        </div>
      )}
    </header>
  )
}
