import { useState, useEffect } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { COMMITTEE_ROLES } from '../lib/roles'

const DEFAULT_NAV_LINKS = [
  { label: 'Home', href: '/', visible: true },
  { label: 'About', href: '/about', visible: true },
  { label: 'ZLTAC', href: '/zltac', visible: true },
  { label: 'Contact', href: '/contact', visible: true },
]

function navLinkClass({ isActive }) {
  return `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-brand' : 'text-[#e5e5e5]/70 hover:text-white'}`
}

const HUB_PILLS = [
  { key: 'player', label: 'Player Hub', to: '/player-hub',   color: '#FF6B00' },
  { key: 'team',   label: 'Team Hub',   to: '/captain-hub',  color: '#E24B4A' },
  { key: 'admin',  label: 'Admin Hub',  to: '/admin',        color: '#7C3AED' },
]

export default function NavBar() {
  const { user, signOut, userRoles } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeEvent, setActiveEvent] = useState(null)
  const [visiblePills, setVisiblePills] = useState({ player: false, team: false, admin: false })
  const navLinks = DEFAULT_NAV_LINKS
  const isAdmin = location.pathname.startsWith('/admin')

  // Load active event
  useEffect(() => {
    supabase
      .from('zltac_events')
      .select('name, year')
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setActiveEvent(data))
  }, [])

  // Load hub pill visibility whenever user, roles or active event changes
  useEffect(() => {
    if (!user) {
      setVisiblePills({ player: false, team: false, admin: false })
      return
    }

    async function loadPlayerPill() {
      if (!activeEvent?.year) return
      const { data: reg } = await supabase
        .from('zltac_registrations').select('id').eq('user_id', user.id).eq('year', activeEvent.year).maybeSingle()
      setVisiblePills(prev => ({ ...prev, player: !!reg }))
    }

    setVisiblePills({
      player: false, // loaded async below
      team: userRoles.includes('captain'),
      admin: userRoles.some(r => COMMITTEE_ROLES.includes(r)),
    })
    loadPlayerPill()
  }, [user, userRoles, activeEvent])

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
        </nav>

        {/* Pills + auth controls */}
        <div className="ml-auto hidden md:flex items-center gap-2">
          {activeEvent && (
            <Link
              to={`/events/${activeEvent.year}`}
              className="flex items-center gap-1.5 bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand text-xs font-bold px-3.5 py-1.5 rounded-full transition-all hover:shadow-[0_0_12px_rgba(0,255,65,0.2)]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse flex-shrink-0" />
              {activeEvent.name}
            </Link>
          )}

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
          {activeEvent && (
            <Link
              to={`/events/${activeEvent.year}`}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 py-2.5 px-3 text-sm font-bold text-brand rounded-lg hover:bg-line transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              {activeEvent.name}
            </Link>
          )}

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

          {[
            ...navLinks.map(l => ({ label: l.label, to: l.href })),
            ...(user
              ? [{ label: 'Dashboard', to: '/dashboard' }]
              : [{ label: 'Login', to: '/login' }, { label: 'Register', to: '/register' }]
            ),
          ].map(({ label, to }) => (
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
