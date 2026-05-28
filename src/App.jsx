import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import NavBar from './components/NavBar'
import ActiveEventBanner from './components/ActiveEventBanner'

// Public pages
import Home from './pages/Home'
import About from './pages/About'
import MemberRegister from './pages/MemberRegister'
import Contact from './pages/Contact'
import ZLTACLanding from './pages/ZLTACLanding'
import EventPage from './pages/EventPage'

// Auth pages
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import ConfirmSignup from './pages/ConfirmSignup'

// Authenticated pages
import PlayerDashboard from './pages/PlayerDashboard'
import Welcome from './pages/Welcome'

// Dynamic event registration flows
import CaptainRegister from './pages/CaptainRegister'
import PlayerRegister from './pages/PlayerRegister'
import PlayerHub from './pages/PlayerHub'
import CaptainHub from './pages/CaptainHub'
import RefereeTest from './pages/RefereeTest'

// Admin
import AdminLayout from './components/AdminLayout'
import AdminHub from './pages/admin/AdminHub'
import AdminZltacDashboard from './pages/admin/AdminZltacDashboard'
import AdminAlsaDashboard from './pages/admin/AdminAlsaDashboard'
import AdminEvent from './pages/admin/AdminEvent'
import AdminRegistrations from './pages/admin/AdminRegistrations'
import AdminRefereeTest from './pages/admin/AdminRefereeTest'
import AdminUsers from './pages/admin/AdminUsers'
import AdminMembers from './pages/admin/AdminMembers'
import AdminVolunteers from './pages/admin/AdminVolunteers'
import AdminRequiredDocuments from './pages/admin/AdminRequiredDocuments'
import AdminUnder18Approvals from './pages/admin/AdminUnder18Approvals'
import AdminZLTACHallOfFame from './pages/admin/AdminZLTACHallOfFame'
import AdminZLTACResults from './pages/admin/AdminZLTACResults'
import AdminCompetitions from './pages/admin/AdminCompetitions'
import AdminBackups from './pages/admin/AdminBackups'
// Manager (pre-nationals)
import ManagerLayout from './components/ManagerLayout'
import ManagerHub from './pages/manage/ManagerHub'
import ManagerCompetitionDetail from './pages/manage/ManagerCompetitionDetail'
// Public competitions (anon-readable)
import CompetitionsList from './pages/public/CompetitionsList'
import CompetitionDetail from './pages/public/CompetitionDetail'
import CompetitionRegister from './pages/public/CompetitionRegister'
import CompetitionHub from './pages/competition/CompetitionHub'
// ZLTAC history
import ZLTACYearDetail from './pages/ZLTACYearDetail'

import ProtectedRoute from './components/ProtectedRoute'
import ScrollToTop from './components/ScrollToTop'
import NotFound from './pages/NotFound'

const BANNER_PATHS = new Set(['/', '/about', '/contact', '/zltac'])

function PinnedActiveEventBanner() {
  const { pathname } = useLocation()
  const allowed = BANNER_PATHS.has(pathname) || pathname.startsWith('/zltac/')
  if (!allowed) return null
  return <ActiveEventBanner />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <NavBar />
        <PinnedActiveEventBanner />
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/members" element={<MemberRegister />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/zltac" element={<ZLTACLanding />} />

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
            <Route path="zltac-dashboard" element={<AdminZltacDashboard />} />
            <Route path="portal-dashboard" element={<AdminAlsaDashboard />} />
            <Route path="event" element={<AdminEvent />} />
            <Route path="zltac-results" element={<AdminZLTACResults />} />
            <Route path="zltac-hall-of-fame" element={<AdminZLTACHallOfFame />} />
            <Route path="registrations" element={<AdminRegistrations />} />
            <Route path="required-documents" element={<AdminRequiredDocuments />} />
            {/* Legacy slug — keep links/bookmarks to /admin/legal-documents working */}
            <Route path="legal-documents" element={<Navigate to="/admin/required-documents" replace />} />
            <Route path="under-18-approvals" element={<AdminUnder18Approvals />} />
            <Route path="referee-test" element={<AdminRefereeTest />} />
            <Route path="volunteers" element={<AdminVolunteers />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="members" element={<AdminMembers />} />
            <Route path="competitions" element={<AdminCompetitions />} />
            <Route path="backups" element={<AdminBackups />} />
            {/* Committee users reach managed-competition pages from the Admin
                Hub tile + sidebar. Mounting the manager page inside
                AdminLayout keeps them in the full admin shell instead of
                dropping into the narrow ManagerLayout. Non-committee managers
                still use /manage/competitions/:slug below. */}
            <Route path="manage/competitions/:slug" element={<ManagerCompetitionDetail />} />
          </Route>

          {/* Manager (pre-nationals) panel */}
          <Route path="/manage" element={<ProtectedRoute><ManagerLayout /></ProtectedRoute>}>
            <Route index element={<ManagerHub />} />
            <Route path="competitions/:slug" element={<ManagerCompetitionDetail />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
