import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
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

// Authenticated pages
import PlayerDashboard from './pages/PlayerDashboard'
import Welcome from './pages/Welcome'

// Dynamic event registration flows
import CaptainRegister from './pages/CaptainRegister'
import PlayerRegister from './pages/PlayerRegister'
import PlayerHub from './pages/PlayerHub'
import CaptainHub from './pages/CaptainHub'
import JoinTeam from './pages/JoinTeam'
import RefereeTest from './pages/RefereeTest'

// Admin
import AdminLayout from './components/AdminLayout'
import AdminZltacDashboard from './pages/admin/AdminZltacDashboard'
import AdminAlsaDashboard from './pages/admin/AdminAlsaDashboard'
import AdminEvent from './pages/admin/AdminEvent'
import AdminRegistrations from './pages/admin/AdminRegistrations'
import AdminRefereeTest from './pages/admin/AdminRefereeTest'
import AdminUsers from './pages/admin/AdminUsers'
import AdminMembers from './pages/admin/AdminMembers'
import AdminVolunteers from './pages/admin/AdminVolunteers'
import AdminLegalDocuments from './pages/admin/AdminLegalDocuments'
import AdminUnder18Approvals from './pages/admin/AdminUnder18Approvals'
import AdminZLTACHallOfFame from './pages/admin/AdminZLTACHallOfFame'
import AdminZLTACResults from './pages/admin/AdminZLTACResults'
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

          {/* ZLTAC history */}
          <Route path="/zltac/:year" element={<ZLTACYearDetail />} />

          {/* Dynamic event pages */}
          <Route path="/events/:year" element={<EventPage />} />
          <Route path="/events/:year/captain-register" element={<ProtectedRoute><CaptainRegister /></ProtectedRoute>} />
          <Route path="/events/:year/player-register" element={<ProtectedRoute><PlayerRegister /></ProtectedRoute>} />

          {/* Join via invite link → redirects to player-register */}
          <Route path="/join/:code" element={<JoinTeam />} />

          {/* Hubs (pull active event dynamically) */}
          <Route path="/captain-hub" element={<ProtectedRoute><CaptainHub /></ProtectedRoute>} />
          <Route path="/player-hub" element={<ProtectedRoute><PlayerHub /></ProtectedRoute>} />
          <Route path="/referee-test" element={<ProtectedRoute><RefereeTest /></ProtectedRoute>} />

          {/* Auth */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Authenticated */}
          <Route path="/dashboard" element={<ProtectedRoute><PlayerDashboard /></ProtectedRoute>} />
          <Route path="/welcome" element={<ProtectedRoute><Welcome /></ProtectedRoute>} />

          {/* Admin panel */}
          <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route index element={<AdminZltacDashboard />} />
            <Route path="portal-dashboard" element={<AdminAlsaDashboard />} />
            <Route path="event" element={<AdminEvent />} />
            <Route path="zltac-results" element={<AdminZLTACResults />} />
            <Route path="zltac-hall-of-fame" element={<AdminZLTACHallOfFame />} />
            <Route path="registrations" element={<AdminRegistrations />} />
            <Route path="legal-documents" element={<AdminLegalDocuments />} />
            <Route path="under-18-approvals" element={<AdminUnder18Approvals />} />
            <Route path="referee-test" element={<AdminRefereeTest />} />
            <Route path="volunteers" element={<AdminVolunteers />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="members" element={<AdminMembers />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
