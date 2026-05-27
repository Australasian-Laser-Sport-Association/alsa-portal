import { useState, useEffect } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  Calendar, ClipboardList, FileText, ShieldCheck, BookOpen, HandHelping,
  Trophy, LayoutDashboard, Users, BadgeCheck, Award, Medal, Briefcase,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { dollars } from '../../lib/pricing'
import { formatDate } from '../../lib/dateFormat'
import { isRefTestRequired, isCocRequired, isPaymentRequired } from '../../lib/eventSettings'

function StatCard({ label, value, sub, color }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <p className="text-xs text-[#e5e5e5]/40 uppercase tracking-wider font-bold mb-1">{label}</p>
      <p className={`text-3xl font-black ${color ?? 'text-white'}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-[#e5e5e5]/40 mt-1">{sub}</p>}
    </div>
  )
}

function ActivityRow({ icon, text, time }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-line last:border-0">
      <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e5e5e5]/80">{text}</p>
        <p className="text-xs text-[#e5e5e5]/30 mt-0.5">{time}</p>
      </div>
    </div>
  )
}

function fmt(d) {
  return formatDate(d, 'shortWithTime') || '—'
}

// Tile groups for the admin landing. Order + grouping mirrors the sidebar
// (AdminLayout.NAV_ITEMS) so committee members see a familiar list.
//   ZLTAC Event Management   — all committee
//   Competitions             — superadmin only
//   ALSA Portal Management   — all committee
// Managed Competitions is rendered separately because its tiles are
// dynamic (one per row from /api/superadmin/my-competitions).
const TILE_SECTIONS = [
  {
    title: 'ZLTAC Event Management',
    tiles: [
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
    ],
  },
]

// Tiles support two visual tones. `brand` (default) is the standard green
// admin look. `purple` is reserved for the "My Dashboard" section at the
// top of the page, which surfaces the caller's managed competitions and
// is intentionally visually distinct from the general admin tiles below.
// Purple tokens mirror the existing superadmin-badge palette used in
// AdminUsers / PlayerDashboard (bg-purple-500/15, text-purple-400,
// border-purple-500/30) so no new colour values are introduced.
function Tile({ label, to, description, Icon, tone = 'brand' }) {
  const isPurple = tone === 'purple'
  const outerCls = isPurple
    ? 'bg-surface border border-purple-500/30 rounded-xl p-5 hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors block'
    : 'bg-surface border border-line rounded-xl p-5 hover:border-brand/40 hover:bg-line/20 transition-colors block'
  const badgeCls = isPurple
    ? 'w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center flex-shrink-0'
    : 'w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0'
  const iconCls = isPurple ? 'w-5 h-5 text-purple-400' : 'w-5 h-5 text-brand'
  return (
    <Link to={to} className={outerCls}>
      <div className="flex items-start gap-3">
        <div className={badgeCls}>
          <Icon className={iconCls} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <p className="text-white font-bold text-sm">{label}</p>
          <p className="text-[#e5e5e5]/50 text-xs mt-1 leading-snug">{description}</p>
        </div>
      </div>
    </Link>
  )
}

function TileSection({ title, children, tone = 'default' }) {
  const headerCls = tone === 'purple'
    ? 'text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-3'
    : 'text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/40 mb-3'
  return (
    <div className="mb-8">
      <p className={headerCls}>{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {children}
      </div>
    </div>
  )
}

// "X / N (Y%)" — guards against divide-by-zero. Returns "X / 0" when N is 0.
function ratioLabel(x, n) {
  const num = x ?? 0
  const denom = n ?? 0
  if (denom <= 0) return `${num} / 0`
  const pct = Math.round((num / denom) * 100)
  return `${num} / ${denom} (${pct}%)`
}

export default function AdminZltacDashboard() {
  const { role, userRoles = [], managedCompetitions = [] } = useOutletContext() ?? {}
  const isSuperAdmin = role === 'superadmin'
  const isCommittee = userRoles.some(r => ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor'].includes(r))
  const hasManagedCompetitions = managedCompetitions.length > 0

  const [stats, setStats] = useState({})
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Stats + activity feed are ZLTAC-event scoped and committee-relevant
    // only. Non-committee managers skip the fetch entirely; the render
    // path below gates on isCommittee before reading `loading`, so the
    // initial loading=true value is harmless for them.
    if (!isCommittee) return
    async function load() {
      // 1. Identify the active event first — most stats are scoped to it.
      const { data: activeEvent } = await supabase
        .from('zltac_events')
        .select('id, name, year, require_ref_test, require_coc, require_payment')
        .eq('status', 'open')
        .limit(1).maybeSingle()
      const activeYear = activeEvent?.year ?? null
      const activeEventId = activeEvent?.id ?? null
      const eventLabel = activeEvent ? `${activeEvent.name} ${activeEvent.year}` : '—'
      const eventScope = activeEvent ? `${activeEvent.name} ${activeEvent.year}` : 'No active event'

      // 2. Top-line counts + raw rows we'll aggregate locally.
      //    Year-scoped tiles require an active event; we still run the
      //    queries even when there's none — they return 0 rows gracefully.
      const [
        teamsRes,
        { data: regsForYear },
        { data: payRecsForYear },
        { data: refResults },
        { data: cocMediaAccs },
        { data: recentRegs },
        { data: recentPayRecs },
        { data: recentCoc },
      ] = await Promise.all([
        activeEventId
          ? supabase.from('teams').select('*', { count: 'exact', head: true }).eq('event_id', activeEventId)
          : Promise.resolve({ count: 0 }),
        activeYear
          ? supabase.from('zltac_registrations').select('id, user_id, amount_owing, admin_override_coc, admin_override_media, admin_override_ref_test').eq('year', activeYear)
          : Promise.resolve({ data: [] }),
        activeYear
          ? supabase.from('payment_records')
              .select('registration_id, amount, zltac_registrations!inner(year)')
              .eq('zltac_registrations.year', activeYear)
          : Promise.resolve({ data: [] }),
        supabase.from('referee_test_results').select('user_id, passed'),
        activeYear
          ? supabase.from('legal_acceptances')
              .select('user_id, document:legal_documents!document_id(document_type)')
              .eq('event_year', activeYear)
          : Promise.resolve({ data: [] }),
        supabase.from('zltac_registrations')
          .select('id, created_at, year, profiles!zltac_registrations_user_id_fkey(first_name, alias)')
          .order('created_at', { ascending: false }).limit(5),
        // Recent payments (latest 5) — same shape as before, sourced from
        // payment_records joined to profiles via the registration.
        supabase.from('payment_records')
          .select('amount, recorded_at, registration:zltac_registrations!inner(profiles!zltac_registrations_user_id_fkey(first_name, alias))')
          .order('recorded_at', { ascending: false }).limit(5),
        supabase.from('legal_acceptances')
          .select('accepted_at, profiles!user_id(first_name, alias), document:legal_documents!document_id(document_type)')
          .order('accepted_at', { ascending: false }).limit(20),
      ])

      const teamsForEvent = teamsRes.count ?? 0
      const playersForEvent = (regsForYear ?? []).length

      // 3. Payment totals: sum payment_records by registration, then per-reg
      //    balance = amount_owing - amount_paid. Total amount-owing = sum of
      //    positive balances only. "Payments Received" = sum of all amounts
      //    (refund records are negative, so the total nets out correctly).
      const paidByReg = {}
      let paymentsReceivedCents = 0
      for (const rec of (payRecsForYear ?? [])) {
        paidByReg[rec.registration_id] = (paidByReg[rec.registration_id] ?? 0) + (rec.amount ?? 0)
        paymentsReceivedCents += rec.amount ?? 0
      }
      let amountOwingCents = 0
      for (const reg of (regsForYear ?? [])) {
        const owing = reg.amount_owing ?? 0
        const paid = paidByReg[reg.id] ?? 0
        const balance = owing - paid
        if (balance > 0) amountOwingCents += balance
      }

      // 4. Ratios — X / N (Y%) where N = playersForEvent. Each X is the
      //    count of currently-registered players for the active year who
      //    have completed the requirement.
      const registeredUserIds = new Set((regsForYear ?? []).map(r => r.user_id))

      // Committee manual overrides count toward a satisfied concern, matching
      // the rule used in CaptainHub / AdminRegistrations: normalCheck || override.
      const overrideCocUsers   = new Set((regsForYear ?? []).filter(r => r.admin_override_coc).map(r => r.user_id))
      const overrideMediaUsers = new Set((regsForYear ?? []).filter(r => r.admin_override_media).map(r => r.user_id))
      const overrideRefUsers   = new Set((regsForYear ?? []).filter(r => r.admin_override_ref_test).map(r => r.user_id))

      const refPassedUserIds = new Set((refResults ?? []).filter(r => r.passed).map(r => r.user_id))
      const refPassedRegistered = [...registeredUserIds].filter(uid => refPassedUserIds.has(uid) || overrideRefUsers.has(uid)).length

      const cocSignedUserIds = new Set(
        (cocMediaAccs ?? [])
          .filter(a => a.document?.document_type === 'code_of_conduct')
          .map(a => a.user_id)
      )
      const mediaSignedUserIds = new Set(
        (cocMediaAccs ?? [])
          .filter(a => a.document?.document_type === 'media_release')
          .map(a => a.user_id)
      )
      const cocSignedRegistered = [...registeredUserIds].filter(uid => cocSignedUserIds.has(uid) || overrideCocUsers.has(uid)).length
      const mediaSignedRegistered = [...registeredUserIds].filter(uid => mediaSignedUserIds.has(uid) || overrideMediaUsers.has(uid)).length

      // Per-event toggles. When a requirement is disabled the corresponding
      // tile renders "N/A" instead of a value — surfacing that the dashboard
      // isn't ignoring the check by accident.
      const refRequired = isRefTestRequired(activeEvent)
      const cocRequired = isCocRequired(activeEvent)
      const paymentRequired = isPaymentRequired(activeEvent)

      setStats({
        teamsForEvent,
        playersForEvent,
        paymentRequired,
        paymentsReceivedDisplay: paymentRequired ? dollars(paymentsReceivedCents ?? 0) : 'N/A',
        amountOwingDisplay:      paymentRequired ? dollars(amountOwingCents ?? 0)     : 'N/A',
        amountOwingCents,
        refRequired,
        refRatio:   refRequired ? ratioLabel(refPassedRegistered, playersForEvent) : 'N/A',
        cocRequired,
        cocRatio:   cocRequired ? ratioLabel(cocSignedRegistered,   playersForEvent) : 'N/A',
        mediaRatio: ratioLabel(mediaSignedRegistered, playersForEvent),
        eventLabel,
        eventScope,
        eventName: activeEvent?.name ?? null,
        eventYear: activeYear,
        eventOpen: !!activeEvent,
      })

      // 5. Activity feed.
      const feed = []
      function displayName(profiles) {
        if (!profiles) return 'A player'
        return profiles.alias || profiles.first_name || 'A player'
      }
      for (const r of recentRegs ?? []) {
        feed.push({ icon: '📋', text: `${displayName(r.profiles)} registered for ZLTAC ${r.year ?? activeYear ?? ''}`, time: fmt(r.created_at), ts: r.created_at })
      }
      for (const p of recentPayRecs ?? []) {
        const prof = p.registration?.profiles
        const isRefund = (p.amount ?? 0) < 0
        feed.push({
          icon: isRefund ? '↩️' : '💳',
          text: isRefund
            ? `${displayName(prof)} refunded ${dollars(Math.abs(p.amount))}`
            : `${displayName(prof)} paid ${dollars(p.amount)}`,
          time: fmt(p.recorded_at),
          ts: p.recorded_at,
        })
      }
      const cocAcceptances = (recentCoc ?? [])
        .filter(a => a.document?.document_type === 'code_of_conduct')
        .slice(0, 5)
      for (const c of cocAcceptances) {
        feed.push({ icon: '✍️', text: `${displayName(c.profiles)} signed the Code of Conduct`, time: fmt(c.accepted_at), ts: c.accepted_at })
      }
      feed.sort((a, b) => new Date(b.ts) - new Date(a.ts))
      setActivity(feed.slice(0, 12))
      setLoading(false)
    }
    load()
  }, [isCommittee])

  // Event-name-suffixed labels. When there's no active event, the scope
  // label reads "No active event" so the user knows why counts are zero.
  const teamsLabel   = `Teams Registered For ${stats.eventScope ?? ''}`
  const playersLabel = `Players Registered For ${stats.eventScope ?? ''}`

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

      {/* My Dashboard — promoted to the top so managers see their
          competitions immediately on entering the hub. Purple-toned to
          differentiate from the green admin tile sections below; the
          section only renders when the caller has at least one managed
          competition (superadmins implicitly manage every non-archived
          competition via the my-competitions shortcut). */}
      {hasManagedCompetitions && (
        <TileSection title="My Dashboard" tone="purple">
          {managedCompetitions.map(c => (
            <Tile
              key={c.id}
              label={c.name}
              to={`/manage/competitions/${c.slug}`}
              description={c.start_date ? 'Manages registrations, payments, and content.' : 'Pre-nationals competition.'}
              Icon={Briefcase}
              tone="purple"
            />
          ))}
        </TileSection>
      )}

      {/* Tile grid — sections role-gated. Non-committee managers see
          nothing in this block; committee sees the full set. */}
      {TILE_SECTIONS.filter(section => {
        if (!isCommittee) return false
        if (section.superadminOnly && !isSuperAdmin) return false
        return true
      }).map(section => (
        <TileSection key={section.title} title={section.title}>
          {section.tiles.map(t => <Tile key={t.to} {...t} />)}
        </TileSection>
      ))}

      {/* Stats + activity feed — ZLTAC-scoped, committee-only. Hidden
          entirely for non-committee managers. */}
      {!isCommittee ? null : loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <StatCard label={teamsLabel} value={stats.teamsForEvent} color="text-brand" />
            <StatCard label={playersLabel} value={stats.playersForEvent} color="text-white" />
            <StatCard
              label="Payments Received"
              value={stats.paymentsReceivedDisplay}
              sub={stats.paymentRequired === false ? `Not required for ${stats.eventScope}` : stats.eventScope}
              color="text-brand"
            />
            <StatCard
              label="Payment Amount Owing"
              value={stats.amountOwingDisplay}
              sub={stats.paymentRequired === false ? `Not required for ${stats.eventScope}` : stats.eventScope}
              color={stats.paymentRequired !== false && stats.amountOwingCents > 0 ? 'text-yellow-400' : 'text-white'}
            />
            <StatCard
              label="Rules Tests Passed"
              value={stats.refRatio}
              sub={stats.refRequired === false ? `Not required for ${stats.eventScope}` : stats.eventScope}
              color="text-white"
            />
            <StatCard
              label="CoC's Signed"
              value={stats.cocRatio}
              sub={stats.cocRequired === false ? `Not required for ${stats.eventScope}` : stats.eventScope}
              color="text-white"
            />
            <StatCard label="Media Forms Signed" value={stats.mediaRatio} sub={stats.eventScope} color="text-white" />
            <StatCard
              label="Active Event"
              value={stats.eventLabel}
              sub={stats.eventOpen ? 'Registration open' : 'No event open'}
              color="text-brand"
            />
          </div>

          {/* Activity feed */}
          <div className="bg-surface border border-line rounded-xl">
            <div className="px-5 py-4 border-b border-line">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Recent Activity</h2>
            </div>
            <div className="px-5">
              {activity.length === 0 ? (
                <p className="text-sm text-[#e5e5e5]/30 py-8 text-center">No activity yet</p>
              ) : (
                activity.map((a, i) => (
                  <ActivityRow key={i} icon={a.icon} text={a.text} time={a.time} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
