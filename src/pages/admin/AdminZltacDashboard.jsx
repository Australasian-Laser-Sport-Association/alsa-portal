import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate } from '../../lib/dateFormat'

function StatCard({ label, value, sub, color }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <p className="text-xs text-[#e5e5e5]/60 uppercase tracking-wider font-bold mb-1">{label}</p>
      <p className={`text-3xl font-black ${color ?? 'text-white'}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-[#e5e5e5]/60 mt-1">{sub}</p>}
    </div>
  )
}

function ActivityRow({ icon, text, time }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-line last:border-0">
      <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e5e5e5]/80">{text}</p>
        <p className="text-xs text-[#e5e5e5]/60 mt-0.5">{time}</p>
      </div>
    </div>
  )
}

function fmt(d) {
  return formatDate(d, 'shortWithTime') || '—'
}

// Tile-grid navigation moved to AdminHub at /admin (feature/admin-hub-
// separation). This page is now stats-only — eight stat cards + Recent
// Activity feed, scoped to the active ZLTAC event. Committee-only; non-
// committee managers reach the hub but not this sub-page. The stats + activity
// payload is computed server-side by a single committee-gated aggregate
// (api/admin/event?resource=zltac-dashboard), collapsing the former
// resolve-event-then-fan-out client waterfall into one request.

export default function AdminZltacDashboard() {
  const { userRoles = [] } = useOutletContext() ?? {}
  const isCommittee = userRoles.some(r => ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor'].includes(r))

  const [stats, setStats] = useState({})
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Stats + activity feed are ZLTAC-event scoped and committee-relevant
    // only. Non-committee managers skip the fetch entirely; the render
    // path below gates on isCommittee before reading `loading`, so the
    // initial loading=true value is harmless for them. The whole payload
    // (event resolution + all counts + activity) is computed server-side in
    // one call, so this is a single request rather than a fetch waterfall.
    if (!isCommittee) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await apiFetch('/api/admin/event?resource=zltac-dashboard')
        if (cancelled) return
        setStats(data.stats ?? {})
        setActivity(data.activity ?? [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load dashboard.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isCommittee])

  // Event-name-suffixed labels. When there's no active event, the scope
  // label reads "No active event" so the user knows why counts are zero.
  const teamsLabel   = `Teams Registered For ${stats.eventScope ?? ''}`
  const playersLabel = `Players Registered For ${stats.eventScope ?? ''}`

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">ZLTAC Dashboard</h1>
        <p className="text-[#e5e5e5]/60 text-sm mt-1">Overview of the active ZLTAC event.</p>
      </div>

      {/* Stats + activity feed — ZLTAC-scoped, committee-only. Hidden
          entirely for non-committee managers. */}
      {!isCommittee ? null : loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          <strong>Error:</strong> {error}
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
                <p className="text-sm text-[#e5e5e5]/60 py-8 text-center">No activity yet</p>
              ) : (
                activity.map((a, i) => (
                  <ActivityRow key={i} icon={a.icon} text={a.text} time={fmt(a.ts)} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
