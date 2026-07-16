import { useContext, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Activity, Calendar, ClipboardList, FileText, ShieldCheck, BookOpen, HandHelping,
  Trophy, LayoutDashboard, Users, BadgeCheck, Award, Medal, Briefcase,
  Database, AlertTriangle, FileCheck,
} from 'lucide-react'
import { Tile, TileSection } from '../../components/AdminTile.jsx'
import { setSiteBanner, SiteBannerContext } from '../../lib/siteSettings'

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
      { label: 'Policies and Forms',       to: '/admin/required-documents', description: 'Upload Code of Conduct, Media Release, and Under-18 forms.', Icon: FileText },
      { label: 'Player Acknowledgements', to: '/admin/player-acknowledgements', description: 'Review Code of Conduct agreements and Media Release consents.', Icon: FileCheck },
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

// Testing-mode controls: toggle the site-wide banner and edit its message.
// Saves through the actor-checked committee API. The shared context is updated
// on save so the banner reflects the
// change immediately without a reload.
function SiteModeCard() {
  const { banner, setBanner } = useContext(SiteBannerContext)
  const [enabled, setEnabled] = useState(banner.enabled)
  const [message, setMessage] = useState(banner.message)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  async function save() {
    setSaving(true); setMsg(null)
    const next = { enabled, message: message.trim() }
    const { error } = await setSiteBanner(next)
    setSaving(false)
    if (error) setMsg({ type: 'error', text: error.message })
    else { setBanner(next); setMsg({ type: 'ok', text: 'Saved.' }) }
  }

  return (
    <div className="bg-surface border border-line rounded-xl p-5 max-w-2xl">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-400" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-bold text-sm">Testing mode</p>
          <p className="text-[#e5e5e5]/60 text-xs mt-1 leading-snug">
            Shows a warning bar on every page and a once per session notice on the homepage.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Testing mode banner"
          onClick={() => setEnabled(v => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-amber-500' : 'bg-line'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <label className="block text-xs text-[#e5e5e5]/60 uppercase tracking-wider font-bold mb-1" htmlFor="site-banner-message">
        Banner message
      </label>
      <textarea
        id="site-banner-message"
        rows={3}
        value={message}
        onChange={e => setMessage(e.target.value)}
        className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand/50"
      />
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={save}
          disabled={saving || !message.trim()}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {msg && (
          <p className={`text-sm font-semibold ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</p>
        )}
      </div>
    </div>
  )
}

export default function AdminHub() {
  const { role, userRoles = [], managedCompetitions = [] } = useOutletContext() ?? {}
  const { banner } = useContext(SiteBannerContext)
  const isSuperAdmin = role === 'superadmin'
  const isCommittee = userRoles.some(r => ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor'].includes(r))
  const hasManagedCompetitions = managedCompetitions.length > 0

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Admin Hub</h1>
        <p className="text-[#e5e5e5]/60 text-sm mt-1">
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

      {/* Site mode (committee) — keyed on the shared banner value so the form
          re-initialises if the app-level fetch resolves after first render. */}
      {isCommittee && (
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/60 mb-3">Site Mode</p>
          <SiteModeCard key={`${banner.enabled}:${banner.message}`} />
        </div>
      )}
    </div>
  )
}
