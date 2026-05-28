import { useOutletContext } from 'react-router-dom'
import {
  Activity, Calendar, ClipboardList, FileText, ShieldCheck, BookOpen, HandHelping,
  Trophy, LayoutDashboard, Users, BadgeCheck, Award, Medal, Briefcase,
  Database,
} from 'lucide-react'
import { Tile, TileSection } from '../../components/AdminTile.jsx'

// /admin landing — pure navigation. Stats + activity feed live on the
// separate /admin/zltac-dashboard page (AdminZltacDashboard) so the two
// concerns aren't conflated.
//
// Sections, top to bottom:
//   1. My Dashboard (purple) — caller's managed competitions; non-
//      committee managers see ONLY this section
//   2. ZLTAC Event Management — committee
//   3. Competitions — superadmin only
//   4. ALSA Portal Management — committee

const TILE_SECTIONS = [
  {
    title: 'ZLTAC Event Management',
    tiles: [
      { label: 'Dashboard',           to: '/admin/zltac-dashboard',    description: 'Stats and recent activity for the active ZLTAC event.', Icon: Activity },
      { label: 'Event Settings',      to: '/admin/event',              description: 'Configure dates, fees, side events, and lifecycle phase.', Icon: Calendar },
      { label: 'Registrations',       to: '/admin/registrations',      description: 'Review players, manage payments, edit registrations.',      Icon: ClipboardList },
      { label: 'Required Documents',  to: '/admin/required-documents', description: 'Upload Code of Conduct, Media Release, Under-18 forms.',    Icon: FileText },
      { label: 'Under 18 Approvals',  to: '/admin/under-18-approvals', description: 'Review and approve guardian forms for under-18 players.',   Icon: ShieldCheck },
      { label: 'Rules Test',          to: '/admin/referee-test',       description: 'Manage test questions, settings, and player results.',      Icon: BookOpen },
      { label: 'Volunteers',          to: '/admin/volunteers',         description: 'Recruit, assign, and confirm event volunteers.',            Icon: HandHelping },
    ],
  },
  {
    title: 'Competitions',
    superadminOnly: true,
    tiles: [
      { label: 'Competitions', to: '/admin/competitions', description: 'Create and manage non-ZLTAC competitions (pre-nationals, etc.).', Icon: Trophy },
    ],
  },
  {
    title: 'ALSA Portal Management',
    tiles: [
      { label: 'Portal Dashboard',   to: '/admin/portal-dashboard',  description: 'ALSA portal-wide statistics and trends.',            Icon: LayoutDashboard },
      { label: 'Users',              to: '/admin/users',             description: 'Search, edit, and grant roles to portal users.',     Icon: Users },
      { label: 'ALSA Members',       to: '/admin/members',           description: 'Manage the paid-membership register and approvals.', Icon: BadgeCheck },
      { label: 'ZLTAC Hall of Fame', to: '/admin/zltac-hall-of-fame', description: 'Historical results, dynasties, and yearly winners.', Icon: Award },
      { label: 'ZLTAC Results',      to: '/admin/zltac-results',     description: 'Record and edit event results.',                     Icon: Medal },
      { label: 'Backups',            to: '/admin/backups',           description: 'Schedule automated CSV backups and run one on demand.', Icon: Database },
    ],
  },
]

export default function AdminHub() {
  const { role, userRoles = [], managedCompetitions = [] } = useOutletContext() ?? {}
  const isSuperAdmin = role === 'superadmin'
  const isCommittee = userRoles.some(r => ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor'].includes(r))
  const hasManagedCompetitions = managedCompetitions.length > 0

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Admin Hub</h1>
        <p className="text-[#e5e5e5]/40 text-sm mt-1">
          {isCommittee
            ? 'Manage events, players, and the portal.'
            : 'Manage your competitions.'}
        </p>
      </div>

      {/* My Dashboard (purple) — the caller's managed competitions, surfaced
          at the top of the hub. Non-committee managers see ONLY this
          section; committee + manager see this AND the rest. */}
      {hasManagedCompetitions && (
        <TileSection title="My Dashboard" tone="purple">
          {managedCompetitions.map(c => (
            <Tile
              key={c.id}
              label={c.name}
              to={`/admin/manage/competitions/${c.slug}`}
              description={c.start_date ? 'Manages registrations, payments, and content.' : 'Pre-nationals competition.'}
              Icon={Briefcase}
              tone="purple"
            />
          ))}
        </TileSection>
      )}

      {/* Committee-only tile sections. superadminOnly filters Competitions. */}
      {TILE_SECTIONS.filter(section => {
        if (!isCommittee) return false
        if (section.superadminOnly && !isSuperAdmin) return false
        return true
      }).map(section => (
        <TileSection key={section.title} title={section.title}>
          {section.tiles.map(t => <Tile key={t.to} {...t} />)}
        </TileSection>
      ))}
    </div>
  )
}
