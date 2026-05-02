import { useState, useEffect } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { isCommittee } from '../lib/roles'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

const DEFAULT_NAV_LINKS = [
  { label: 'Home', href: '/', visible: true },
  { label: 'About', href: '/about', visible: true },
  { label: 'ZLTAC', href: '/zltac', visible: true },
  { label: 'Contact', href: '/contact', visible: true },
]

const PILL_STATUS_LABEL = { open: 'EVENT OPEN' }

function navLinkClass({ isActive }) {
  return `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-brand' : 'text-[#e5e5e5]/70 hover:text-white'}`
}

const HUB_PILLS = [
  { key: 'player', label: 'Player Hub', to: '/player-hub',   color: '#FF6B00' },
  { key: 'team',   label: 'Team Hub',   to: '/captain-hub',  color: '#E24B4A' },
  { key: 'admin',  label: 'Admin Hub',  to: '/admin',        color: '#7C3AED' },
]

export default function NavBar() {
  const { user, signOut, userRoles, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { event } = useCurrentEvent()
  const pillStatusLabel = event ? PILL_STATUS_LABEL[event.status] : null
  const [hasPlayerReg, setHasPlayerReg] = useState(false)
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

  const visiblePills = user
    ? {
        player: hasPlayerReg,
        team: userRoles.includes('captain'),
        admin: isCommittee(profile),
      }
    : { player: false, team: false, admin: false }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const pillStyle = (color) => ({
    backgroundColor: color,
    fontSize: '13px',
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: '20px',
    color: '#fff',
    transition: 'opacity 0.15s',
    whiteSpace: 'nowrap',
  })

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
          {navLinks.map(link => (
            <NavLink key={link.href} to={link.href} end={link.href === '/'} className={navLinkClass}>
              {link.label}
            </NavLink>
          ))}
          {event && pillStatusLabel && (
            <Link
              to={`/events/${event.year}`}
              className="ml-2 flex items-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 text-xs font-semibold px-3 py-1 rounded-full transition-colors whitespace-nowrap"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
              {pillStatusLabel} — {event.name}
            </Link>
          )}
        </nav>

        {/* Pills + auth controls */}
        <div className="ml-auto hidden md:flex items-center gap-2">
          {HUB_PILLS.filter(p => visiblePills[p.key]).map(p => (
            <Link
              key={p.key}
              to={p.to}
              style={pillStyle(p.color)}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              {p.label}
            </Link>
          ))}

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
          {HUB_PILLS.filter(p => visiblePills[p.key]).map(p => (
            <Link
              key={p.key}
              to={p.to}
              onClick={() => setMobileOpen(false)}
              className="py-2.5 px-3 text-sm font-semibold rounded-lg transition-colors"
              style={{ backgroundColor: p.color, color: '#fff' }}
            >
              {p.label}
            </Link>
          ))}

          {navLinks.map(({ label, href }) => (
            <Link
              key={href}
              to={href}
              onClick={() => setMobileOpen(false)}
              className="py-2.5 px-3 text-sm text-[#e5e5e5]/70 hover:text-brand rounded-lg hover:bg-line transition-colors"
            >
              {label}
            </Link>
          ))}

          {/* Current-event pill — sits in the link list, below Contact */}
          {event && pillStatusLabel && (
            <Link
              to={`/events/${event.year}`}
              onClick={() => setMobileOpen(false)}
              className="flex items-center justify-center gap-2 mt-1 py-2.5 px-3 rounded-full bg-green-500/15 hover:bg-green-500/25 border border-green-500/40 text-green-300 text-xs font-semibold transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {pillStatusLabel} — {event.name}
            </Link>
          )}

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
