import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { getSiteBanner, SiteBannerContext } from './lib/siteSettings'

// Eager: the always-mounted app shell + the first-paint route. Everything the
// initial public render needs ships in the main entry so first paint is not
// gated on a chunk fetch.
import NavBar from './components/NavBar'
import SiteBanner from './components/SiteBanner'
import ActiveEventBanner from './components/ActiveEventBanner'
import ScrollToTop from './components/ScrollToTop'
import ProtectedRoute from './components/ProtectedRoute'
import CommitteeRoute from './components/CommitteeRoute'
import ManagerRoute from './components/ManagerRoute'
import Home from './pages/Home'

// Lazy: every other route loads its own chunk on navigation, so anonymous
// visitors no longer download the admin/manager/authenticated trees. The
// <Suspense> boundary around <Routes> shows the branded fallback during load.

// Public pages
const About = lazy(() => import('./pages/About'))
const MemberRegister = lazy(() => import('./pages/MemberRegister'))
const Contact = lazy(() => import('./pages/Contact'))
const ZLTACLanding = lazy(() => import('./pages/ZLTACLanding'))
const Resources = lazy(() => import('./pages/Resources'))
const EventPage = lazy(() => import('./pages/EventPage'))

// Auth pages
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const ConfirmSignup = lazy(() => import('./pages/ConfirmSignup'))

// Authenticated pages
const PlayerDashboard = lazy(() => import('./pages/PlayerDashboard'))
const Welcome = lazy(() => import('./pages/Welcome'))

// Dynamic event registration flows
const CaptainRegister = lazy(() => import('./pages/CaptainRegister'))
const PlayerRegister = lazy(() => import('./pages/PlayerRegister'))
const PlayerHub = lazy(() => import('./pages/PlayerHub'))
const CaptainHub = lazy(() => import('./pages/CaptainHub'))
const RefereeTest = lazy(() => import('./pages/RefereeTest'))

// Admin (heaviest surface — own chunks, loaded only under /admin)
const AdminLayout = lazy(() => import('./components/AdminLayout'))
const AdminHub = lazy(() => import('./pages/admin/AdminHub'))
const AdminZltacDashboard = lazy(() => import('./pages/admin/AdminZltacDashboard'))
const AdminAlsaDashboard = lazy(() => import('./pages/admin/AdminAlsaDashboard'))
const AdminEvent = lazy(() => import('./pages/admin/AdminEvent'))
const AdminRegistrations = lazy(() => import('./pages/admin/AdminRegistrations'))
const AdminRefereeTest = lazy(() => import('./pages/admin/AdminRefereeTest'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminMembers = lazy(() => import('./pages/admin/AdminMembers'))
const AdminVolunteers = lazy(() => import('./pages/admin/AdminVolunteers'))
const AdminRequiredDocuments = lazy(() => import('./pages/admin/AdminRequiredDocuments'))
const AdminSignedDocuments = lazy(() => import('./pages/admin/AdminSignedDocuments'))
const AdminUnder18Approvals = lazy(() => import('./pages/admin/AdminUnder18Approvals'))
const AdminZLTACHallOfFame = lazy(() => import('./pages/admin/AdminZLTACHallOfFame'))
const AdminZLTACResults = lazy(() => import('./pages/admin/AdminZLTACResults'))
const AdminCompetitions = lazy(() => import('./pages/admin/AdminCompetitions'))
const AdminBackups = lazy(() => import('./pages/admin/AdminBackups'))
const AdminDocuments = lazy(() => import('./pages/admin/AdminDocuments'))

// Manager (pre-nationals)
const ManagerLayout = lazy(() => import('./components/ManagerLayout'))
const ManagerHub = lazy(() => import('./pages/manage/ManagerHub'))
const ManagerCompetitionDetail = lazy(() => import('./pages/manage/ManagerCompetitionDetail'))

// Public competitions (anon-readable)
const CompetitionsList = lazy(() => import('./pages/public/CompetitionsList'))
const CompetitionDetail = lazy(() => import('./pages/public/CompetitionDetail'))
const CompetitionRegister = lazy(() => import('./pages/public/CompetitionRegister'))
const CompetitionHub = lazy(() => import('./pages/competition/CompetitionHub'))

// ZLTAC history
const ZLTACYearDetail = lazy(() => import('./pages/ZLTACYearDetail'))

const NotFound = lazy(() => import('./pages/NotFound'))

const BANNER_PATHS = new Set(['/', '/about', '/contact', '/zltac'])

function PinnedActiveEventBanner() {
  const { pathname } = useLocation()
  const allowed = BANNER_PATHS.has(pathname) || pathname.startsWith('/zltac/')
  if (!allowed) return null
  return <ActiveEventBanner />
}

// Branded fallback shown while a lazy route chunk loads. Matches the centered
// spinner used by the existing loaders (AdminLayout / ProtectedRoute).
function RouteFallback() {
  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function App() {
  // Site-wide testing-mode flag, fetched once here and shared via context so
  // SiteBanner, the homepage modal, and the AdminHub card reuse one fetch.
  const [banner, setBanner] = useState({ enabled: false, message: '' })

  useEffect(() => {
    let cancelled = false
    getSiteBanner().then(b => { if (!cancelled) setBanner(b) })
    return () => { cancelled = true }
  }, [])

  return (
    <AuthProvider>
      <SiteBannerContext.Provider value={{ banner, setBanner }}>
      <BrowserRouter>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-brand focus:text-black focus:font-bold"
        >
          Skip to content
        </a>
        <ScrollToTop />
        {/* Banner + nav pinned as one unit: two stacked sticky elements would
            overlap once scrolled, so the shell wraps both in a single sticky
            container instead of making SiteBanner sticky on its own. */}
        <div className="sticky top-0 z-50">
          <SiteBanner />
          <NavBar />
        </div>
        <PinnedActiveEventBanner />
        <main id="main-content">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
            {/* Public */}
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/members" element={<MemberRegister />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/zltac" element={<ZLTACLanding />} />
            {/* Shared Resources page; keyed per scope so switching between the
                two routes remounts instead of reusing stale state. */}
            <Route path="/resources" element={<Resources key="alsa" scope="alsa" />} />
            <Route path="/zltac/resources" element={<Resources key="zltac" scope="zltac" />} />

            {/* Public competition listings (pre-nationals etc.) */}
            <Route path="/competitions" element={<CompetitionsList />} />
            <Route path="/competitions/:slug" element={<CompetitionDetail />} />
            <Route path="/competitions/:slug/register" element={<CompetitionRegister />} />
            <Route path="/competitions/:slug/hub" element={<CompetitionHub />} />

            {/* ZLTAC history */}
            <Route path="/zltac/:year" element={<ZLTACYearDetail />} />

            {/* Dynamic event pages */}
            <Route path="/events/:year" element={<EventPage />} />
            <Route path="/events/:year/captain-register" element={<ProtectedRoute><CaptainRegister /></ProtectedRoute>} />
            <Route path="/events/:year/player-register" element={<ProtectedRoute><PlayerRegister /></ProtectedRoute>} />

            {/* Hubs (pull active event dynamically) */}
            <Route path="/captain-hub" element={<ProtectedRoute><CaptainHub /></ProtectedRoute>} />
            <Route path="/player-hub" element={<ProtectedRoute><PlayerHub /></ProtectedRoute>} />
            <Route path="/referee-test" element={<ProtectedRoute><RefereeTest /></ProtectedRoute>} />

            {/* Auth */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/confirm-signup" element={<ConfirmSignup />} />

            {/* Authenticated */}
            <Route path="/dashboard" element={<ProtectedRoute><PlayerDashboard /></ProtectedRoute>} />
            <Route path="/welcome" element={<ProtectedRoute><Welcome /></ProtectedRoute>} />

            {/* Admin panel */}
            <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
              <Route index element={<AdminHub />} />
              <Route element={<CommitteeRoute />}>
              <Route path="zltac-dashboard" element={<AdminZltacDashboard />} />
              <Route path="portal-dashboard" element={<AdminAlsaDashboard />} />
              <Route path="event" element={<AdminEvent />} />
              <Route path="zltac-results" element={<AdminZLTACResults />} />
              <Route path="zltac-hall-of-fame" element={<AdminZLTACHallOfFame />} />
              <Route path="registrations" element={<AdminRegistrations />} />
              <Route path="required-documents" element={<AdminRequiredDocuments />} />
              <Route path="player-acknowledgements" element={<AdminSignedDocuments />} />
              <Route path="signed-documents" element={<Navigate to="/admin/player-acknowledgements" replace />} />
              {/* Legacy slug — keep links/bookmarks to /admin/legal-documents working */}
              <Route path="legal-documents" element={<Navigate to="/admin/required-documents" replace />} />
              <Route path="under-18-approvals" element={<AdminUnder18Approvals />} />
              <Route path="referee-test" element={<AdminRefereeTest />} />
              <Route path="volunteers" element={<AdminVolunteers />} />
              <Route path="zltac-documents" element={<AdminDocuments key="zltac" scope="zltac" />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="members" element={<AdminMembers />} />
              <Route path="alsa-documents" element={<AdminDocuments key="alsa" scope="alsa" />} />
              <Route path="backups" element={<AdminBackups />} />
              </Route>
              <Route element={<CommitteeRoute allowedRoles={['superadmin']} />}>
                <Route path="competitions" element={<AdminCompetitions />} />
              </Route>
              {/* Committee users reach managed-competition pages from the Admin
                  Hub tile + sidebar. Mounting the manager page inside
                  AdminLayout keeps them in the full admin shell instead of
                  dropping into the narrow ManagerLayout. Non-committee managers
                  still use /manage/competitions/:slug below. */}
              <Route path="manage/competitions/:slug" element={<ManagerRoute><ManagerCompetitionDetail /></ManagerRoute>} />
            </Route>

            {/* Manager (pre-nationals) panel */}
            <Route path="/manage" element={<ProtectedRoute><ManagerLayout /></ProtectedRoute>}>
              <Route index element={<ManagerRoute><ManagerHub /></ManagerRoute>} />
              <Route path="competitions/:slug" element={<ManagerRoute><ManagerCompetitionDetail /></ManagerRoute>} />
            </Route>

            <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
      </BrowserRouter>
      </SiteBannerContext.Provider>
    </AuthProvider>
  )
}

export default App
