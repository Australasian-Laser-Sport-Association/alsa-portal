import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import NavBar from './components/NavBar'
import ActiveEventBanner from './components/ActiveEventBanner'

// Public pages
import Home from './pages/Home'
import About from './pages/About'
import Contact from './pages/Contact'
import ZLTACLanding from './pages/ZLTACLanding'
import EventPage from './pages/EventPage'

// Auth pages
import Login from './pages/Login'
import Register from './pages/Register'

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
import AdminHome from './pages/admin/AdminHome'
import AdminEvent from './pages/admin/AdminEvent'
import AdminEventHistory from './pages/admin/AdminEventHistory'
import AdminRegistrations from './pages/admin/AdminRegistrations'
import AdminCoC from './pages/admin/AdminCoC'
import AdminRefereeTest from './pages/admin/AdminRefereeTest'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUnder18Form from './pages/admin/AdminUnder18Form'
import AdminMediaRelease from './pages/admin/AdminMediaRelease'
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

          {/* Authenticated */}
          <Route path="/dashboard" element={<ProtectedRoute><PlayerDashboard /></ProtectedRoute>} />
          <Route path="/welcome" element={<ProtectedRoute><Welcome /></ProtectedRoute>} />

          {/* Admin panel */}
          <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route index element={<AdminHome />} />
            <Route path="event" element={<AdminEvent />} />
            <Route path="event-history" element={<AdminEventHistory />} />
            <Route path="registrations" element={<AdminRegistrations />} />
            <Route path="coc" element={<AdminCoC />} />
            <Route path="referee-test" element={<AdminRefereeTest />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="under18-form" element={<AdminUnder18Form />} />
            <Route path="media-release" element={<AdminMediaRelease />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
